import type { RequestHandler } from "express";
import { ProxyOAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { SERVER_NAME } from "@geo-radar/shared";
import { audienceUrl, issuerUrl, verifyAccessToken } from "./auth";

/**
 * OAuth PROXY mode (`OAUTH_MODE=proxy`) — makes THIS server the OAuth authorization
 * server that Claude talks to, forwarding authorize/token/register to WorkOS AuthKit
 * underneath. Everything Claude sees is same-origin (our domain), so it runs the
 * ordinary DCR-against-the-MCP-server flow instead of the cross-origin delegation
 * flow that the claude.ai web connector mishandles (drops `state`). This mirrors the
 * topology of servers that connect successfully (e.g. mcp.pixelbin.io advertises
 * itself as its own authorization_server). WorkOS still does the real login/identity.
 *
 * When unset, `http.ts` keeps the resource-server-only delegation (advertises WorkOS
 * directly) — a safe, env-flippable rollback.
 */

/**
 * WorkOS has no "GET client by id" endpoint, but the SDK's authorize/token handlers
 * call `clientsStore.getClient(id)` to validate the request's redirect_uri. So we
 * cache each client returned by the proxied DCR `/register` call and serve reads from
 * that cache. (Per-instance in memory — fine for the single web dyno; a client whose
 * entry is lost on restart is simply re-registered by the client on its next attempt.)
 */
class CachingProxyProvider extends ProxyOAuthServerProvider {
  private readonly clients = new Map<string, OAuthClientInformationFull>();

  override get clientsStore() {
    const base = super.clientsStore;
    return {
      getClient: async (id: string): Promise<OAuthClientInformationFull | undefined> =>
        this.clients.get(id) ?? (await base.getClient(id)),
      ...(base.registerClient && {
        registerClient: async (
          client: OAuthClientInformationFull,
        ): Promise<OAuthClientInformationFull> => {
          const registered = await base.registerClient!(client);
          this.clients.set(registered.client_id, registered);
          return registered;
        },
      }),
    };
  }
}

/**
 * Build the express router that serves our AS metadata + `/authorize`, `/token`,
 * `/register` (proxied to WorkOS) AND the protected-resource metadata. Returns null
 * when proxy mode is off or not fully configured (caller falls back to delegation).
 */
export function createOAuthProxyRouter(): RequestHandler | null {
  if (process.env.OAUTH_MODE !== "proxy") return null;

  const upstream = issuerUrl(); // WorkOS AuthKit (the real login/identity)
  const publicUrl = audienceUrl(); // our public origin — becomes the issuer Claude sees
  if (!upstream || !publicUrl) {
    process.stderr.write(
      `[${SERVER_NAME}] OAUTH_MODE=proxy but OAUTH_ISSUER/OAUTH_AUDIENCE missing — proxy disabled\n`,
    );
    return null;
  }

  const provider = new CachingProxyProvider({
    endpoints: {
      authorizationUrl: `${upstream}/oauth2/authorize`,
      tokenUrl: `${upstream}/oauth2/token`,
      registrationUrl: `${upstream}/oauth2/register`,
    },
    verifyAccessToken,
    // Reads are served from the cache above; this upstream fallback stays empty
    // because WorkOS exposes no client-lookup endpoint.
    getClient: async () => undefined,
  });

  return mcpAuthRouter({
    provider,
    issuerUrl: new URL(publicUrl),
    resourceServerUrl: new URL(publicUrl),
    scopesSupported: ["openid", "profile", "email", "offline_access"],
    resourceName: "GEO Radar MCP",
  });
}
