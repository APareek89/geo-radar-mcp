import { describe, it, expect } from "vitest";
import { computeShareOfVoice } from "./scoring";

describe("computeShareOfVoice", () => {
  it("computes share-of-voice as a brand's mentions over all tracked mentions", () => {
    const result = computeShareOfVoice({
      brand: "A",
      competitors: ["B", "C"],
      answers: [
        { prompt: "p1", mentions: ["A", "B"] },
        { prompt: "p2", mentions: ["B"] },
        { prompt: "p3", mentions: ["C"] },
      ],
    });

    const sov = Object.fromEntries(result.shareOfVoice.map((e) => [e.brand, e]));
    expect(sov.A!.mentions).toBe(1);
    expect(sov.B!.mentions).toBe(2);
    expect(sov.C!.mentions).toBe(1);
    // Total mentions = 4 → shares sum to 1.
    expect(sov.A!.sov).toBeCloseTo(0.25);
    expect(sov.B!.sov).toBeCloseTo(0.5);
    expect(sov.C!.sov).toBeCloseTo(0.25);
    const sum = result.shareOfVoice.reduce((a, e) => a + e.sov, 0);
    expect(sum).toBeCloseTo(1);
  });

  it("names the top competitor per prompt and handles zero mentions", () => {
    const result = computeShareOfVoice({
      brand: "A",
      competitors: ["B", "C"],
      answers: [
        { prompt: "p1", mentions: ["B"] },
        { prompt: "p1", mentions: ["B", "C"] },
        { prompt: "p2", mentions: [] },
      ],
    });
    const p1 = result.perPrompt.find((p) => p.prompt === "p1")!;
    expect(p1.top_competitor).toBe("B"); // B appears in both p1 answers
    const p2 = result.perPrompt.find((p) => p.prompt === "p2")!;
    expect(p2.mentioned_brands).toEqual([]);
    expect(p2.top_competitor).toBeNull();
  });

  it("counts a brand at most once per answer and is case-insensitive", () => {
    const result = computeShareOfVoice({
      brand: "PixelBin",
      competitors: ["Photoroom"],
      answers: [{ prompt: "p", mentions: ["pixelbin", "PIXELBIN", "Photoroom"] }],
    });
    const sov = Object.fromEntries(result.shareOfVoice.map((e) => [e.brand, e]));
    expect(sov.PixelBin!.mentions).toBe(1);
    expect(sov.Photoroom!.mentions).toBe(1);
  });
});
