import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BUILTIN_PROMPT_SETS, buildReport } from "@geo-radar/core";
import type { ServerRuntime } from "./runtime";

const json = (uri: string, data: unknown) => ({
  contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
});

/** Registers the MCP resources (data the agent can read). */
export function registerResources(server: McpServer, runtime: ServerRuntime): void {
  const { store } = runtime;

  // prompts://library — the built-in buyer-intent prompt sets
  server.registerResource(
    "prompts-library",
    "prompts://library",
    {
      title: "Prompt library",
      description: "Built-in buyer-intent prompt sets (use a set's id as prompt_set_id).",
      mimeType: "application/json",
    },
    async (uri) => json(uri.href, Object.values(BUILTIN_PROMPT_SETS)),
  );

  // brand://config — brands + competitors seen so far
  server.registerResource(
    "brand-config",
    "brand://config",
    {
      title: "Brand config",
      description: "Brands and competitors tracked so far (from prior runs).",
      mimeType: "application/json",
    },
    async (uri) => json(uri.href, await store.listBrands()),
  );

  // reports://{report_id} — a stored report
  server.registerResource(
    "report",
    new ResourceTemplate("reports://{report_id}", { list: undefined }),
    {
      title: "Report",
      description: "A stored GEO report by id (same payload as get_report).",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const reportId = String(variables.report_id);
      const report = await buildReport(store, reportId);
      return json(uri.href, report ?? { error: `No report ${reportId}` });
    },
  );

  // history://sov{?brand,range} — SoV time-series, e.g. history://sov?brand=PixelBin&range=30d
  server.registerResource(
    "sov-history",
    new ResourceTemplate("history://sov{?brand,range}", { list: undefined }),
    {
      title: "Share-of-voice history",
      description: "SoV time-series for a brand. Query params: brand (required), range (e.g. 7d/30d/90d).",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const brand = variables.brand ? String(variables.brand) : "";
      const days = parseRange(variables.range ? String(variables.range) : "30d");
      if (!brand) return json(uri.href, { error: "brand query param is required" });
      const points = await store.getSovHistory(brand, days);
      return json(uri.href, { brand, range_days: days, points });
    },
  );
}

function parseRange(range: string): number {
  const m = /^(\d+)d$/.exec(range.trim());
  return m ? Number(m[1]) : 30;
}
