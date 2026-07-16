import type {
  MeasureShareOfVoiceInput,
  MeasureShareOfVoiceOutput,
  PanelistId,
  Sentiment,
} from "@geo-radar/shared";
import type { BeginRunParams, BeginRunResult, GeoStore, PersistedAnswer } from "@geo-radar/db";
import {
  PANELIST_MODELS,
  REAL_CALL_COST_ESTIMATE_USD,
  hasAnthropicKey,
  hasPanelistKey,
  PARSER_MODEL_ID,
  PARSER_PROVIDER,
  providerFor,
} from "./models";
import { NOOP_RATE_LIMITER, type ProviderRateLimiter } from "./rate-limit";
import {
  createRealPanelist,
  createMockPanelist,
  type Panelist,
} from "./panelist";
import { createAnthropicParser, createDeterministicParser, type Parser } from "./parser";
import { computeShareOfVoice } from "./scoring";
import { CostMeter } from "./cost";
import { resolvePromptSet } from "./prompt-library";
import { PanelRunError } from "./errors";

/** Hard ceiling on LLM calls per run (prompts × runs × panelists). */
export const MAX_PANELIST_CALLS = 240;

export interface PanelRunner {
  run(input: MeasureShareOfVoiceInput): Promise<MeasureShareOfVoiceOutput>;
}

/** A validated run plan (prompts/panel resolved, workload ceiling checked). */
export interface RunPlan {
  prompts: string[];
  panel: string[];
  runs: number;
}

/**
 * Resolve + validate prompts, panel, and the workload ceiling. Shared by the
 * in-process runner and the queue runner (which validates before enqueuing so a
 * bad request fails fast instead of dying in a worker). Throws `PanelRunError`.
 */
export function planRun(input: MeasureShareOfVoiceInput): RunPlan {
  const prompts = resolvePrompts(input);
  const panel = resolvePanel(input);
  const runs = input.runs ?? 1;
  const panelistCalls = prompts.length * runs * panel.length;
  if (panelistCalls > MAX_PANELIST_CALLS) {
    throw new PanelRunError(
      `Workload too large: ${prompts.length} prompts × ${runs} runs × ${panel.length} panelists ` +
        `= ${panelistCalls} calls (max ${MAX_PANELIST_CALLS}). Reduce prompts, runs, or panel.`,
      "workload_too_large",
    );
  }
  return { prompts, panel, runs };
}

/** Build the store `beginRun` params for an input + resolved panel. */
export function beginRunParams(input: MeasureShareOfVoiceInput, panel: string[]): BeginRunParams {
  return {
    brand: { name: input.brand, domains: input.brand_domains, owner: null },
    competitors: input.competitors.map((name) => ({ name })),
    promptSetId: input.prompt_set_id ?? null,
    panel,
  };
}

function resolvePrompts(input: MeasureShareOfVoiceInput): string[] {
  if (input.prompts && input.prompts.length > 0) return input.prompts;
  if (input.prompt_set_id) {
    const set = resolvePromptSet(input.prompt_set_id);
    if (!set) {
      throw new PanelRunError(
        `Unknown prompt_set_id "${input.prompt_set_id}". Built-in sets: demo.`,
        "no_prompts",
      );
    }
    return set.prompts;
  }
  throw new PanelRunError("No prompts provided (need `prompts` or `prompt_set_id`).", "no_prompts");
}

function resolvePanel(input: MeasureShareOfVoiceInput): string[] {
  const panel = input.panel && input.panel.length > 0 ? input.panel : ["haiku"];
  const valid = Object.keys(PANELIST_MODELS);
  for (const id of panel) {
    if (!valid.includes(id)) {
      throw new PanelRunError(`Unknown panelist "${id}". Available: ${valid.join(", ")}.`, "unknown_panelist");
    }
  }
  return panel;
}

export interface RunnerOptions {
  costCapUsd: number;
  /** Force the deterministic mock pipeline (tests). Otherwise inferred from ANTHROPIC_API_KEY. */
  forceMock?: boolean;
  /** Override the per-call cost estimate (USD). Defaults to 0 for mock, ~$0.01 for real. */
  estimatePerCallUsd?: number;
  /** Per-provider rate limiter for real calls. Defaults to a no-op (no Redis / dev). */
  rateLimiter?: ProviderRateLimiter;
}

/**
 * Runs a panel synchronously in-process (v1). The public shape — return a
 * report_id, persist to the store — is identical to the queued/worker version
 * that replaces this at P6, so the MCP tool contract won't change.
 */
export class InProcessPanelRunner implements PanelRunner {
  constructor(
    private readonly store: GeoStore,
    private readonly opts: RunnerOptions,
  ) {}

