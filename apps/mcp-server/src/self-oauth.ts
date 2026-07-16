import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { SignJWT, jwtVerify } from "jose";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { logger } from "@geo-radar/core";

/**
 * Self-hosted OAuth (`OAUTH_MODE=selfhosted`) — this server IS the authorization
 * server, with NO third-party identity backend (free forever, no signups / MAU caps).
 * Same same-origin topology as the WorkOS proxy (the flow the claude.ai web connector
 * handles), but we issue the tokens ourselves:
 *
 *   Claude ─DCR /register─▶ us      (we mint a client_id, remember its redirect_uris)
 *   Claude ─GET /authorize─▶ us     (Basic-auth login gate → we issue a one-time code)
 *   Claude ─POST /token────▶ us     (PKCE verified by the SDK → we sign a JWT)
 *   Claude ─POST /mcp  Bearer JWT─▶ us   (we verify our own HS256 JWT)
 *
 * A single shared password (`MCP_LOGIN_PASSWORD`) gates /authorize — right-sized for a
 * private, single-owner MCP. Tokens are signed with `OAUTH_SIGNING_SECRET` (falls back
 * to `MCP_API_KEY`); set a stable value so issued tokens survive restarts.
 */

/** Our public origin = the issuer Claude sees (OAUTH_AUDIENCE, trailing slash stripped). */
function publicUrl(): string | undefined {
  const raw = process.env.OAUTH_AUDIENCE?.trim();
  return raw ? raw.replace(/\/+$/, "") : undefined;
}

let warnedEphemeral = false;
let ephemeralSecret: string | null = null;
function signingKey(): Uint8Array {
  let secret = process.env.OAUTH_SIGNING_SECRET ?? process.env.MCP_API_KEY;
  if (!secret) {
    if (!ephemeralSecret) ephemeralSecret = randomBytes(32).toString("hex");
    if (!warnedEphemeral) {
      logger.warn("self-oauth: no OAUTH_SIGNING_SECRET/MCP_API_KEY — using an ephemeral key; tokens won't survive restart");
      warnedEphemeral = true;
    }
    secret = ephemeralSecret;
  }
  return new TextEncoder().encode(secret);
}

function tokenTtlSeconds(): number {
  return Number(process.env.OAUTH_TOKEN_TTL_SECONDS ?? "604800") || 604800; // 7 days
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

async function signAccessToken(scopes: string[], resource: string | undefined, clientId: string): Promise<string> {
  const iss = publicUrl()!;
  return new SignJWT({ scope: scopes.join(" "), client_id: clientId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("owner")
    .setIssuer(iss)
    .setAudience(resource ?? iss)
    .setIssuedAt()
    .setExpirationTime(`${tokenTtlSeconds()}s`)
    .sign(signingKey());
}

/** Verify a token WE issued (HS256). Used by /mcp and the provider. */
export async function verifySelfIssuedToken(token: string): Promise<AuthInfo> {
  const { payload } = await jwtVerify(token, signingKey(), { issuer: publicUrl() });
  const scopes = typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [];
  return {
    token,
    clientId: (payload.client_id as string | undefined) ?? "self",
    scopes,
    expiresAt: typeof payload.exp === "number" ? payload.exp : undefined,
    extra: { sub: payload.sub },
  };
}

interface CodeEntry {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource?: string;
  expiresAt: number;
}

class SelfHostedOAuthProvider implements OAuthServerProvider {
  private readonly clients = new Map<string, OAuthClientInformationFull>();
  private readonly codes = new Map<string, CodeEntry>();
  readonly skipLocalPkceValidation = false; // the SDK token handler verifies PKCE for us

  get clientsStore() {
    return {
      getClient: (id: string): OAuthClientInformationFull | undefined => this.clients.get(id),
      registerClient: (
        client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
      ): OAuthClientInformationFull => {
        const full: OAuthClientInformationFull = {
          ...client,
          client_id: `mcp_${randomToken(12)}`,
          client_id_issued_at: Math.floor(Date.now() / 1000),
        };
        this.clients.set(full.client_id, full);
        return full;
      },
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const code = randomToken();
    this.codes.set(code, {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scopes: params.scopes ?? [],
      resource: params.resource?.href,
      expiresAt: Date.now() + 5 * 60_000, // 5 min
    });
    const url = new URL(params.redirectUri);
    url.searchParams.set("code", code);
    if (params.state) url.searchParams.set("state", params.state);
    res.redirect(url.toString());
  }

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, code: string): Promise<string> {
    return this.codes.get(code)?.codeChallenge ?? "";
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const entry = this.codes.get(code);
    if (!entry || entry.clientId !== client.client_id || entry.expiresAt < Date.now()) {
      throw new InvalidGrantError("invalid or expired authorization code");
    }
    if (redirectUri && redirectUri !== entry.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match the authorization request");
    }
    this.codes.delete(code); // one-time use
    const access_token = await signAccessToken(entry.scopes, entry.resource, client.client_id);
    return {
      access_token,
      token_type: "bearer",
      expires_in: tokenTtlSeconds(),
      scope: entry.scopes.join(" ") || undefined,
    };
  }

  async exchangeRefreshToken(): Promise<OAuthTokens> {
    // No refresh tokens issued — Claude re-runs the (fast, same-origin) flow on expiry.
    throw new InvalidGrantError("refresh tokens are not supported");
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    return verifySelfIssuedToken(token);
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Password gate for the browser-facing `/authorize` step (HTTP Basic, so the browser
 * shows a native login dialog — no custom form). Any username; the password must equal
 * `MCP_LOGIN_PASSWORD`. If that env is unset the gate is disabled (logged loudly).
 */
export function selfHostedLoginGate(req: Request, res: Response, next: NextFunction): void {
  const password = process.env.MCP_LOGIN_PASSWORD;
  if (!password) {
    logger.warn("self-oauth: MCP_LOGIN_PASSWORD is not set — /authorize is UNGATED (anyone can obtain a token)");
    next();
    return;
  }
  const header = req.headers.authorization ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    const provided = idx >= 0 ? decoded.slice(idx + 1) : decoded;
    if (safeEqual(provided, password)) {
      next();
      return;
    }
  }
  res
    .status(401)
    .set("WWW-Authenticate", 'Basic realm="GEO Radar MCP login"')
    .type("text/plain")
    .send("Authentication required to authorize this MCP client.");
}

/**
 * Build the self-hosted AS router (metadata + /authorize + /token + /register), or
 * null when not in self-hosted mode / not configured. `http.ts` also mounts
 * `selfHostedLoginGate` on /authorize before this.
 */
export function createSelfHostedOAuthRouter(): RequestHandler | null {
  if (process.env.OAUTH_MODE !== "selfhosted") return null;
  const url = publicUrl();
  if (!url) {
    logger.warn("self-oauth: OAUTH_MODE=selfhosted but OAUTH_AUDIENCE missing — self-hosted OAuth disabled");
    return null;
  }
  return mcpAuthRouter({
    provider: new SelfHostedOAuthProvider(),
    issuerUrl: new URL(url),
    resourceServerUrl: new URL(url),
    scopesSupported: ["mcp"],
    resourceName: "GEO Radar MCP",
  });
}
