import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { protectedResourceMetadata } from "./auth";

/**
 * Locks in the OAuth resource-server metadata shape that Claude's connector +
 * WorkOS AuthKit expect. Regressions here silently break the remote "Connect &
 * log in" flow (the "code/state: Field required" callback failure), so pin it.
 */
describe("protectedResourceMetadata", () => {
  const saved = { iss: process.env.OAUTH_ISSUER, aud: process.env.OAUTH_AUDIENCE };

  beforeEach(() => {
    delete process.env.OAUTH_ISSUER;
    delete process.env.OAUTH_AUDIENCE;
  });
  afterEach(() => {
    if (saved.iss === undefined) delete process.env.OAUTH_ISSUER;
    else process.env.OAUTH_ISSUER = saved.iss;
    if (saved.aud === undefined) delete process.env.OAUTH_AUDIENCE;
    else process.env.OAUTH_AUDIENCE = saved.aud;
  });

  it("advertises the request host when no audience is configured", () => {
    const meta = protectedResourceMetadata("https://geo-radar-mcp.onrender.com");
    expect(meta.resource).toBe("https://geo-radar-mcp.onrender.com");
    expect(meta.bearer_methods_supported).toEqual(["header"]);
    // Must NOT advertise a custom scope WorkOS can't grant — that breaks authorize.
    expect(meta.scopes_supported).toBeUndefined();
  });

  it("strips a trailing slash from OAUTH_AUDIENCE so the resource indicator matches byte-for-byte", () => {
    process.env.OAUTH_AUDIENCE = "https://geo-radar-mcp.onrender.com/";
    const meta = protectedResourceMetadata("https://ignored.example");
    expect(meta.resource).toBe("https://geo-radar-mcp.onrender.com");
  });

  it("normalizes a scheme-less OAUTH_ISSUER to https in authorization_servers", () => {
    process.env.OAUTH_ISSUER = "qualified-odyssey-45-staging.authkit.app/";
    const meta = protectedResourceMetadata("https://geo-radar-mcp.onrender.com");
    expect(meta.authorization_servers).toEqual([
      "https://qualified-odyssey-45-staging.authkit.app",
    ]);
  });
});
