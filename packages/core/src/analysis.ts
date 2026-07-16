import type {
  TrackCitationsOutput,
  SentimentScanOutput,
  Sentiment,
} from "@geo-radar/shared";

export interface AnalysisAnswer {
  prompt: string;
  rawAnswer: string;
  citedDomains: string[];
  sentiment: Sentiment | null;
}

/** Classify cited domains as yours vs others and compute citation share. */
export function computeCitations(
  reportId: string,
  brand: string,
  answers: AnalysisAnswer[],
  brandDomains: string[],
): TrackCitationsOutput {
  const owned = brandDomains.map((d) => d.toLowerCase().replace(/^www\./, ""));
  const isYours = (domain: string): boolean => {
    const d = domain.toLowerCase().replace(/^www\./, "");
    return owned.some((o) => d === o || d.endsWith(`.${o}`));
  };

  const counts = new Map<string, { count: number; isYours: boolean }>();
  let total = 0;
  let yours = 0;
  const gap: { prompt: string; cited_domains: string[] }[] = [];

  for (const a of answers) {
    const domains = dedupe(a.citedDomains.map((d) => d.toLowerCase()));
    let citedYours = false;
    for (const domain of domains) {
      const mine = isYours(domain);
      total += 1;
      if (mine) {
        yours += 1;
        citedYours = true;
      }
      const entry = counts.get(domain) ?? { count: 0, isYours: mine };
      entry.count += 1;
      counts.set(domain, entry);
    }
    if (domains.length > 0 && !citedYours) {
      gap.push({ prompt: a.prompt, cited_domains: domains });
    }
  }

  const by_domain = Array.from(counts.entries())
    .map(([domain, v]) => ({ domain, count: v.count, is_yours: v.isYours }))
    .sort((a, b) => b.count - a.count);

  return {
    report_id: reportId,
    brand,
    total_citations: total,
    your_citations: yours,
    your_citation_share: total > 0 ? yours / total : 0,
    by_domain,
    competitor_gap: gap,
  };
}

/** Sentiment distribution + representative quotes. */
export function computeSentiment(
  reportId: string,
  brand: string,
  answers: AnalysisAnswer[],
): SentimentScanOutput {
  const distribution = { positive: 0, neutral: 0, negative: 0 };
  const values: number[] = [];
  const quotesBySentiment: Record<Sentiment, SentimentScanOutput["quotes"]> = {
    positive: [],
    neutral: [],
    negative: [],
  };

  for (const a of answers) {
    if (!a.sentiment) continue;
    distribution[a.sentiment] += 1;
    values.push(a.sentiment === "positive" ? 1 : a.sentiment === "negative" ? -1 : 0);
    if (quotesBySentiment[a.sentiment].length < 2) {
      quotesBySentiment[a.sentiment].push({
        sentiment: a.sentiment,
        prompt: a.prompt,
        quote: firstSentence(a.rawAnswer),
      });
    }
  }

  const sentiment_score =
    values.length > 0 ? round4(values.reduce((x, y) => x + y, 0) / values.length) : null;

  return {
    report_id: reportId,
    brand,
    distribution,
    sentiment_score,
    quotes: [
      ...quotesBySentiment.positive,
      ...quotesBySentiment.neutral,
      ...quotesBySentiment.negative,
    ],
  };
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const cut = trimmed.slice(0, 200);
  const period = cut.indexOf(". ");
  return (period > 30 ? cut.slice(0, period + 1) : cut).trim();
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
