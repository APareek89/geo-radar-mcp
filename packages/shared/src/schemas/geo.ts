import { z } from "zod";

/**
 * Domain + tool-I/O schemas for the GEO measurement pipeline. These live in the
 * shared package so the MCP server (validation + JSON Schema), the core pipeline,
 * and tests all agree on exactly one definition.
 */

// The panelist ids the schema advertises. Only "haiku" is wired up in P2; the
// others are accepted by the schema and rejected by the runner with a clear
// "not enabled yet" message until P5.
export const PanelistIdSchema = z.enum(["haiku", "gemini", "groq", "perplexity"]);
export type PanelistId = z.infer<typeof PanelistIdSchema>;

export const SentimentSchema = z.enum(["positive", "neutral", "negative"]);
export type Sentiment = z.infer<typeof SentimentSchema>;

/** What the parser extracts from a single raw AI answer. */
export const ParsedAnswerSchema = z.object({
  mentions: z.array(z.string()).describe("Tracked brands (brand or a competitor) named in the answer."),
  cited_domains: z.array(z.string()).describe("Domains/URLs the answer cited."),
  sentiment: SentimentSchema.describe("Sentiment toward the primary brand when mentioned."),
});
export type ParsedAnswer = z.infer<typeof ParsedAnswerSchema>;

// ── measure_share_of_voice ───────────────────────────────────────────────────
// The raw object (its `.shape` feeds the MCP SDK / JSON Schema). The cross-field
// "prompts OR prompt_set_id" rule can't live in a raw shape, so it's applied in the
// refined schema below and also enforced by the runner.
export const MeasureShareOfVoiceInputObject = z.object({
  brand: z.string().min(1).describe("The brand to measure (e.g. \"PixelBin\")."),
  brand_domains: z
    .array(z.string())
    .optional()
    .describe("Optional domains you own, used for citation matching later."),
  competitors: z
    .array(z.string().min(1))
    .min(1)
    .max(20)
    .describe("Named competitor brands to compare share-of-voice against."),
  prompts: z
    .array(z.string().min(1))
    .max(50)
    .optional()
    .describe("Buyer-intent prompts to ask the panel. Provide this OR prompt_set_id."),
  prompt_set_id: z
    .string()
    .optional()
    .describe("Id of a built-in prompt set (e.g. \"demo\"). Provide this OR prompts."),
  panel: z
    .array(PanelistIdSchema)
    .optional()
    .describe("Panelist models to query. Defaults to [\"haiku\"]. (Only haiku is enabled in v1.)"),
  runs: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("How many times to ask each prompt (repeats reduce noise). Default 1."),
});

export const MeasureShareOfVoiceInputSchema = MeasureShareOfVoiceInputObject.refine(
  (v) => (v.prompts && v.prompts.length > 0) || Boolean(v.prompt_set_id),
  { message: "Provide either `prompts` (non-empty) or `prompt_set_id`." },
);
export type MeasureShareOfVoiceInput = z.infer<typeof MeasureShareOfVoiceInputSchema>;

export const ShareOfVoiceEntrySchema = z.object({
  brand: z.string(),
  mentions: z.number().describe("Answers that mentioned this brand."),
  sov: z.number().describe("Share of voice in [0,1] — this brand's mentions / all tracked mentions."),
});
export type ShareOfVoiceEntry = z.infer<typeof ShareOfVoiceEntrySchema>;

export const PerPromptEntrySchema = z.object({
  prompt: z.string(),
  mentioned_brands: z.array(z.string()),
  top_competitor: z.string().nullable(),
});
export type PerPromptEntry = z.infer<typeof PerPromptEntrySchema>;

export const MeasureShareOfVoiceOutputSchema = z.object({
  report_id: z.string().describe("Handle to retrieve the full report via get_report."),
  brand: z.string(),
  status: z
    .enum(["queued", "completed"])
    .describe(
      "\"completed\" (in-process run, results below) or \"queued\" (a worker is running it; " +
        "poll get_report(report_id) until status is completed).",
    ),
  panel: z.array(z.string()),
  prompt_count: z.number(),
  answer_count: z.number(),
  share_of_voice: z.array(ShareOfVoiceEntrySchema),
  per_prompt: z.array(PerPromptEntrySchema),
  cost_usd: z.number().describe("Estimated USD spent on the panel run (0 while queued)."),
  created_at: z.string(),
});
export type MeasureShareOfVoiceOutput = z.infer<typeof MeasureShareOfVoiceOutputSchema>;

// ── get_report ───────────────────────────────────────────────────────────────
export const GetReportInputSchema = z.object({
  report_id: z.string().min(1).describe("The report_id returned by a measurement tool."),
});
export type GetReportInput = z.infer<typeof GetReportInputSchema>;

export const ReportAnswerSchema = z.object({
  model: z.string(),
  prompt: z.string(),
  mentions: z.array(z.string()),
  cited_domains: z.array(z.string()),
  sentiment: SentimentSchema.nullable(),
});
export type ReportAnswer = z.infer<typeof ReportAnswerSchema>;

export const GetReportOutputSchema = z.object({
  report_id: z.string(),
  status: z.string().describe("queued | running | completed | failed"),
  brand: z.string(),
  panel: z.array(z.string()),
  cost_usd: z.number(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  error: z.string().nullable(),
  share_of_voice: z.array(ShareOfVoiceEntrySchema),
  per_prompt: z.array(PerPromptEntrySchema),
  answers: z.array(ReportAnswerSchema),
});
export type GetReportOutput = z.infer<typeof GetReportOutputSchema>;
