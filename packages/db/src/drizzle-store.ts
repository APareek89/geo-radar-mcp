import { and, eq, gte, inArray } from "drizzle-orm";
import type { Sentiment } from "@geo-radar/shared";
import type { DbHandle } from "./client";
import { answers, brands, competitors, hallucinations, panelRuns, sovHistory } from "./schema";
import type {
  BeginRunParams,
  BeginRunResult,
  FinishRunParams,
  GeoStore,
  HallucinationRecord,
  PersistedAnswer,
  SovPoint,
  StoredBrand,
  StoredReport,
  StoredRun,
} from "./store";

/** Postgres-backed GeoStore. */
export class DrizzleStore implements GeoStore {
  constructor(private readonly handle: DbHandle) {}

  private get db() {
    return this.handle.db;
  }

  async beginRun(params: BeginRunParams): Promise<BeginRunResult> {
    const { db } = this;
    const owner = params.brand.owner ?? "";
    const where = and(eq(brands.name, params.brand.name), eq(brands.owner, owner));

    // Find-or-create the brand so sov_history accumulates against a stable id.
    // Race-safe: rely on the unique (name, owner) index — a concurrent insert
    // hits onConflictDoNothing, then we re-select the winner.
    let brandId: string;
    const found = await db.select({ id: brands.id }).from(brands).where(where).limit(1);
    if (found[0]) {
      brandId = found[0].id;
    } else {
      const inserted = await db
        .insert(brands)
        .values({ name: params.brand.name, domains: params.brand.domains ?? [], owner })
        .onConflictDoNothing()
        .returning({ id: brands.id });
      brandId =
        inserted[0]?.id ??
        (await db.select({ id: brands.id }).from(brands).where(where).limit(1))[0]!.id;
    }

    // Upsert competitors by (brandId, name).
    for (const comp of params.competitors) {
      const existing = await db
        .select({ id: competitors.id })
        .from(competitors)
        .where(and(eq(competitors.brandId, brandId), eq(competitors.name, comp.name)))
        .limit(1);
      if (!existing[0]) {
        await db
          .insert(competitors)
          .values({ brandId, name: comp.name, domains: comp.domains ?? [] });
      }
    }

    const run = await db
      .insert(panelRuns)
      .values({
        brandId,
        promptSetId: params.promptSetId ?? null,
        panel: params.panel,
        status: "running",
      })
      .returning({ id: panelRuns.id });

    return { runId: run[0]!.id, brandId };
  }

  async finishRun(runId: string, params: FinishRunParams): Promise<void> {
    // All three writes commit together — a crash mid-finish never leaves a run
    // stuck "running" or completed-with-no-history (FMEA P0: partial writes).
    await this.db.transaction(async (tx) => {
      if (params.answers.length > 0) {
        await tx.insert(answers).values(
          params.answers.map((a) => ({
            runId,
            model: a.model,
            prompt: a.prompt,
            rawAnswer: a.rawAnswer,
            mentions: a.mentions,
            citedDomains: a.citedDomains,
            sentiment: a.sentiment,
          })),
        );
      }

      await tx
        .update(panelRuns)
        .set({ status: "completed", costUsd: params.costUsd, completedAt: new Date() })
        .where(eq(panelRuns.id, runId));

      await tx.insert(sovHistory).values({
        brandId: params.brandId,
        runId,
        date: params.date,
        sov: params.sov,
        sentimentScore: params.sentimentScore,
      });
    });
  }

  async failRun(runId: string, error: string): Promise<void> {
    await this.db
      .update(panelRuns)
      .set({ status: "failed", error, completedAt: new Date() })
      .where(eq(panelRuns.id, runId));
  }

  async saveHallucinations(runId: string, flags: HallucinationRecord[]): Promise<void> {
    if (flags.length === 0) return;
    await this.db.insert(hallucinations).values(
      flags.map((f) => ({
        runId,
        claim: f.claim,
        contradictsFact: f.contradictsFact,
        severity: f.severity,
      })),
    );
  }

  async getReport(runId: string): Promise<StoredReport | null> {
    const { db } = this;
    const runRows = await db.select().from(panelRuns).where(eq(panelRuns.id, runId)).limit(1);
    const run = runRows[0];
    if (!run) return null;

    const brandRows = await db.select().from(brands).where(eq(brands.id, run.brandId)).limit(1);
    const compRows = await db
      .select({ name: competitors.name })
      .from(competitors)
      .where(eq(competitors.brandId, run.brandId));
    const answerRows = await db.select().from(answers).where(eq(answers.runId, runId));

    const storedRun: StoredRun = {
      id: run.id,
      brandId: run.brandId,
      status: run.status,
      panel: run.panel,
      costUsd: run.costUsd,
      error: run.error,
      createdAt: run.createdAt.toISOString(),
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    };

    const mappedAnswers: PersistedAnswer[] = answerRows.map((a) => ({
      model: a.model,
      prompt: a.prompt,
      rawAnswer: a.rawAnswer,
      mentions: a.mentions,
      citedDomains: a.citedDomains,
      sentiment: (a.sentiment as Sentiment | null) ?? null,
    }));

    return {
      run: storedRun,
      brand: brandRows[0]?.name ?? "",
      brandDomains: brandRows[0]?.domains ?? [],
      competitors: compRows.map((c) => c.name),
      answers: mappedAnswers,
    };
  }

  async listBrands(): Promise<StoredBrand[]> {
    const brandRows = await this.db.select().from(brands);
    const compRows = await this.db
      .select({ brandId: competitors.brandId, name: competitors.name })
      .from(competitors);
    const compByBrand = new Map<string, string[]>();
    for (const c of compRows) {
      const arr = compByBrand.get(c.brandId) ?? [];
      arr.push(c.name);
      compByBrand.set(c.brandId, arr);
    }
    return brandRows.map((b) => ({
      name: b.name,
      domains: b.domains,
      competitors: dedupe(compByBrand.get(b.id) ?? []),
    }));
  }

  async getSovHistory(brandName: string, days: number): Promise<SovPoint[]> {
    const brandRows = await this.db
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.name, brandName));
    if (brandRows.length === 0) return [];
    const ids = brandRows.map((b) => b.id);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const rows = await this.db
      .select()
      .from(sovHistory)
      .where(and(inArray(sovHistory.brandId, ids), gte(sovHistory.date, cutoff)))
      .orderBy(sovHistory.date);
    return rows.map((r) => ({ date: r.date, sov: r.sov, sentimentScore: r.sentimentScore }));
  }

  async close(): Promise<void> {
    await this.handle.close();
  }
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}
