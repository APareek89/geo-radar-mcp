import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createPerplexity } from "@ai-sdk/perplexity";
import type { LanguageModel } from "ai";
import type { PanelistId } from "@geo-radar/shared";
import { PANELIST_MODELS } from "./models";

/**
 * Lazy provider construction (Vercel AI SDK). Providers are only built on first
 * use, so mock mode / tests never touch an API key. One unified interface across
 * Anthropic, Gemini, Groq, and Perplexity — adding a panelist is a registry entry.
 */
const cache: Partial<Record<string, LanguageModel>> = {};

export function panelistModel(id: PanelistId): LanguageModel {
  const cached = cache[id];
  if (cached) return cached;
  const { provider, modelId } = PANELIST_MODELS[id];
  let model: LanguageModel;
  switch (provider) {
    case "anthropic":
      model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(modelId);
      break;
    case "google":
      model = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })(modelId);
      break;
    case "groq":
      model = createGroq({ apiKey: process.env.GROQ_API_KEY })(modelId);
      break;
    case "perplexity":
      model = createPerplexity({ apiKey: process.env.PERPLEXITY_API_KEY })(modelId);
      break;
  }
  cache[id] = model;
  return model;
}

let anthropicProvider: ReturnType<typeof createAnthropic> | null = null;

/** The Anthropic model used for parsing/scoring/hallucination checks. */
export function anthropicModel(modelId: string): LanguageModel {
  if (!anthropicProvider) {
    anthropicProvider = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicProvider(modelId);
}
