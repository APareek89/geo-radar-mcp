import { z } from "zod";
import { PanelistIdSchema, SentimentSchema, ShareOfVoiceEntrySchema } from "./geo";

/**
 * Tool I/O for the P3/P4 analysis tools. Three of them (track_citations,
 * sentiment_scan, detect_hallucinations) slice an EXISTING report by `report_id`
 * — you run measure_share_of_voice once, then analyze it many ways for free.
 * compare_to_competitor runs its own fresh head-to-head panel.
 */

// ── track_citations ──────────────────────────────────────────────────────────
export const TrackCitationsInputObject = z.object({
  report_id: z.string().min(1).describe("A report_id from measure_share_of_voice to analyze."),
  brand_domains: z
    .array(z.string())
    .optional()
    .describe("Your domains (e.g. [\"pixelbin.io\"]). Defaults to the brand's stored domains."),
});
export const CitedDomainEntrySchema = z.object({
  domain: z.string(),
  count: z.number(),
  is_yours: z.boolean(),
});
export const CitationGapSchema = z.object({
  prompt: z.string(),
  cited_domains: z.array(z.string()),
});
export const TrackCitationsOutputSchema = z.object({
  report_id: z.string(),
  brand: z.string(),
  total_citations: z.number(),
  your_citations: z.number(),
  your_citation_share: z.number().describe("your_citations / total_citations, in [0,1]."),
  by_domain: z.array(CitedDomainEntrySchema),
  competitor_gap: z
    .array(CitationGapSchema)
    .describe("Answers that cited domains but NOT one of yours — the actionable gap."),
});
export type TrackCitationsInput = z.infer<typeof TrackCitationsInputObject>;
export type TrackCitationsOutput = z.infer<typeof TrackCitationsOutputSchema>;

// ── sentiment_scan ───────────────────────────────────────────────────────────
export const SentimentScanInputObject = z.object({
  report_id: z.string().min(1).describe("A report_id from measure_share_of_voice to analyze."),
});
export const SentimentQuoteSchema = z.object({
  sentiment: SentimentSchema,
  prompt: z.string(),
  quote: z.string(),
});
export const SentimentScanOutputSchema = z.object({
  report_id: z.string(),
  brand: z.string(),
  distribution: z.object({
    positive: z.number(),
    neutral: z.number(),
    negative: z.number(),
  }),
  sentiment_score: z.number().nullable().describe("Mean of +1/0/-1 over answers, or null."),
  quotes: z.array(SentimentQuoteSchema).describe("Representative quotes per sentiment."),
});
export type SentimentScanInput = z.infer<typeof SentimentScanInputObject>;
export type SentimentScanOutput = z.infer<typeof SentimentScanOutputSchema>;

// ── detect_hallucinations ────────────────────────────────────────────────────
export const DetectHallucinationsInputObject = z.object({
  report_id: z.string().min(1).describe("A report_id from measure_share_of_voice to analyze."),
  facts: z
    .array(z.string().min(1))
    .min(1)
    .max(30)
    .describe("Ground-truth statements about your brand to check answers against."),
});
export const HallucinationFlagSchema = z.object({
  claim: z.string().describe("The false/outdated statement found in an answer."),
  contradicts_fact: z.string().describe("Which provided fact it contradicts."),
  severity: z.enum(["low", "medium", "high"]),
  model: z.string(),
  prompt: z.string(),
});
export const DetectHallucinationsOutputSchema = z.object({
  report_id: z.string(),
  brand: z.string(),
  checked_answers: z.number(),
  flagged: z.array(HallucinationFlagSchema),
});
export type DetectHallucinationsInput = z.infer<typeof DetectHallucinationsInputObject>;
export type DetectHallucinationsOutput = z.infer<typeof DetectHallucinationsOutputSchema>;

// ── compare_to_competitor ────────────────────────────────────────────────────
export const CompareToCompetitorInputObject = z.object({
  brand_a: z.string().min(1),
  brand_b: z.string().min(1),
  prompts: z.array(z.string().min(1)).max(50).optional(),
  prompt_set_id: z.string().optional(),
  panel: z.array(PanelistIdSchema).optional(),
  runs: z.number().int().min(1).max(5).optional(),
});
export const CompareToCompetitorOutputSchema = z.object({
  report_id: z.string(),
  brand_a: z.string(),
  brand_b: z.string(),
  share_of_voice: z.array(ShareOfVoiceEntrySchema),
  citation_share: z.object({
    brand_a: z.number(),
    brand_b: z.number(),
  }),
  sentiment_score: z.object({
    brand_a: z.number().nullable(),
    brand_b: z.number().nullable(),
  }),
  winner: z.string().nullable().describe("The brand with higher share of voice, or null if tied."),
});
export type CompareToCompetitorInput = z.infer<typeof CompareToCompetitorInputObject>;
export type CompareToCompetitorOutput = z.infer<typeof CompareToCompetitorOutputSchema>;

// ── history://sov resource payload ───────────────────────────────────────────
export const SovHistoryPointSchema = z.object({
  date: z.string(),
  sov: z.number(),
  sentiment_score: z.number().nullable(),
});
export type SovHistoryPoint = z.infer<typeof SovHistoryPointSchema>;

// ── attribute_ai_traffic (GA4) ───────────────────────────────────────────────
export const AttributeAiTrafficInputObject = z.object({
  ga4_property_id: z
    .string()
    .optional()
    .describe("GA4 property id (numeric). Defaults to GA4_PROPERTY_ID env."),
  start_date: z.string().optional().describe("YYYY-MM-DD or GA4 relative (e.g. 28daysAgo). Default 28daysAgo."),
  end_date: z.string().optional().describe("YYYY-MM-DD or 'today'. Default today."),
});
export const AiTrafficRowSchema = z.object({
  engine: z.string(),
  source: z.string(),
  sessions: z.number(),
  conversions: z.number(),
});
export const AttributeAiTrafficOutputSchema = z.object({
  property_id: z.string(),
  date_range: z.object({ start: z.string(), end: z.string() }),
  by_engine: z.array(AiTrafficRowSchema),
  total_ai_sessions: z.number(),
  total_ai_conversions: z.number(),
});
export type AttributeAiTrafficInput = z.infer<typeof AttributeAiTrafficInputObject>;
export type AttributeAiTrafficOutput = z.infer<typeof AttributeAiTrafficOutputSchema>;
