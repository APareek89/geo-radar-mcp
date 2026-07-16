import { generateObject } from "ai";
import { z } from "zod";
import type { Sentiment } from "@geo-radar/shared";
import { anthropicModel } from "./providers";
import { PARSER_MODEL_ID } from "./models";
import type { TokenUsage } from "./panelist";

export interface ParseContext {
  brand: string;
  competitors: string[];
}

export interface ParsedResult {
  mentions: string[];
  citedDomains: string[];
  sentiment: Sentiment;
  usage: TokenUsage;
}

/** Turns a raw AI answer into structured mentions/citations/sentiment. */
export interface Parser {
  parse(answer: string, ctx: ParseContext): Promise<ParsedResult>;
}

const ParseObjectSchema = z.object({
  mentioned_brands: z
    .array(z.string())
    .describe("Which of the candidate brands are mentioned. Use candidate spellings exactly."),
  cited_domains: z.array(z.string()).describe("Any domains or website URLs cited in the answer."),
  sentiment: z
    .enum(["positive", "neutral", "negative"])
    .describe("Sentiment toward the PRIMARY brand when it is mentioned; neutral if absent."),
});

/** Real parser using an Anthropic model with structured output. */
export function createAnthropicParser(): Parser {
  return {
    async parse(answer: string, ctx: ParseContext): Promise<ParsedResult> {
      const candidates = [ctx.brand, ...ctx.competitors];
      const res = await generateObject({
        model: anthropicModel(PARSER_MODEL_ID),
        schema: ParseObjectSchema,
        system:
          "You extract structured data from an AI assistant's answer. Only report brands from " +
          "the provided candidate list. Do not invent brands or domains.",
        prompt:
          `Primary brand: ${ctx.brand}\n` +
          `Candidate brands: ${candidates.join(", ")}\n\n` +
          `Answer to analyze:\n"""${answer}"""`,
        maxOutputTokens: 400,
      });
      const usage: TokenUsage = {
        inputTokens: res.usage?.inputTokens ?? 0,
        outputTokens: res.usage?.outputTokens ?? 0,
      };
      // Guard against the model naming brands outside the candidate list.
      const allowed = new Set(candidates.map((c) => c.toLowerCase()));
      const mentions = res.object.mentioned_brands.filter((m) => allowed.has(m.toLowerCase()));
      return {
        mentions: canonicalize(mentions, candidates),
        citedDomains: dedupe(res.object.cited_domains.map((d) => d.toLowerCase())),
        sentiment: res.object.sentiment,
        usage,
      };
    },
  };
}

/**
 * Deterministic parser: matches candidate brand names in the text, extracts
 * domain-shaped tokens, and applies a keyword-based sentiment. No LLM — used for
 * mock-mode tests and as a dependable fallback.
 */
export function createDeterministicParser(): Parser {
  const POSITIVE = /\b(best|great|excellent|love|recommend|top|reliable|leading)\b/i;
  const NEGATIVE = /\b(bad|poor|worst|avoid|terrible|unreliable|scam)\b/i;
  const DOMAIN = /\b[a-z0-9-]+(?:\.[a-z]{2,})+\b/gi;

  return {
    async parse(answer: string, ctx: ParseContext): Promise<ParsedResult> {
      const candidates = [ctx.brand, ...ctx.competitors];
      const lower = answer.toLowerCase();
      const mentions = candidates.filter((c) => lower.includes(c.toLowerCase()));
      const citedDomains = dedupe((answer.match(DOMAIN) ?? []).map((d) => d.toLowerCase()));
      const sentiment: Sentiment = POSITIVE.test(answer)
        ? "positive"
        : NEGATIVE.test(answer)
          ? "negative"
          : "neutral";
      return {
        mentions,
        citedDomains,
        sentiment,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

/** Map matched names back to their canonical candidate spelling. */
function canonicalize(matched: string[], candidates: string[]): string[] {
  const byLower = new Map(candidates.map((c) => [c.toLowerCase(), c]));
  return dedupe(matched.map((m) => byLower.get(m.toLowerCase()) ?? m));
}
