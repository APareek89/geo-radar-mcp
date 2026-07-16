import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  TrackCitationsInputObject,
  TrackCitationsOutputSchema,
  SentimentScanInputObject,
  SentimentScanOutputSchema,
  DetectHallucinationsInputObject,
  DetectHallucinationsOutputSchema,
  CompareToCompetitorInputObject,
  CompareToCompetitorOutputSchema,
} from "@geo-radar/shared";
import {
  computeCitations,
  computeSentiment,
  compareToCompetitor,
  runHallucinationCheck,
  PanelRunError,
  type AnalysisAnswer,
} from "@geo-radar/core";
import type { ServerRuntime } from "../runtime";

const toolError = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Registers the P3/P4 analysis tools that slice a stored report or run a compare. */
export function registerAnalysisTools(server: McpServer, runtime: ServerRuntime): void {
  const { store, runner } = runtime;

  // ── track_citations ─────────────────────────────────────────────────────
  server.registerTool(
    "track_citations",
    {
      title: "Track Citations",
      description:
        "Analyze a stored report: which domains the AI answers cited, your citation share vs others, " +
        "and the answers that cited someone else's domain but not yours (the actionable gap). " +
        "Takes a report_id from measure_share_of_voice.",
      inputSchema: TrackCitationsInputObject.shape,
      outputSchema: TrackCitationsOutputSchema.shape,
    },
    async ({ report_id, brand_domains }) => {
      const stored = await store.getReport(report_id);
      if (!stored) return toolError(`No report found for id "${report_id}".`);
      const answers: AnalysisAnswer[] = stored.answers.map((a) => ({
        prompt: a.prompt,
        rawAnswer: a.rawAnswer,
        citedDomains: a.citedDomains,
        sentiment: a.sentiment,
      }));
      const result = computeCitations(
        report_id,
        stored.brand,
        answers,
        brand_domains ?? stored.brandDomains,
      );
      return {
        content: [
          {
            type: "text",
            text: `${stored.brand}: ${(result.your_citation_share * 100).toFixed(1)}% citation share (${result.your_citations}/${result.total_citations}); ${result.competitor_gap.length} gap answers.`,
          },
        ],
        structuredContent: result,
      };
    },
  );

  // ── sentiment_scan ──────────────────────────────────────────────────────
  server.registerTool(
    "sentiment_scan",
    {
      title: "Sentiment Scan",
      description:
        "Analyze a stored report's sentiment distribution toward the brand, with representative quotes. " +
        "Takes a report_id from measure_share_of_voice.",
      inputSchema: SentimentScanInputObject.shape,
      outputSchema: SentimentScanOutputSchema.shape,
    },
    async ({ report_id }) => {
      const stored = await store.getReport(report_id);
      if (!stored) return toolError(`No report found for id "${report_id}".`);
      const answers: AnalysisAnswer[] = stored.answers.map((a) => ({
        prompt: a.prompt,
        rawAnswer: a.rawAnswer,
        citedDomains: a.citedDomains,
        sentiment: a.sentiment,
      }));
      const result = computeSentiment(report_id, stored.brand, answers);
      const d = result.distribution;
      return {
        content: [
          {
            type: "text",
            text: `${stored.brand} sentiment — +${d.positive} / ~${d.neutral} / -${d.negative} (score ${result.sentiment_score ?? "n/a"}).`,
          },
        ],
        structuredContent: result,
      };
    },
  );

  // ── detect_hallucinations ───────────────────────────────────────────────
  server.registerTool(
    "detect_hallucinations",
    {
      title: "Detect Hallucinations",
      description:
        "Check a stored report's answers against a ground-truth facts list and flag false/outdated " +
        "claims about the brand, with the contradicted fact and a severity. Takes a report_id and facts[].",
      inputSchema: DetectHallucinationsInputObject.shape,
      outputSchema: DetectHallucinationsOutputSchema.shape,
    },
    async ({ report_id, facts }) => {
      try {
        const result = await runHallucinationCheck(store, report_id, facts);
        return {
          content: [
            {
              type: "text",
              text: `${result.brand}: checked ${result.checked_answers} answers, flagged ${result.flagged.length} claim(s).`,
            },
          ],
          structuredContent: result,
        };
      } catch (e) {
        return toolError(e instanceof PanelRunError ? e.message : `detect_hallucinations failed: ${errMsg(e)}`);
      }
    },
  );

  // ── compare_to_competitor ───────────────────────────────────────────────
  server.registerTool(
    "compare_to_competitor",
    {
      title: "Compare to Competitor",
      description:
        "Run a head-to-head panel between two brands and return share-of-voice, a citation-share proxy, " +
        "sentiment (toward brand_a), and the winner. Provide prompts or a prompt_set_id.",
      inputSchema: CompareToCompetitorInputObject.shape,
      outputSchema: CompareToCompetitorOutputSchema.shape,
    },
    async (args) => {
      try {
        const result = await compareToCompetitor(runner, store, args);
        return {
          content: [
            {
              type: "text",
              text: `${result.brand_a} vs ${result.brand_b} — winner: ${result.winner ?? "tie"} (report ${result.report_id}).`,
            },
          ],
          structuredContent: result,
        };
      } catch (e) {
        return toolError(e instanceof PanelRunError ? e.message : `compare_to_competitor failed: ${errMsg(e)}`);
      }
    },
  );
}
