import { describe, it, expect } from "vitest";
import type { MeasureShareOfVoiceInput } from "@geo-radar/shared";
import { MemoryStore } from "@geo-radar/db";
import { InProcessPanelRunner, planRun, beginRunParams } from "./runner";
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

  // Fire-and-forget: the queue path pre-creates the run row, then the worker finishes
  // THAT run rather than beginning a new one. Simulate it with the existingRun arg.
  it("finishes a pre-created run instead of beginning a new one (existingRun)", async () => {
    const store = new MemoryStore();
    const runner = new InProcessPanelRunner(store, { costCapUsd: 1, forceMock: true });
    const input: MeasureShareOfVoiceInput = {
      brand: "PixelBin",
      competitors: ["Photoroom"],
      prompts: ["x"],
      panel: ["haiku"],
    };

    // Web tier pre-creates the run row and hands the client this id (measure returns
    // status "queued"; the row itself is non-terminal until the worker completes it).
    const { panel } = planRun(input);
    const pre = await store.beginRun(beginRunParams(input, panel));
    const pending = await buildReport(store, pre.runId);
    expect(pending?.status).not.toBe("completed");

    // Worker finishes the SAME run.
    const report = await runner.run(input, pre);
    expect(report.report_id).toBe(pre.runId);
    expect(report.status).toBe("completed");

    const finished = await buildReport(store, pre.runId);
    expect(finished?.status).toBe("completed");
    expect(finished?.answers).toHaveLength(1);
  });
});

describe("planRun", () => {
  it("returns resolved prompts/panel/runs for a valid input", () => {
    const input: MeasureShareOfVoiceInput = {
      brand: "A",
      competitors: ["B"],
      prompts: ["x", "y"],
      panel: ["haiku"],
      runs: 2,
    };
    expect(planRun(input)).toEqual({ prompts: ["x", "y"], panel: ["haiku"], runs: 2 });
  });

  it("defaults the panel to [haiku] and throws on an oversized workload", () => {
    expect(planRun({ brand: "A", competitors: ["B"], prompts: ["x"] }).panel).toEqual(["haiku"]);
    const prompts = Array.from({ length: 300 }, (_, i) => `p${i}`);
    expect(() => planRun({ brand: "A", competitors: ["B"], prompts })).toThrow(PanelRunError);
  });
});
