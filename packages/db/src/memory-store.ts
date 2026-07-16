import { randomUUID } from "node:crypto";
import type { Sentiment } from "@geo-radar/shared";
import type {
  BeginRunParams,
  BeginRunResult,
  FinishRunParams,
  GeoStore,
  PersistedAnswer,
  SovPoint,
  StoredBrand,
  StoredReport,
  StoredRun,
} from "./store";

interface RunRecord extends StoredRun {
  brand: string;
  brandDomains: string[];
  competitors: string[];
  answers: PersistedAnswer[];
}

/**
 * In-memory GeoStore for tests and for local dev without Postgres. Same behavior
 * as DrizzleStore, minus persistence across process restarts.
 */
export class MemoryStore implements GeoStore {
  private runs = new Map<string, RunRecord>();
  private brandIdByName = new Map<string, string>();
  private sov: { brand: string; date: string; sov: number; sentimentScore: number | null }[] = [];

  async beginRun(params: BeginRunParams): Promise<BeginRunResult> {
    const runId = randomUUID();
    // Reuse a stable brandId per brand name so history accumulates (mirrors DrizzleStore).
    const brandId = this.brandIdByName.get(params.brand.name) ?? randomUUID();
    this.brandIdByName.set(params.brand.name, brandId);
    this.runs.set(runId, {
      id: runId,
      brandId,
      brand: params.brand.name,
      brandDomains: params.brand.domains ?? [],
      competitors: params.competitors.map((c) => c.name),
      status: "running",
      panel: params.panel,
      costUsd: 0,
      error: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      answers: [],
    });
    return { runId, brandId };
  }

  async finishRun(runId: string, params: FinishRunParams): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = "completed";
    run.costUsd = params.costUsd;
    run.answers = params.answers;
    run.completedAt = new Date().toISOString();
    this.sov.push({
      brand: run.brand,
      date: params.date,
      sov: params.sov,
      sentimentScore: params.sentimentScore,
    });
  }

  async failRun(runId: string, error: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = "failed";
    run.error = error;
    run.completedAt = new Date().toISOString();
  }

  async saveHallucinations(): Promise<void> {
    // In-memory store keeps hallucinations only for the current process; the
    // returned tool result already carries them, so this is a no-op here.
  }

  async getReport(runId: string): Promise<StoredReport | null> {
    const run = this.runs.get(runId);
    if (!run) return null;
    return {
      run: {
        id: run.id,
        brandId: run.brandId,
        status: run.status,
        panel: run.panel,
        costUsd: run.costUsd,
        error: run.error,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
      },
      brand: run.brand,
      brandDomains: run.brandDomains,
      competitors: run.competitors,
      answers: run.answers,
    };
  }

  async listBrands(): Promise<StoredBrand[]> {
    const byName = new Map<string, StoredBrand>();
    for (const run of this.runs.values()) {
      const existing = byName.get(run.brand);
      if (existing) {
        existing.competitors = dedupe([...existing.competitors, ...run.competitors]);
        existing.domains = dedupe([...existing.domains, ...run.brandDomains]);
      } else {
        byName.set(run.brand, {
          name: run.brand,
          domains: [...run.brandDomains],
          competitors: [...run.competitors],
        });
      }
    }
    return Array.from(byName.values());
  }

  async getSovHistory(brandName: string, days: number): Promise<SovPoint[]> {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    return this.sov
      .filter((p) => p.brand === brandName && p.date >= cutoff)
      .map((p) => ({ date: p.date, sov: p.sov, sentimentScore: p.sentimentScore }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async close(): Promise<void> {
    // no-op
  }
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

// Re-exported for tests that want to assert on sentiment typing.
export type { Sentiment };
