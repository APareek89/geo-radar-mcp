import { Queue, QueueEvents, Worker, type ConnectionOptions } from "bullmq";
import type { MeasureShareOfVoiceInput, MeasureShareOfVoiceOutput } from "@geo-radar/shared";
import type { GeoStore } from "@geo-radar/db";
import { InProcessPanelRunner, type PanelRunner, type RunnerOptions } from "./runner";

export const PANEL_QUEUE_NAME = "geo-radar:panel-runs";

function connection(redisUrl: string): ConnectionOptions {
  // BullMQ requires maxRetriesPerRequest: null on the blocking connection.
  return { url: redisUrl, maxRetriesPerRequest: null } as unknown as ConnectionOptions;
}

/**
 * PanelRunner backed by BullMQ. The web tier enqueues a job; a worker (apps/worker)
 * runs the LLM pipeline. Same `run()` contract as the in-process runner — it awaits
 * the worker's result via QueueEvents, so tool responses are unchanged.
 *
 * (Follow-up: a fire-and-forget variant that returns report_id immediately and lets
 * the client poll get_report — the DB status already models "queued".)
 */
export class QueuePanelRunner implements PanelRunner {
  private readonly queue: Queue<MeasureShareOfVoiceInput, MeasureShareOfVoiceOutput>;
  private readonly events: QueueEvents;

  constructor(redisUrl: string) {
    const conn = connection(redisUrl);
    this.queue = new Queue(PANEL_QUEUE_NAME, { connection: conn });
    this.events = new QueueEvents(PANEL_QUEUE_NAME, { connection: conn });
  }

  async run(input: MeasureShareOfVoiceInput): Promise<MeasureShareOfVoiceOutput> {
    const job = await this.queue.add("measure", input, {
      // A panel run makes many billed LLM calls and is NOT idempotent — auto-retry
      // would re-run the whole pipeline and multiply spend (FMEA P0). A failed run is
      // marked failed and surfaced; the caller decides whether to re-invoke.
      attempts: 1,
      removeOnComplete: 1000,
      removeOnFail: 5000, // dead-letter inspection window
    });
    return (await job.waitUntilFinished(this.events)) as MeasureShareOfVoiceOutput;
  }

  async close(): Promise<void> {
    await this.queue.close();
    await this.events.close();
  }
}

/**
 * Start a BullMQ worker that processes panel-run jobs with the in-process pipeline.
 * Idempotent per job (BullMQ handles retries/backoff); a DLQ is the failed set.
 */
export function startPanelWorker(
  store: GeoStore,
  redisUrl: string,
  opts: RunnerOptions,
  concurrency = 4,
): Worker<MeasureShareOfVoiceInput, MeasureShareOfVoiceOutput> {
  const runner = new InProcessPanelRunner(store, opts);
  return new Worker<MeasureShareOfVoiceInput, MeasureShareOfVoiceOutput>(
    PANEL_QUEUE_NAME,
    async (job) => runner.run(job.data),
    { connection: connection(redisUrl), concurrency },
  );
}
