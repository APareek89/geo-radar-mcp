import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "dotenv";
import { createDb, DrizzleStore, MemoryStore, type GeoStore } from "@geo-radar/db";
import { startPanelWorker } from "@geo-radar/core";

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

function main(): void {
  loadEnv();
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    process.stderr.write("[geo-radar-worker] REDIS_URL is required\n");
    process.exit(1);
  }

  const store: GeoStore = process.env.DATABASE_URL
    ? new DrizzleStore(createDb(process.env.DATABASE_URL))
    : new MemoryStore();

  const costCapUsd = Number(process.env.PANEL_COST_CAP_USD_PER_RUN ?? "1") || 1;
  const worker = startPanelWorker(store, redisUrl, { costCapUsd });

  worker.on("completed", (job) => process.stderr.write(`[worker] job ${job.id} completed\n`));
  worker.on("failed", (job, err) =>
    process.stderr.write(`[worker] job ${job?.id} failed: ${err.message}\n`),
  );
  process.stderr.write("[geo-radar-worker] listening for panel-run jobs\n");

  const shutdown = () => void worker.close().then(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main();
