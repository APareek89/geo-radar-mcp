import { describe, it, expect } from "vitest";
import { MemoryStore } from "./memory-store";

describe("MemoryStore", () => {
  it("begins, finishes, and reads back a run", async () => {
    const store = new MemoryStore();
    const { runId, brandId } = await store.beginRun({
      brand: { name: "PixelBin" },
      competitors: [{ name: "Photoroom" }, { name: "Remove.bg" }],
      panel: ["haiku"],
    });
    expect(runId).toBeTruthy();
    expect(brandId).toBeTruthy();

    await store.finishRun(runId, {
      brandId,
      costUsd: 0,
      answers: [
        {
          model: "mock:haiku",
          prompt: "best background remover?",
          rawAnswer: "PixelBin and Photoroom are great.",
          mentions: ["PixelBin", "Photoroom"],
          citedDomains: ["pixelbin.com"],
          sentiment: "positive",
        },
      ],
      sov: 0.5,
      sentimentScore: 1,
      date: "2026-07-15",
    });

    const report = await store.getReport(runId);
    expect(report).not.toBeNull();
    expect(report!.run.status).toBe("completed");
    expect(report!.brand).toBe("PixelBin");
    expect(report!.competitors).toEqual(["Photoroom", "Remove.bg"]);
    expect(report!.answers).toHaveLength(1);
    expect(report!.answers[0]!.sentiment).toBe("positive");
  });

  it("marks a run failed with an error message", async () => {
    const store = new MemoryStore();
    const { runId } = await store.beginRun({
      brand: { name: "A" },
      competitors: [{ name: "B" }],
      panel: ["haiku"],
    });
    await store.failRun(runId, "cost cap exceeded");
    const report = await store.getReport(runId);
    expect(report!.run.status).toBe("failed");
    expect(report!.run.error).toBe("cost cap exceeded");
  });

  it("returns null for an unknown run", async () => {
    const store = new MemoryStore();
    expect(await store.getReport("nope")).toBeNull();
  });
});
