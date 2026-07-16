export interface PromptSet {
  id: string;
  name: string;
  prompts: string[];
}

/**
 * Built-in buyer-intent prompt sets. Doubles as the `prompts://library` resource
 * (P3) and seeds the demo so a visitor sees value without configuring anything.
 */
export const BUILTIN_PROMPT_SETS: Record<string, PromptSet> = {
  demo: {
    id: "demo",
    name: "Image tools — buyer intent (demo)",
    prompts: [
      "What's the best background remover for e-commerce product photos?",
      "Which AI image upscaler gives the most natural-looking results?",
      "Recommend a tool to remove watermarks from images.",
      "Best API to resize and optimize images at scale for a website?",
    ],
  },
};

export function resolvePromptSet(id: string): PromptSet | null {
  return BUILTIN_PROMPT_SETS[id] ?? null;
}
