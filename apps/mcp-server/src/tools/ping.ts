import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  PingInputSchema,
  PingOutputSchema,
  SERVER_NAME,
  SERVER_VERSION,
  type PingOutput,
} from "@geo-radar/shared";

/**
 * Register the `ping` tool on an MCP server.
 *
 * The SDK takes a Zod *raw shape* (`.shape`) for input/output schemas and converts
 * it to JSON Schema for `tools/list` automatically — so the schema the agent sees
 * is derived from the same Zod definition we validate against.
 */
export function registerPingTool(server: McpServer): void {
  server.registerTool(
    "ping",
    {
      title: "Ping",
      description:
        "Health check. Echoes an optional message and returns the server name, version, and a timestamp. Call this to confirm the GEO Radar MCP server is reachable.",
      inputSchema: PingInputSchema.shape,
      outputSchema: PingOutputSchema.shape,
    },
    async ({ message }) => {
      const result: PingOutput = {
        ok: true,
        echo: message ?? "pong",
        server: SERVER_NAME,
        version: SERVER_VERSION,
        timestamp: new Date().toISOString(),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
}
