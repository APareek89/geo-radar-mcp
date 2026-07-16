import type { RequestHandler } from "express";
import {
  ProxyOAuthServerProvider,
  type ProxyEndpoints,
} from "@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { logger } from "@geo-radar/core";
import { audienceUrl, issuerUrl, verifyAccessToken } from "./auth";

/**
 * Discover the upstream IdP's OAuth endpoints via RFC 8414 metadata, so proxy mode
 * works with ANY provider (Stytch, Auth0, WorkOS, …) from just its issuer URL. Falls
 * back to the WorkOS-style `/oauth2/*` paths if discovery fails.
 */
async function discoverUpstreamEndpoints(issuer: string): Promise<ProxyEndpoints> {
  const fallback: ProxyEndpoints = {
    authorizationUrl: `${issuer}/oauth2/authorize`,
    tokenUrl: `${issuer}/oauth2/token`,
    registrationUrl: `${issuer}/oauth2/register`,
  };
  // Try RFC 8414 first, then OIDC discovery (Auth0 & most OIDC IdPs serve the latter).
  for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
    try {
      const res = await fetch(`${issuer}${path}`);
      if (!res.ok) continue;
      const m = (await res.json()) as {
        authorization_endpoint?: string;
        token_endpoint?: string;
        registration_endpoint?: string;
      };
      if (m.authorization_endpoint && m.token_endpoint) {
        return {
          authorizationUrl: m.authorization_endpoint,
          tokenUrl: m.token_endpoint,
          registrationUrl: m.registration_endpoint ?? fallback.registrationUrl,
        };
      }
    } catch {
      /* try next path / fall back */
    }
  }
  return fallback;
}

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
export async function createOAuthProxyRouter(): Promise<RequestHandler | null> {
  if (process.env.OAUTH_MODE !== "proxy") return null;

  const upstream = issuerUrl(); // the upstream IdP (WorkOS / Stytch / Auth0 …)
  const publicUrl = audienceUrl(); // our public origin — becomes the issuer Claude sees
  if (!upstream || !publicUrl) {
    logger.warn("oauth proxy: OAUTH_MODE=proxy but OAUTH_ISSUER/OAUTH_AUDIENCE missing — disabled");
    return null;
  }

  const endpoints = await discoverUpstreamEndpoints(upstream);
  logger.info("oauth proxy: upstream endpoints resolved", {
    upstream,
    authorizationUrl: endpoints.authorizationUrl,
  });

  const provider = new CachingProxyProvider({
    endpoints,
    verifyAccessToken,
    // Reads are served from the cache above; this upstream fallback stays empty
    // because most IdPs expose no client-lookup endpoint.
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
