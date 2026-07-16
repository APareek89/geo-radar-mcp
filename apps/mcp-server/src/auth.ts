import type { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Auth for the HTTP transport (this server is an OAuth **resource server**).
 *
 * - `MCP_API_KEY` → simple bearer-token match (private / simple hosted).
 * - `OAUTH_ISSUER` → delegated OAuth 2.1. An external authorization server
 *   (e.g. WorkOS AuthKit) handles login / consent / Dynamic Client Registration;
 *   we only VERIFY the resulting JWT access token: signature (against the issuer's
 *   JWKS, discovered from its metadata), `iss`, `exp`, and `aud` = our resource URL.
 * - Neither set → open (local dev), so `pnpm dev` just works.
 *
 * We advertise RFC 9728 protected-resource metadata so MCP clients (Claude) can
 * discover the authorization server and start the login flow.
 */

let jwksPromise: Promise<JWTVerifyGetKey> | null = null;

async function discoverJwksUri(issuer: string): Promise<string> {
  if (process.env.OAUTH_JWKS_URI) return process.env.OAUTH_JWKS_URI;
  const base = issuer.replace(/\/$/, "");
  for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
    try {
      const res = await fetch(base + path);
      if (res.ok) {
        const meta = (await res.json()) as { jwks_uri?: string };
        if (meta.jwks_uri) return meta.jwks_uri;
      }
    } catch {
      /* try next */
    }
  }
  return base + "/.well-known/jwks.json"; // last-resort default
}

function getJwks(): Promise<JWTVerifyGetKey> | null {
  const issuer = process.env.OAUTH_ISSUER;
  if (!issuer) return null;
  if (!jwksPromise) {
    jwksPromise = discoverJwksUri(issuer).then((uri) => createRemoteJWKSet(new URL(uri)));
  }
  return jwksPromise;
}

export function authConfigured(): boolean {
  return Boolean(process.env.MCP_API_KEY || process.env.OAUTH_ISSUER);
}

export function protectedResourceMetadata(resourceUrl: string): Record<string, unknown> {
  return {
    resource: process.env.OAUTH_AUDIENCE ?? resourceUrl,
    authorization_servers: process.env.OAUTH_ISSUER ? [process.env.OAUTH_ISSUER] : [],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
  };
}

function bearer(req: Request): string {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!authConfigured()) {
    next();
    return;
  }

  const token = bearer(req);
  if (!token) {
    unauthorized(req, res, "missing bearer token");
    return;
  }

  // 1. Static API-key path.
  if (process.env.MCP_API_KEY && token === process.env.MCP_API_KEY) {
    next();
    return;
  }

  // 2. Delegated OAuth — verify the JWT's signature against the issuer's JWKS.
  const jwks = getJwks();
  if (jwks) {
    try {
      await jwtVerify(token, await jwks, {
        issuer: process.env.OAUTH_ISSUER,
        audience: process.env.OAUTH_AUDIENCE, // undefined → not checked
      });
      next();
      return;
    } catch {
      /* fall through to 401 */
    }
  }

  unauthorized(req, res, "invalid token");
}

function unauthorized(req: Request, res: Response, detail: string): void {
  const base = `${req.protocol}://${req.get("host")}`;
  res
    .status(401)
    .set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
    )
    .json({ jsonrpc: "2.0", error: { code: -32001, message: `Unauthorized: ${detail}` }, id: null });
}
