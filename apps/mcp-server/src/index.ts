import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION } from "@geo-radar/shared";
import { initErrorTracking, logger } from "@geo-radar/core";
import { loadEnv } from "./env";
import { createServer } from "./server";
import { buildRuntime } from "./runtime";
import { startHttpServer } from "./http";

/**
 * Entry point. MCP_TRANSPORT=http starts the remote streamable-HTTP server;
 * otherwise (default) it speaks stdio — how Claude Desktop/Code launch it locally.
 *
 * IMPORTANT: on stdio, stdout is reserved for the JSON-RPC protocol. All human-facing
 * logging MUST go to stderr, or it will corrupt the message stream.
 */
async function main(): Promise<void> {
  loadEnv();
  await initErrorTracking(); // Sentry when SENTRY_DSN is set; no-op otherwise.
  const runtime = buildRuntime();

  if (process.env.MCP_TRANSPORT === "http") {
    const port = Number(process.env.PORT ?? "8080") || 8080;
    await startHttpServer(runtime, port);
    return;
  }

  const server = createServer(runtime);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[${SERVER_NAME} v${SERVER_VERSION}] stdio server ready\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[${SERVER_NAME}] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
