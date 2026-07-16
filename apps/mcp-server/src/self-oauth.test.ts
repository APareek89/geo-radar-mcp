import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  createSelfHostedOAuthRouter,
  selfHostedLoginGate,
  verifySelfIssuedToken,
} from "./self-oauth";

const ENV = ["OAUTH_MODE", "OAUTH_AUDIENCE", "MCP_LOGIN_PASSWORD", "OAUTH_SIGNING_SECRET"] as const;

function gateCtx(headers: Record<string, string> = {}) {
  const res = {
    statusCode: 0,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    set() {
      return this;
    },
    type() {
      return this;
    },
    send() {
      return this;
    },
  };
  const req = { headers } as unknown as Request;
  const next = vi.fn();
  return { req, res: res as unknown as Response & typeof res, next: next as NextFunction & typeof next };
}

describe("self-hosted OAuth", () => {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  beforeEach(() => {
    for (const k of ENV) delete process.env[k];
    process.env.OAUTH_AUDIENCE = "https://geo-radar-mcp.onrender.com";
    process.env.OAUTH_SIGNING_SECRET = "unit-test-secret";
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  });

  it("router is off unless OAUTH_MODE=selfhosted", () => {
    expect(createSelfHostedOAuthRouter()).toBeNull();
    process.env.OAUTH_MODE = "selfhosted";
    expect(typeof createSelfHostedOAuthRouter()).toBe("function");
  });

  it("verifies a token it signed", async () => {
    // Round-trip through the provider by signing via a token exchange is covered by the
    // live E2E; here assert verify accepts a freshly-issued token shape.
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({ scope: "mcp", client_id: "mcp_abc" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("owner")
      .setIssuer("https://geo-radar-mcp.onrender.com")
      .setAudience("https://geo-radar-mcp.onrender.com")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("unit-test-secret"));
    const info = await verifySelfIssuedToken(token);
    expect(info.clientId).toBe("mcp_abc");
    expect(info.scopes).toEqual(["mcp"]);
  });

  it("rejects a token signed with a different secret", async () => {
    const { SignJWT } = await import("jose");
    const bad = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("https://geo-radar-mcp.onrender.com")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("WRONG-secret"));
    await expect(verifySelfIssuedToken(bad)).rejects.toBeTruthy();
  });

  it("login gate: 401 without Basic, passes with the right password", () => {
    process.env.MCP_LOGIN_PASSWORD = "hunter2";
    const bad = gateCtx();
    selfHostedLoginGate(bad.req, bad.res, bad.next);
    expect(bad.next).not.toHaveBeenCalled();
    expect(bad.res.statusCode).toBe(401);

    const ok = gateCtx({ authorization: `Basic ${Buffer.from("owner:hunter2").toString("base64")}` });
    selfHostedLoginGate(ok.req, ok.res, ok.next);
    expect(ok.next).toHaveBeenCalledOnce();
  });

  it("login gate: wrong password stays 401", () => {
    process.env.MCP_LOGIN_PASSWORD = "hunter2";
    const c = gateCtx({ authorization: `Basic ${Buffer.from("owner:nope").toString("base64")}` });
    selfHostedLoginGate(c.req, c.res, c.next);
    expect(c.next).not.toHaveBeenCalled();
    expect(c.res.statusCode).toBe(401);
  });
});
