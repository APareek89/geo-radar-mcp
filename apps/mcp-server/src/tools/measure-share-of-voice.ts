import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  MeasureShareOfVoiceInputObject,
  MeasureShareOfVoiceOutputSchema,
  type MeasureShareOfVoiceOutput,
} from "@geo-radar/shared";
import { PanelRunError, type PanelRunner } from "@geo-radar/core";

/**
 * `measure_share_of_voice` — ask a panel of LLMs a bank of buyer-intent prompts,
 * parse brand mentions, compute share-of-voice, persist, and return a `report_id`
 * plus a summary. Heavy work runs in-process for v1 (queued to a worker at P6).
 */
export function registerMeasureShareOfVoiceTool(server: McpServer, runner: PanelRunner): void {
  server.registerTool(
    "measure_share_of_voice",
    {
      title: "Measure Share of Voice",
      description:
        "Ask a panel of AI models a set of buyer-intent prompts and measure how often a brand is " +
        "recommended vs named competitors. Returns a report_id plus per-brand share-of-voice and a " +
        "per-prompt breakdown. Provide either `prompts` or a `prompt_set_id` (e.g. \"demo\").",
      inputSchema: MeasureShareOfVoiceInputObject.shape,
      outputSchema: MeasureShareOfVoiceOutputSchema.shape,
    },
    async (args) => {
      try {
        const report = await runner.run(args);
        return {
          content: [{ type: "text", text: summarize(report) }],
          structuredContent: report,
        };
      } catch (err) {
        const message =
          err instanceof PanelRunError
            ? err.message
            : `measure_share_of_voice failed: ${err instanceof Error ? err.message : String(err)}`;
        return { content: [{ type: "text", text: message }], isError: true };
      }
    },
  );
}

function summarize(report: MeasureShareOfVoiceOutput): string {
  if (report.status === "queued") {
    return (
      `Report ${report.report_id} — ${report.brand} · status=queued\n` +
      `Panel: ${report.panel.join(", ")} over ${report.prompt_count} prompts is running on a worker.\n` +
      `Poll get_report("${report.report_id}") until status is "completed".`
    );
  }
  const lines = report.share_of_voice
    .slice()
    .sort((a, b) => b.sov - a.sov)
    .map((e) => `  ${e.brand}: ${(e.sov * 100).toFixed(1)}% (${e.mentions} mentions)`);
  return (
    `Report ${report.report_id} — ${report.brand}\n` +
    `Panel: ${report.panel.join(", ")} · ${report.answer_count} answers over ${report.prompt_count} prompts · ~$${report.cost_usd.toFixed(4)}\n` +
    `Share of voice:\n${lines.join("\n")}`
  );
}
