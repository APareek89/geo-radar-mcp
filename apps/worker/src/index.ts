import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "dotenv";
import { createDb, DrizzleStore, MemoryStore, type GeoStore } from "@geo-radar/db";
import { startPanelWorker, initErrorTracking, logger, captureError } from "@geo-radar/core";

/** Panel worker: consumes queued panel runs from Redis/BullMQ (P6). */
function loadEnv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const p = join(dir, ".env");
    if (existsSync(p)) return void config({ path: p });
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  config();
}

async function main(): Promise<void> {
  loadEnv();
  await initErrorTracking(); // Sentry when SENTRY_DSN is set; no-op otherwise.
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.error("worker: REDIS_URL is required");
    process.exit(1);
  }

  const store: GeoStore = process.env.DATABASE_URL
    ? new DrizzleStore(createDb(process.env.DATABASE_URL))
    : new MemoryStore();

  const costCapUsd = Number(process.env.PANEL_COST_CAP_USD_PER_RUN ?? "1") || 1;
  const worker = startPanelWorker(store, redisUrl, { costCapUsd });

  worker.on("completed", (job) => logger.info("worker: job completed", { jobId: job.id }));
  worker.on("failed", (job, err) => {
    captureError(err, { scope: "worker", jobId: job?.id });
  });
  logger.info("worker: listening for panel-run jobs");

  const shutdown = () => void worker.close().then(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err: unknown) => {
  captureError(err, { scope: "worker", phase: "startup" });
  process.exit(1);
});
