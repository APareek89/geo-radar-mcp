import { describe, it, expect } from "vitest";
import { computeCitations, computeSentiment, type AnalysisAnswer } from "./analysis";

const A = (over: Partial<AnalysisAnswer>): AnalysisAnswer => ({
  prompt: "p",
  rawAnswer: "",
  citedDomains: [],
  sentiment: null,
  ...over,
});

describe("computeCitations", () => {
  it("splits your domains from others and finds the gap", () => {
    const r = computeCitations("rep1", "PixelBin", [
      A({ prompt: "p1", citedDomains: ["pixelbin.io", "photoroom.com"] }),
      A({ prompt: "p2", citedDomains: ["remove.bg", "clipdrop.co"] }), // no owned → gap
      A({ prompt: "p3", citedDomains: ["cdn.pixelbin.io"] }), // subdomain counts as yours
    ], ["pixelbin.io"]);

    expect(r.total_citations).toBe(5);
    expect(r.your_citations).toBe(2); // pixelbin.io + cdn.pixelbin.io
    expect(r.your_citation_share).toBeCloseTo(2 / 5);
    expect(r.competitor_gap.map((g) => g.prompt)).toEqual(["p2"]);
    expect(r.by_domain[0]!.count).toBeGreaterThan(0);
  });

  it("handles zero citations", () => {
    const r = computeCitations("rep", "B", [A({})], ["b.com"]);
    expect(r.total_citations).toBe(0);
    expect(r.your_citation_share).toBe(0);
  });
});

describe("computeSentiment", () => {
  it("computes distribution, score and representative quotes", () => {
    const r = computeSentiment("rep", "PixelBin", [
      A({ prompt: "p1", sentiment: "positive", rawAnswer: "PixelBin is excellent. Really good." }),
      A({ prompt: "p2", sentiment: "negative", rawAnswer: "It was poor overall." }),
      A({ prompt: "p3", sentiment: "neutral", rawAnswer: "It exists." }),
      A({ prompt: "p4", sentiment: null }),
    ]);
    expect(r.distribution).toEqual({ positive: 1, neutral: 1, negative: 1 });
    expect(r.sentiment_score).toBeCloseTo(0); // (1 + -1 + 0) / 3
    expect(r.quotes.length).toBeGreaterThanOrEqual(3);
    expect(r.quotes.some((q) => q.sentiment === "positive")).toBe(true);
  });

  it("returns null score when no sentiment present", () => {
    const r = computeSentiment("rep", "B", [A({})]);
    expect(r.sentiment_score).toBeNull();
  });
});
