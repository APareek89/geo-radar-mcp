import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { MeasureShareOfVoiceInput, MeasureShareOfVoiceOutput } from "@geo-radar/shared";
import type { GeoStore } from "@geo-radar/db";
import {
  InProcessPanelRunner,
  beginRunParams,
  planRun,
  type PanelRunner,
  type RunnerOptions,
} from "./runner";
import { PanelRunError } from "./errors";
import { createProviderRateLimiter } from "./rate-limit";
import { logger } from "./logger";

// BullMQ 5 forbids ":" in queue names (it's the Redis key separator) — a colon here
// crashes the worker on boot with "Queue name cannot contain :". Use a hyphen.
export const PANEL_QUEUE_NAME = "geo-radar-panel-runs";

/** Job payload: the input plus the run row the web tier pre-created (so it could
 *  return a report_id immediately). The worker finishes THIS run rather than begin one. */
export interface PanelJobData {
  input: MeasureShareOfVoiceInput;
  runId: string;
  brandId: string;
}

function connection(redisUrl: string): ConnectionOptions {
  // BullMQ requires maxRetriesPerRequest: null on the blocking connection.
  return { url: redisUrl, maxRetriesPerRequest: null } as unknown as ConnectionOptions;
}

/**
 * PanelRunner backed by BullMQ — **fire-and-forget**. `run()` validates the request,
 * creates the run row (status "queued"), enqueues the job, and returns immediately
 * with `{ status: "queued", report_id }`. The MCP tool call no longer blocks for the
 * whole (multi-minute, many-LLM-call) run; the client polls `get_report(report_id)`
 * until status is "completed"/"failed". A worker (apps/worker) does the heavy work.
 */
export class QueuePanelRunner implements PanelRunner {
  private readonly queue: Queue<PanelJobData>;

  constructor(
    redisUrl: string,
    private readonly store: GeoStore,
  ) {
    this.queue = new Queue(PANEL_QUEUE_NAME, { connection: connection(redisUrl) });
  }

  async run(input: MeasureShareOfVoiceInput): Promise<MeasureShareOfVoiceOutput> {
    // Validate up front so a bad request fails fast (not silently in a worker).
    const { prompts, panel } = planRun(input);
    const { runId, brandId } = await this.store.beginRun(beginRunParams(input, panel));

    try {
      await this.queue.add(
        "measure",
        { input, runId, brandId },
        {
          // A panel run makes many billed LLM calls and is NOT idempotent — auto-retry
          // would re-run the whole pipeline and multiply spend (FMEA P0). A failed run
          // is marked failed and surfaced; the caller decides whether to re-invoke.
          attempts: 1,
          removeOnComplete: 1000,
          removeOnFail: 5000, // dead-letter inspection window
        },
      );
    } catch (err) {
      // Enqueue failed (e.g. Redis down) — don't leave the row stuck "running".
      const message = err instanceof Error ? err.message : String(err);
      await this.store.failRun(runId, `failed to enqueue: ${message}`);
      throw new PanelRunError(`Failed to enqueue panel run: ${message}`, "internal");
    }
    logger.info("panel run queued", { report_id: runId, panel });

    return {
      report_id: runId,
      brand: input.brand,
      status: "queued",
      panel,
      prompt_count: prompts.length,
      answer_count: 0,
      share_of_voice: [],
      per_prompt: [],
      cost_usd: 0,
      created_at: new Date().toISOString(),
    };
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

/**
 * Start a BullMQ worker that runs queued panel jobs to completion with the in-process
 * pipeline, finishing the pre-created run row. `attempts:1` (set on enqueue) means a
 * failure is terminal — recorded via failRun and left in the failed set for inspection.
 */
export function startPanelWorker(
  store: GeoStore,
  redisUrl: string,
  opts: RunnerOptions,
  concurrency = 4,
): Worker<PanelJobData, MeasureShareOfVoiceOutput> {
  const runner = new InProcessPanelRunner(store, {
    rateLimiter: createProviderRateLimiter(),
    ...opts,
  });
  return new Worker<PanelJobData, MeasureShareOfVoiceOutput>(
    PANEL_QUEUE_NAME,
    async (job) => runner.run(job.data.input, { runId: job.data.runId, brandId: job.data.brandId }),
    { connection: connection(redisUrl), concurrency },
  );
}