  /**
   * Run the panel. When `existingRun` is provided (the queue path, where the run row
   * was already created so the caller could return a report_id immediately), we
   * finish that run instead of beginning a new one.
   */
  async run(
    input: MeasureShareOfVoiceInput,
    existingRun?: BeginRunResult,
  ): Promise<MeasureShareOfVoiceOutput> {
    const { prompts, panel, runs } = planRun(input);
    const forceMock = this.opts.forceMock ?? false;
    // A panelist runs for real only if forced-mock is off AND its provider key exists.
    const isMock = (id: string): boolean => forceMock || !hasPanelistKey(id as PanelistId);
    const parserMock = forceMock || !hasAnthropicKey();
    const anyRealCall = panel.some((id) => !isMock(id)) || !parserMock;

    const { runId, brandId } = existingRun ?? (await this.store.beginRun(beginRunParams(input, panel)));

    try {
      const panelists = panel.map((id) =>
        isMock(id)
          ? createMockPanelist(id, input.brand, input.competitors)
          : createRealPanelist(id as PanelistId),
      );
      const parser: Parser = parserMock ? createDeterministicParser() : createAnthropicParser();
      const limiter = this.opts.rateLimiter ?? NOOP_RATE_LIMITER;
      const meter = new CostMeter(this.opts.costCapUsd);
      const estimatePerCall =
        this.opts.estimatePerCallUsd ?? (anyRealCall ? REAL_CALL_COST_ESTIMATE_USD : 0);

      const persisted: PersistedAnswer[] = [];
      for (const prompt of prompts) {
        for (let r = 0; r < runs; r++) {
          for (const panelist of panelists) {
            // Abort BEFORE spending if the next panelist+parser calls could exceed the cap.
            if (meter.wouldExceed(estimatePerCall * 2)) {
              throw new PanelRunError(
                `Cost cap of $${this.opts.costCapUsd.toFixed(2)} would be exceeded; ` +
                  `aborted after $${meter.total.toFixed(4)}. Raise PANEL_COST_CAP_USD_PER_RUN or reduce prompts/panel/runs.`,
                "cost_cap_exceeded",
              );
            }

            // Per-provider rate limit before each REAL upstream call (no-op for mock).
            if (!isMock(panelist.id)) await limiter.acquire(providerFor(panelist.id as PanelistId));
            const answer = await this.callPanelist(panelist, prompt);
            meter.add(answer.model, answer.usage);

            if (!parserMock) await limiter.acquire(PARSER_PROVIDER);
            const parsed = await this.callParser(parser, answer.text, input);
            meter.add(PARSER_MODEL_ID, parsed.usage);

            persisted.push({
              model: answer.model,
              prompt,
              rawAnswer: answer.text,
              mentions: parsed.mentions,
              citedDomains: parsed.citedDomains,
              sentiment: parsed.sentiment,
            });
          }
        }
      }

      const scored = computeShareOfVoice({
        brand: input.brand,
        competitors: input.competitors,
        answers: persisted.map((a) => ({ prompt: a.prompt, mentions: a.mentions })),
      });

      const brandSov = scored.shareOfVoice.find((e) => e.brand === input.brand)?.sov ?? 0;
      const sentimentScore = averageSentiment(persisted.map((a) => a.sentiment));

      await this.store.finishRun(runId, {
        brandId,
        costUsd: round4(meter.total),
        answers: persisted,
        sov: brandSov,
        sentimentScore,
        date: today(),
      });

      return {
        report_id: runId,
        brand: input.brand,
        status: "completed",
        panel,
        prompt_count: prompts.length,
        answer_count: persisted.length,
        share_of_voice: scored.shareOfVoice,
        per_prompt: scored.perPrompt,
        cost_usd: round4(meter.total),
        created_at: new Date().toISOString(),
      };
    } catch (err) {
      const message =
        err instanceof PanelRunError ? err.message : `panel run failed: ${errorMessage(err)}`;
      await this.store.failRun(runId, message);
      if (err instanceof PanelRunError) throw err;
      throw new PanelRunError(message, "provider_error");
    }
  }

  private async callPanelist(panelist: Panelist, prompt: string) {
    try {
      return await panelist.ask(prompt);
    } catch (err) {
      throw new PanelRunError(
        `Panelist "${panelist.id}" failed: ${errorMessage(err)}`,
        "provider_error",
      );
    }
  }

  private async callParser(parser: Parser, text: string, input: MeasureShareOfVoiceInput) {
    try {
      return await parser.parse(text, { brand: input.brand, competitors: input.competitors });
    } catch (err) {
      throw new PanelRunError(`Answer parsing failed: ${errorMessage(err)}`, "provider_error");
    }
  }
}

function averageSentiment(sentiments: (Sentiment | null)[]): number | null {
  const values = sentiments
    .filter((s): s is Sentiment => s !== null)
    .map((s): number => (s === "positive" ? 1 : s === "negative" ? -1 : 0));
  if (values.length === 0) return null;
  return round4(values.reduce((a, b) => a + b, 0) / values.length);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
