import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";
import type { DbHandle } from "./client";
import { DrizzleStore } from "./drizzle-store";

/**
 * Exercises the REAL DrizzleStore SQL against an embedded Postgres (pglite) — no
 * Docker, no network. pglite is PG16-compatible, so gen_random_uuid(), text[],
 * timestamps and the generated migration all run exactly as they would in prod.
 */

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

let client: PGlite;
let store: DrizzleStore;

beforeAll(async () => {
  client = new PGlite(); // in-memory
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  const handle: DbHandle = { db, close: () => client.close() };
  store = new DrizzleStore(handle);
});

afterAll(async () => {
  await store.close();
});

describe("DrizzleStore (pglite / real Postgres SQL)", () => {
  it("persists a run and reads it back with brand + competitors + answers", async () => {
    const { runId, brandId } = await store.beginRun({
      brand: { name: "PixelBin", domains: ["pixelbin.io"] },
      competitors: [{ name: "Photoroom" }, { name: "Remove.bg" }],
      panel: ["haiku"],
    });
    expect(runId).toBeTruthy();
    expect(brandId).toBeTruthy();

    await store.finishRun(runId, {
      brandId,
      costUsd: 0.0123,
      answers: [
        {
          model: "claude-haiku-4-5",
          prompt: "best background remover?",
          rawAnswer: "PixelBin and Photoroom are strong choices.",
          mentions: ["PixelBin", "Photoroom"],
          citedDomains: ["pixelbin.io", "photoroom.com"],
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
    expect(report!.run.costUsd).toBeCloseTo(0.0123);
    expect(report!.brand).toBe("PixelBin");
    expect(report!.competitors.sort()).toEqual(["Photoroom", "Remove.bg"]);
    expect(report!.answers).toHaveLength(1);
    expect(report!.answers[0]!.mentions).toEqual(["PixelBin", "Photoroom"]);
    expect(report!.answers[0]!.citedDomains).toEqual(["pixelbin.io", "photoroom.com"]);
    expect(report!.answers[0]!.sentiment).toBe("positive");
  });

  it("reuses the same brand row across runs (so sov_history accumulates)", async () => {
    const first = await store.beginRun({
      brand: { name: "AcmeBrand" },
      competitors: [{ name: "Rival" }],
      panel: ["haiku"],
    });
    const second = await store.beginRun({
      brand: { name: "AcmeBrand" },
      competitors: [{ name: "Rival" }],
      panel: ["haiku"],
    });
    expect(second.brandId).toBe(first.brandId);
    expect(second.runId).not.toBe(first.runId);
  });

  it("marks a run failed", async () => {
    const { runId } = await store.beginRun({
      brand: { name: "X" },
      competitors: [{ name: "Y" }],
      panel: ["haiku"],
    });
    await store.failRun(runId, "provider error");
    const report = await store.getReport(runId);
    expect(report!.run.status).toBe("failed");
    expect(report!.run.error).toBe("provider error");
  });

  it("returns null for an unknown run id", async () => {
    expect(await store.getReport("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
