import { createDb, DrizzleStore, MemoryStore, type GeoStore } from "@geo-radar/db";
import { InProcessPanelRunner, QueuePanelRunner, type PanelRunner } from "@geo-radar/core";
import { SERVER_NAME } from "@geo-radar/shared";

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
    process.stderr.write(
      `[${SERVER_NAME}] using in-memory store (no DATABASE_URL or GEO_STORE=memory) — data is not persisted\n`,
    );
  } else {
    store = new DrizzleStore(createDb(process.env.DATABASE_URL!));
  }

  const costCapUsd = Number(process.env.PANEL_COST_CAP_USD_PER_RUN ?? "1") || 1;

  // PANEL_RUNNER=queue offloads runs to BullMQ workers (P6); default is in-process.
  const runner: PanelRunner =
    process.env.PANEL_RUNNER === "queue" && process.env.REDIS_URL
      ? new QueuePanelRunner(process.env.REDIS_URL)
      : new InProcessPanelRunner(store, { costCapUsd });

  return { store, runner };
}
