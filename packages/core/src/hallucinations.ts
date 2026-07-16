import type { DetectHallucinationsOutput } from "@geo-radar/shared";
import type { GeoStore } from "@geo-radar/db";
import { hasAnthropicKey } from "./models";
import { createAnthropicFactChecker, createDeterministicFactChecker } from "./fact-check";
import { PanelRunError } from "./errors";

/**
 * Fact-check every stored answer of a report against a ground-truth facts list.
 * Reuses the raw answers already persisted by measure_share_of_voice (no re-run).
 */
export async function runHallucinationCheck(
  store: GeoStore,
  reportId: string,
  facts: string[],
  opts: { forceMock?: boolean } = {},
): Promise<DetectHallucinationsOutput> {
  const stored = await store.getReport(reportId);
  if (!stored) {
    throw new PanelRunError(`No report found for id "${reportId}".`, "no_prompts");
  }

  const useMock = opts.forceMock ?? !hasAnthropicKey();
  const checker = useMock ? createDeterministicFactChecker() : createAnthropicFactChecker();

  const flagged: DetectHallucinationsOutput["flagged"] = [];
  for (const ans of stored.answers) {
    const res = await checker.check(ans.rawAnswer, stored.brand, facts);
    for (const flag of res.flags) {
      flagged.push({ ...flag, model: ans.model, prompt: ans.prompt });
    }
  }

  // Persist to the hallucinations table (P1 fix — was returned but not stored).
  await store.saveHallucinations(
    reportId,
    flagged.map((f) => ({ claim: f.claim, contradictsFact: f.contradicts_fact, severity: f.severity })),
  );

  return {
    report_id: reportId,
    brand: stored.brand,
    checked_answers: stored.answers.length,
    flagged,
  };
}
