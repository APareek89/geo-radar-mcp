import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createOAuthProxyRouter } from "./oauth-proxy";

/**
 * The OAuth-proxy router turns this server into a same-origin authorization server
 * (forwarding to WorkOS) so the claude.ai web connector's cross-origin `state` bug
 * doesn't bite. It's gated on OAUTH_MODE=proxy for safe rollback — pin that contract.
 */
describe("createOAuthProxyRouter", () => {
  const saved = {
    mode: process.env.OAUTH_MODE,
    iss: process.env.OAUTH_ISSUER,
    aud: process.env.OAUTH_AUDIENCE,
  };

  beforeEach(() => {
    delete process.env.OAUTH_MODE;
    delete process.env.OAUTH_ISSUER;
    delete process.env.OAUTH_AUDIENCE;
  });
  afterEach(() => {
    for (const [k, v] of [
      ["OAUTH_MODE", saved.mode],
      ["OAUTH_ISSUER", saved.iss],
      ["OAUTH_AUDIENCE", saved.aud],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("is OFF by default (null when OAUTH_MODE is unset) — delegation stays the default", () => {
    process.env.OAUTH_ISSUER = "qualified-odyssey-45-staging.authkit.app";
    process.env.OAUTH_AUDIENCE = "https://geo-radar-mcp.onrender.com";
    expect(createOAuthProxyRouter()).toBeNull();
  });

  it("stays null in proxy mode if issuer/audience are missing (won't half-configure)", () => {
    process.env.OAUTH_MODE = "proxy";
    expect(createOAuthProxyRouter()).toBeNull();
  });

  it("returns a mounted router when proxy mode is fully configured", () => {
    process.env.OAUTH_MODE = "proxy";
    process.env.OAUTH_ISSUER = "qualified-odyssey-45-staging.authkit.app";
    process.env.OAUTH_AUDIENCE = "https://geo-radar-mcp.onrender.com/";
    const router = createOAuthProxyRouter();
    expect(typeof router).toBe("function");
  });
});
