import type { Sentiment } from "@geo-radar/shared";

/**
 * Persistence port. The runner depends on this interface, not on Postgres —
 * `DrizzleStore` is the production implementation, `MemoryStore` is used by tests
 * and by local dev without a database (GEO_STORE=memory).
 */

export interface BeginRunParams {
  brand: { name: string; domains?: string[]; owner?: string | null };
  competitors: { name: string; domains?: string[] }[];
  promptSetId?: string | null;
  panel: string[];
}

export interface BeginRunResult {
  runId: string;
  brandId: string;
}

export interface PersistedAnswer {
  model: string;
  prompt: string;
  rawAnswer: string;
  mentions: string[];
  citedDomains: string[];
  sentiment: Sentiment | null;
}

export interface FinishRunParams {
  brandId: string;
  costUsd: number;
  answers: PersistedAnswer[];
  /** The brand's own share-of-voice, written to the sov_history time series. */
  sov: number;
  sentimentScore: number | null;
  /** YYYY-MM-DD */
  date: string;
}

export interface StoredRun {
  id: string;
  brandId: string;
  status: string;
  panel: string[];
  costUsd: number;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface StoredReport {
  run: StoredRun;
  brand: string;
  brandDomains: string[];
  competitors: string[];
  answers: PersistedAnswer[];
}

export interface StoredBrand {
  name: string;
  domains: string[];
  competitors: string[];
}

export interface SovPoint {
  date: string;
  sov: number;
  sentimentScore: number | null;
}

export interface HallucinationRecord {
  claim: string;
  contradictsFact: string;
  severity: string;
}

export interface GeoStore {
  beginRun(params: BeginRunParams): Promise<BeginRunResult>;
  finishRun(runId: string, params: FinishRunParams): Promise<void>;
  failRun(runId: string, error: string): Promise<void>;
  getReport(runId: string): Promise<StoredReport | null>;
  /** Persist detected hallucination flags for a run. */
  saveHallucinations(runId: string, flags: HallucinationRecord[]): Promise<void>;
  /** Brands seen so far (for the brand://config resource). */
  listBrands(): Promise<StoredBrand[]>;
  /** SoV time-series for a brand over the last `days` (for history://sov). */
  getSovHistory(brandName: string, days: number): Promise<SovPoint[]>;
  close(): Promise<void>;
}
