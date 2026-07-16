import type { ShareOfVoiceEntry, PerPromptEntry } from "@geo-radar/shared";

export interface ScoringAnswer {
  prompt: string;
  mentions: string[];
}

export interface ScoringInput {
  brand: string;
  competitors: string[];
  answers: ScoringAnswer[];
}

export interface ScoringResult {
  shareOfVoice: ShareOfVoiceEntry[];
  perPrompt: PerPromptEntry[];
  answerCount: number;
}

/**
 * Deterministic scoring.
 *
 * - `mentions[brand]` = number of answers that named the brand (one per answer).
 * - `sov[brand]` = mentions[brand] / total mentions across ALL tracked brands,
 *   so the shares sum to 1 (or all 0 when nothing was mentioned).
 * - per-prompt: which brands appeared, and the competitor mentioned most often
 *   for that prompt (the actionable "who beat you here").
 */
export function computeShareOfVoice(input: ScoringInput): ScoringResult {
  const tracked = [input.brand, ...input.competitors];
  const mentionCounts = new Map<string, number>(tracked.map((b) => [b, 0]));

  const byLower = new Map(tracked.map((b) => [b.toLowerCase(), b]));
  const countMention = (raw: string): string | null => byLower.get(raw.toLowerCase()) ?? null;

  for (const answer of input.answers) {
    // Count each tracked brand at most once per answer.
    const seen = new Set<string>();
    for (const m of answer.mentions) {
      const canonical = countMention(m);
      if (canonical && !seen.has(canonical)) {
        seen.add(canonical);
        mentionCounts.set(canonical, (mentionCounts.get(canonical) ?? 0) + 1);
      }
    }
  }

  const totalMentions = Array.from(mentionCounts.values()).reduce((a, b) => a + b, 0);
  const shareOfVoice: ShareOfVoiceEntry[] = tracked.map((brand) => {
    const mentions = mentionCounts.get(brand) ?? 0;
    return {
      brand,
      mentions,
      sov: totalMentions > 0 ? mentions / totalMentions : 0,
    };
  });

  // Group answers by prompt for the per-prompt breakdown.
  const promptGroups = new Map<string, ScoringAnswer[]>();
  for (const answer of input.answers) {
    const group = promptGroups.get(answer.prompt) ?? [];
    group.push(answer);
    promptGroups.set(answer.prompt, group);
  }

  const perPrompt: PerPromptEntry[] = [];
  for (const [prompt, group] of promptGroups) {
    const mentionedSet = new Set<string>();
    const compCounts = new Map<string, number>(input.competitors.map((c) => [c, 0]));
    for (const answer of group) {
      const seen = new Set<string>();
      for (const m of answer.mentions) {
        const canonical = countMention(m);
        if (!canonical || seen.has(canonical)) continue;
        seen.add(canonical);
        mentionedSet.add(canonical);
        if (compCounts.has(canonical)) {
          compCounts.set(canonical, (compCounts.get(canonical) ?? 0) + 1);
        }
      }
    }
    let topCompetitor: string | null = null;
    let topCount = 0;
    for (const [comp, count] of compCounts) {
      if (count > topCount) {
        topCount = count;
        topCompetitor = comp;
      }
    }
    perPrompt.push({
      prompt,
      mentioned_brands: Array.from(mentionedSet),
      top_competitor: topCount > 0 ? topCompetitor : null,
    });
  }

  return { shareOfVoice, perPrompt, answerCount: input.answers.length };
}
