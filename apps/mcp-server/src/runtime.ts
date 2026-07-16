import { createDb, DrizzleStore, MemoryStore, type GeoStore } from "@geo-radar/db";
import {
  InProcessPanelRunner,
  QueuePanelRunner,
  createProviderRateLimiter,
  logger,
  type PanelRunner,
} from "@geo-radar/core";

export interface ServerRuntime {
  store: GeoStore;
  runner: PanelRunner;
}

/**
 * Build the store + runner from the environment.
 *
 * Uses Postgres (DrizzleStore) when DATABASE_URL is set; otherwise falls back to
 * an in-memory store so the server is usable without Docker. Set GEO_STORE=memory
 * to force in-memory even when DATABASE_URL is present.
 */
export function buildRuntime(): ServerRuntime {
  const useMemory = process.env.GEO_STORE === "memory" || !process.env.DATABASE_URL;

  let store: GeoStore;
  if (useMemory) {
    store = new MemoryStore();
    logger.warn("using in-memory store (no DATABASE_URL or GEO_STORE=memory) — data is not persisted");
  } else {
    store = new DrizzleStore(createDb(process.env.DATABASE_URL!));
  }

  const costCapUsd = Number(process.env.PANEL_COST_CAP_USD_PER_RUN ?? "1") || 1;

  // PANEL_RUNNER=queue offloads runs to BullMQ workers (P6); default is in-process.
  // The in-process runner rate-limits real provider calls; the queue variant runs the
  // pipeline in the worker, which builds its own limiter there.
  const runner: PanelRunner =
    process.env.PANEL_RUNNER === "queue" && process.env.REDIS_URL
      ? new QueuePanelRunner(process.env.REDIS_URL, store)
      : new InProcessPanelRunner(store, { costCapUsd, rateLimiter: createProviderRateLimiter() });

  return { store, runner };
}
