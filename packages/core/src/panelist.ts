import { generateText } from "ai";
import type { PanelistId } from "@geo-radar/shared";
import { panelistModel } from "./providers";
import { PANELIST_MODELS } from "./models";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface PanelAnswer {
  model: string;
  text: string;
  usage: TokenUsage;
}

/** A single "AI search panelist" — asks a buyer-intent prompt, returns an answer. */
export interface Panelist {
  id: string;
  modelId: string;
  ask(prompt: string): Promise<PanelAnswer>;
}

const PANELIST_SYSTEM =
  "You are an AI search assistant. Answer the user's question helpfully and concisely. " +
  "Recommend specific products, brands, or companies by name, and where relevant mention the " +
  "websites you would cite.";

function normalizeUsage(u: { inputTokens?: number; outputTokens?: number } | undefined): TokenUsage {
  return { inputTokens: u?.inputTokens ?? 0, outputTokens: u?.outputTokens ?? 0 };
}

/** Real panelist backed by any registered provider (Anthropic/Gemini/Groq/Perplexity). */
export function createRealPanelist(id: PanelistId): Panelist {
  const { modelId } = PANELIST_MODELS[id];
  return {
    id,
    modelId,
    async ask(prompt: string): Promise<PanelAnswer> {
      const res = await generateText({
        model: panelistModel(id),
        system: PANELIST_SYSTEM,
        prompt,
        maxOutputTokens: 600,
      });
      return { model: modelId, text: res.text, usage: normalizeUsage(res.usage) };
    },
  };
}

/**
 * Deterministic mock panelist for offline tests / no-key local dev. It writes an
 * answer that names a subset of the tracked brands (plus fake domains) based on a
 * stable hash of the prompt, so the parser + scorer have real signal to work on.
 */
export function createMockPanelist(id: string, brand: string, competitors: string[]): Panelist {
  const pool = [brand, ...competitors];
  return {
    id,
    modelId: `mock:${id}`,
    async ask(prompt: string): Promise<PanelAnswer> {
      const h = hashString(`${prompt}::${id}`);
      // Always mention at least one brand; include others by hash bits.
      const mentioned = pool.filter((_, i) => i === h % pool.length || ((h >> i) & 1) === 1);
      const picks = mentioned.length > 0 ? mentioned : [pool[0]!];
      const cites = picks
        .map((m) => `${m} (${m.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com)`)
        .join(", ");
      const text = `For "${prompt}", strong options I'd recommend include ${cites}. These are great, reliable choices.`;
      return { model: `mock:${id}`, text, usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
