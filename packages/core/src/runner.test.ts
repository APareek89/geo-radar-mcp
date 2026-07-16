import { describe, it, expect } from "vitest";
import { MemoryStore } from "@geo-radar/db";
import { InProcessPanelRunner } from "./runner";
import { buildReport } from "./report";
import { PanelRunError } from "./errors";

function makeRunner(costCapUsd = 1, estimatePerCallUsd?: number) {
  const store = new MemoryStore();
  const runner = new InProcessPanelRunner(store, { costCapUsd, forceMock: true, estimatePerCallUsd });
  return { store, runner };
}

describe("InProcessPanelRunner (mock pipeline)", () => {
  it("runs end-to-end and returns a report_id with valid share-of-voice", async () => {
    const { store, runner } = makeRunner();
    const report = await runner.run({
      brand: "PixelBin",
      competitors: ["Photoroom", "Remove.bg"],
      prompts: ["What's the best background remover?", "Best image upscaler?"],
      panel: ["haiku"],
      runs: 1,
    });

    expect(report.status).toBe("completed");
    expect(report.report_id).toBeTruthy();
    expect(report.panel).toEqual(["haiku"]);
    expect(report.prompt_count).toBe(2);
    expect(report.answer_count).toBe(2);
    expect(report.share_of_voice).toHaveLength(3);
    // Every SoV value is a probability, and they sum to ~1 (mock always mentions ≥1 brand).
    for (const e of report.share_of_voice) {
      expect(e.sov).toBeGreaterThanOrEqual(0);
      expect(e.sov).toBeLessThanOrEqual(1);
    }
    const sum = report.share_of_voice.reduce((a, e) => a + e.sov, 0);
    expect(sum).toBeCloseTo(1);

    // The stored report is retrievable and consistent.
    const fetched = await buildReport(store, report.report_id);
    expect(fetched?.status).toBe("completed");
    expect(fetched?.answers).toHaveLength(2);
    expect(fetched?.brand).toBe("PixelBin");
  });

  it("rejects an unknown prompt_set_id", async () => {
    const { runner } = makeRunner();
    await expect(
      runner.run({ brand: "A", competitors: ["B"], prompt_set_id: "nope" }),
    ).rejects.toMatchObject({ code: "no_prompts" });
  });

  it("runs a multi-provider panel in mock mode (gemini/groq now registered)", async () => {
    const { runner } = makeRunner();
    const report = await runner.run({
      brand: "A",
      competitors: ["B"],
      prompts: ["x"],
      panel: ["haiku", "gemini", "groq"],
    });
    // 1 prompt × 3 panelists × 1 run = 3 answers
    expect(report.answer_count).toBe(3);
    expect(report.panel).toEqual(["haiku", "gemini", "groq"]);
  });

  it("rejects an unknown panelist id", async () => {
    const { runner } = makeRunner();
    await expect(
      // @ts-expect-error — bypass the schema enum to hit the runner's own guard
      runner.run({ brand: "A", competitors: ["B"], prompts: ["x"], panel: ["gpt4"] }),
    ).rejects.toBeInstanceOf(PanelRunError);
  });

  it("enforces the cost cap before spending and marks the run failed", async () => {
    // estimatePerCallUsd forces a nonzero projection even in mock mode.
    const { store, runner } = makeRunner(0.5, 1);
    let thrown: unknown;
    try {
      await runner.run({ brand: "A", competitors: ["B"], prompts: ["x"], panel: ["haiku"] });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PanelRunError);
    expect((thrown as PanelRunError).code).toBe("cost_cap_exceeded");
  });

  it("rejects a workload that exceeds the call ceiling", async () => {
    const { runner } = makeRunner();
    const prompts = Array.from({ length: 50 }, (_, i) => `p${i}`);
    await expect(
      runner.run({ brand: "A", competitors: ["B"], prompts, panel: ["haiku", "gemini", "groq", "perplexity"], runs: 5 }),
    ).rejects.toMatchObject({ code: "workload_too_large" });
  });

  it("resolves the built-in demo prompt set", async () => {
    const { runner } = makeRunner();
    const report = await runner.run({
      brand: "PixelBin",
      competitors: ["Photoroom"],
      prompt_set_id: "demo",
      panel: ["haiku"],
    });
    expect(report.prompt_count).toBe(4);
    expect(report.answer_count).toBe(4);
  });
});
