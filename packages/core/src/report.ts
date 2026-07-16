import type { GetReportOutput } from "@geo-radar/shared";
import type { GeoStore } from "@geo-radar/db";
import { computeShareOfVoice } from "./scoring";

/**
 * Assemble a full report from stored rows, recomputing share-of-voice from the
 * persisted answers (single source of truth — no cached summary to drift).
 */
export async function buildReport(store: GeoStore, reportId: string): Promise<GetReportOutput | null> {
  const stored = await store.getReport(reportId);
  if (!stored) return null;

  const scored = computeShareOfVoice({
    brand: stored.brand,
    competitors: stored.competitors,
    answers: stored.answers.map((a) => ({ prompt: a.prompt, mentions: a.mentions })),
  });

  return {
    report_id: stored.run.id,
    status: stored.run.status,
    brand: stored.brand,
    panel: stored.run.panel,
    cost_usd: stored.run.costUsd,
    created_at: stored.run.createdAt,
    completed_at: stored.run.completedAt,
    error: stored.run.error,
    share_of_voice: scored.shareOfVoice,
    per_prompt: scored.perPrompt,
    answers: stored.answers.map((a) => ({
      model: a.model,
      prompt: a.prompt,
      mentions: a.mentions,
      cited_domains: a.citedDomains,
      sentiment: a.sentiment,
    })),
  };
}
