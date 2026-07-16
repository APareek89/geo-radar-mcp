import type { CompareToCompetitorInput, CompareToCompetitorOutput } from "@geo-radar/shared";
import type { GeoStore } from "@geo-radar/db";
import type { PanelRunner } from "./runner";

/**
 * Head-to-head: run a panel with brand_a as the primary and brand_b as the sole
 * competitor, then derive SoV, a citation-share proxy, and sentiment.
 *
 * Note: our parser scores sentiment toward the PRIMARY brand, so sentiment_score
 * is measured for brand_a only (brand_b is null) — honest about the single-pass cost.
 */
export async function compareToCompetitor(
  runner: PanelRunner,
  store: GeoStore,
  input: CompareToCompetitorInput,
): Promise<CompareToCompetitorOutput> {
  const report = await runner.run({
    brand: input.brand_a,
    competitors: [input.brand_b],
    prompts: input.prompts,
    prompt_set_id: input.prompt_set_id,
    panel: input.panel,
    runs: input.runs,
  });

  const stored = await store.getReport(report.report_id);
  const answers = stored?.answers ?? [];

  let citeA = 0;
  let citeB = 0;
  let sentimentSum = 0;
  let sentimentCount = 0;
  for (const ans of answers) {
    if (ans.mentions.includes(input.brand_a)) citeA += ans.citedDomains.length;
    if (ans.mentions.includes(input.brand_b)) citeB += ans.citedDomains.length;
    if (ans.sentiment) {
      sentimentSum += ans.sentiment === "positive" ? 1 : ans.sentiment === "negative" ? -1 : 0;
      sentimentCount += 1;
    }
  }
  const citeTotal = citeA + citeB;

  const sovA = report.share_of_voice.find((e) => e.brand === input.brand_a)?.sov ?? 0;
  const sovB = report.share_of_voice.find((e) => e.brand === input.brand_b)?.sov ?? 0;

  return {
    report_id: report.report_id,
    brand_a: input.brand_a,
    brand_b: input.brand_b,
    share_of_voice: report.share_of_voice,
    citation_share: {
      brand_a: citeTotal > 0 ? citeA / citeTotal : 0,
      brand_b: citeTotal > 0 ? citeB / citeTotal : 0,
    },
    sentiment_score: {
      brand_a: sentimentCount > 0 ? round4(sentimentSum / sentimentCount) : null,
      brand_b: null,
    },
    winner: sovA === sovB ? null : sovA > sovB ? input.brand_a : input.brand_b,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
