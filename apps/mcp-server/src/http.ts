import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SERVER_NAME, SERVER_VERSION } from "@geo-radar/shared";
import { createServer } from "./server";
import { registerDashboard } from "./dashboard";
import { requireAuth, protectedResourceMetadata } from "./auth";
import { createOAuthProxyRouter } from "./oauth-proxy";
import type { ServerRuntime } from "./runtime";

/**
 * Remote transport: streamable-HTTP (stateless). Each request gets a fresh
 * server+transport, so the tier is stateless and scales by instance count.
 * Auth is enforced by ./auth (bearer API key or OAuth JWT w/ JWKS verification).
 */
export function startHttpServer(runtime: ServerRuntime, port: number): void {
  const app = express();
  // Behind Render/any TLS-terminating proxy, trust X-Forwarded-* so req.protocol is
  // "https" — the OAuth metadata + resource URLs must be https or clients reject them.
  // Use a finite hop count (1 = Render's single reverse proxy), NOT `true`: a permissive
  // `true` makes express-rate-limit throw ERR_ERL_PERMISSIVE_TRUST_PROXY and silently
  // disables the rate limiting the SDK puts on the public /authorize|/token|/register.
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "1mb" }));

  // Health check (no auth) — Render/LB probe target.
  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION });
  });

  // OAuth: either PROXY mode (we are the same-origin authorization server, forwarding
  // to WorkOS — the flow the claude.ai web connector handles) or resource-server-only
  // delegation (advertise WorkOS directly). Flip with OAUTH_MODE=proxy.
  const oauthProxy = createOAuthProxyRouter();
  if (oauthProxy) {
    // Serves /authorize, /token, /register AND both well-known metadata docs.
    app.use(oauthProxy);
    process.stderr.write(`[${SERVER_NAME}] OAuth: proxy mode (same-origin AS → WorkOS)\n`);
  } else {
    // RFC 9728 protected-resource metadata (points clients off to the external AS).
    app.get("/.well-known/oauth-protected-resource", (req: Request, res: Response) => {
      res.json(protectedResourceMetadata(`${req.protocol}://${req.get("host")}`));
    });
  }

  // Companion dashboard (P9) + its read/demo JSON API.
  registerDashboard(app, runtime);

  // MCP endpoint (authenticated, stateless).
  app.post("/mcp", requireAuth, async (req: Request, res: Response) => {
    const server = createServer(runtime);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      process.stderr.write(`[${SERVER_NAME}] /mcp error: ${String(err)}\n`);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
      }
    }
  });

  const methodNotAllowed = (_req: Request, res: Response) =>
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.listen(port, () => {
    process.stderr.write(
      `[${SERVER_NAME} v${SERVER_VERSION}] HTTP on :${port} (dashboard /, POST /mcp, GET /healthz)\n`,
    );
  });
}
