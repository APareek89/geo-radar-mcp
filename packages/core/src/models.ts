import type { PanelistId } from "@geo-radar/shared";

export type Provider = "anthropic" | "google" | "groq" | "perplexity";

export interface PanelistModel {
  provider: Provider;
  modelId: string;
  label: string;
  envKey: string;
}

/**
 * Panelist registry. v1 wires all four providers; each is used for real only when
 * its API key is present, otherwise the runner falls back to the deterministic mock.
 * Model ids are centralized here so they're easy to bump.
 */
export const PANELIST_MODELS: Record<PanelistId, PanelistModel> = {
  haiku: {
    provider: "anthropic",
    modelId: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    envKey: "ANTHROPIC_API_KEY",
  },
  gemini: {
    provider: "google",
    modelId: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    envKey: "GEMINI_API_KEY",
  },
  groq: {
    provider: "groq",
    modelId: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B (Groq)",
    envKey: "GROQ_API_KEY",
  },
  perplexity: {
    provider: "perplexity",
    modelId: "sonar",
    label: "Perplexity Sonar",
    envKey: "PERPLEXITY_API_KEY",
  },
};

/** Parser/scorer + hallucination checker model (always Anthropic Haiku). */
export const PARSER_MODEL_ID = "claude-haiku-4-5";

/**
 * Approximate pricing in USD per 1M tokens — used ONLY for the cost-cap guardrail,
 * so rough values are fine. Unknown/mock models contribute $0.
 */
export const MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  "claude-haiku-4-5": { inputPerM: 1.0, outputPerM: 5.0 },
  "gemini-2.0-flash": { inputPerM: 0.1, outputPerM: 0.4 },
  "llama-3.3-70b-versatile": { inputPerM: 0.59, outputPerM: 0.79 },
  sonar: { inputPerM: 1.0, outputPerM: 1.0 },
};

/** Rough per-call cost estimate (USD) used to abort BEFORE spending when near the cap. */
export const REAL_CALL_COST_ESTIMATE_USD = 0.01;

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Is the API key for this panelist's provider present in the environment? */
export function hasPanelistKey(id: PanelistId): boolean {
  return Boolean(process.env[PANELIST_MODELS[id].envKey]);
}

/** The upstream provider a panelist calls (rate-limit bucket key). */
export function providerFor(id: PanelistId): Provider {
  return PANELIST_MODELS[id].provider;
}

/** Provider the answer parser calls (Claude Haiku). */
export const PARSER_PROVIDER: Provider = "anthropic";
