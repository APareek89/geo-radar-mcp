import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GetReportInputSchema, GetReportOutputSchema } from "@geo-radar/shared";
import { buildReport } from "@geo-radar/core";
import type { GeoStore } from "@geo-radar/db";

/**
 * `get_report` — fetch a stored report by `report_id`. The share-of-voice is
 * recomputed from the persisted answers, so the report is always consistent with
 * the raw data (no cached summary to drift).
 */
export function registerGetReportTool(server: McpServer, store: GeoStore): void {
  server.registerTool(
    "get_report",
    {
      title: "Get Report",
      description:
        "Retrieve a stored GEO report by its report_id (returned by measure_share_of_voice and other " +
        "measurement tools). Includes status, share-of-voice, per-prompt breakdown, and the raw answers.",
      inputSchema: GetReportInputSchema.shape,
      outputSchema: GetReportOutputSchema.shape,
    },
    async ({ report_id }) => {
      const report = await buildReport(store, report_id);
      if (!report) {
        return {
          content: [{ type: "text", text: `No report found for id "${report_id}".` }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `Report ${report.report_id} — ${report.brand} · status=${report.status} · ${report.answers.length} answers`,
          },
        ],
        structuredContent: report,
      };
    },
  );
}
