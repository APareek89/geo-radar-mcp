import { loadEnv } from "./env";
import { buildRuntime } from "./runtime";
import { InProcessPanelRunner } from "@geo-radar/core";

/**
 * Seed a demo report so a fresh database shows value immediately. Uses the mock
 * pipeline (forceMock) so it's free and deterministic. Requires DATABASE_URL
 * (otherwise it seeds an ephemeral in-memory store, which is pointless).
 */
async function main(): Promise<void> {
  loadEnv();
  const { store } = buildRuntime();
  const runner = new InProcessPanelRunner(store, { costCapUsd: 1, forceMock: true });
  const report = await runner.run({
    brand: "PixelBin",
    competitors: ["Photoroom", "remove.bg", "Cloudinary"],
    brand_domains: ["pixelbin.io"],
    prompt_set_id: "demo",
  });
  process.stderr.write(`Seeded demo report ${report.report_id} for "${report.brand}".\n`);
  await store.close();
}

main().catch((err: unknown) => {
  process.stderr.write(`seed failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
