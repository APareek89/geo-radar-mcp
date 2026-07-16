import { generateObject } from "ai";
import { z } from "zod";
import { anthropicModel } from "./providers";
import { PARSER_MODEL_ID } from "./models";
import type { TokenUsage } from "./panelist";

export interface FactFlag {
  claim: string;
  contradicts_fact: string;
  severity: "low" | "medium" | "high";
}

export interface FactCheckResult {
  flags: FactFlag[];
  usage: TokenUsage;
}

/** Checks one AI answer against a ground-truth facts list for false/outdated claims. */
export interface FactChecker {
  check(answer: string, brand: string, facts: string[]): Promise<FactCheckResult>;
}

const FactCheckSchema = z.object({
  flags: z.array(
    z.object({
      claim: z.string().describe("The specific false or outdated statement about the brand."),
      contradicts_fact: z.string().describe("Which provided fact this contradicts (verbatim)."),
      severity: z.enum(["low", "medium", "high"]),
    }),
  ),
});

/** Real fact-checker (Anthropic Haiku, structured output). */
export function createAnthropicFactChecker(): FactChecker {
  return {
    async check(answer: string, brand: string, facts: string[]): Promise<FactCheckResult> {
      const res = await generateObject({
        model: anthropicModel(PARSER_MODEL_ID),
        schema: FactCheckSchema,
        system:
          "You detect hallucinations: statements about a specific brand that are false or outdated " +
          "according to a provided ground-truth facts list. Only flag clear contradictions of a listed " +
          "fact. If nothing contradicts, return an empty list. Never invent claims.",
        prompt:
          `Brand: ${brand}\n` +
          `Ground-truth facts:\n${facts.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\n` +
          `AI answer to check:\n"""${answer}"""`,
        maxOutputTokens: 500,
      });
      return {
        flags: res.object.flags,
        usage: {
          inputTokens: res.usage?.inputTokens ?? 0,
          outputTokens: res.usage?.outputTokens ?? 0,
        },
      };
    },
  };
}

/**
 * Deterministic fact-checker for offline/mock mode: flags a fact as contradicted
 * only if the answer literally contains the negation pattern "not <fact-keyword>".
 * Intentionally conservative — real detection needs the LLM checker.
 */
export function createDeterministicFactChecker(): FactChecker {
  return {
    async check(answer: string, _brand: string, _facts: string[]): Promise<FactCheckResult> {
      // Mock answers are neutral/templated, so there is nothing to contradict.
      return { flags: [], usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
}
