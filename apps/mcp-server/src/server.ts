import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "@geo-radar/shared";
import { registerPingTool } from "./tools/ping";
import { registerMeasureShareOfVoiceTool } from "./tools/measure-share-of-voice";
import { registerGetReportTool } from "./tools/get-report";
import { registerAnalysisTools } from "./tools/analysis";
import { registerAttributeAiTrafficTool } from "./tools/attribute-ai-traffic";
import { registerResources } from "./resources";
import { registerPrompts } from "./prompts";
import type { ServerRuntime } from "./runtime";

/**
 * Build a fully-wired MCP server instance (transport-agnostic).
 *
 * Pass a `runtime` (store + runner) to enable the measurement tools. Without one,
 * only `ping` is registered — handy for the transport/contract smoke test.
 */
export function createServer(runtime?: ServerRuntime): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // ── Tools ────────────────────────────────────────────────────────────────
  registerPingTool(server);

  if (runtime) {
    // P2
    registerMeasureShareOfVoiceTool(server, runtime.runner);
    registerGetReportTool(server, runtime.store);
    // P3/P4 analysis tools
    registerAnalysisTools(server, runtime);
    // P10 GA4 attribution (gated on config)
    registerAttributeAiTrafficTool(server);
    // Resources (P3) + Prompts (P4) — all three MCP primitives
    registerResources(server, runtime);
    registerPrompts(server);
  }

  return server;
}
