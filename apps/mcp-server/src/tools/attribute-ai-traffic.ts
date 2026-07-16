import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AttributeAiTrafficInputObject, AttributeAiTrafficOutputSchema } from "@geo-radar/shared";
import { attributeAiTraffic, PanelRunError } from "@geo-radar/core";

/**
 * `attribute_ai_traffic` (P10) — GA4 sessions/conversions from AI-engine referrers.
 * Gated on GA4 config; returns a clear tool error (never crashes) when unconfigured.
 */
export function registerAttributeAiTrafficTool(server: McpServer): void {
  server.registerTool(
    "attribute_ai_traffic",
    {
      title: "Attribute AI Traffic",
      description:
        "Read GA4 for referral sessions and conversions arriving from AI engines (ChatGPT, Perplexity, " +
        "Gemini, Claude, Copilot) — the 'AI visibility → funnel' bridge. Requires GA4_PROPERTY_ID + credentials.",
      inputSchema: AttributeAiTrafficInputObject.shape,
      outputSchema: AttributeAiTrafficOutputSchema.shape,
    },
    async (args) => {
      try {
        const result = await attributeAiTraffic(args);
        return {
          content: [
            {
              type: "text",
              text: `AI-referred traffic (${result.date_range.start}→${result.date_range.end}): ${result.total_ai_sessions} sessions, ${result.total_ai_conversions} conversions across ${result.by_engine.length} engine(s).`,
            },
          ],
          structuredContent: result,
        };
      } catch (e) {
        const msg = e instanceof PanelRunError ? e.message : `attribute_ai_traffic failed: ${e instanceof Error ? e.message : String(e)}`;
        return { content: [{ type: "text", text: msg }], isError: true };
      }
    },
  );
}
