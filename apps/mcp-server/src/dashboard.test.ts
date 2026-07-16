import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { dashboardApiGuard } from "./dashboard";

/** Minimal Express req/res/next doubles for exercising the /api guard. */
function ctx(headers: Record<string, string> = {}) {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    set() {
      return this;
    },
  };
  const req = { headers, protocol: "https", get: () => "host" } as unknown as Request;
  const next = vi.fn();
  return { req, res: res as unknown as Response & typeof res, next: next as NextFunction & typeof next };
}

describe("dashboardApiGuard", () => {
  const saved = { pub: process.env.DASHBOARD_PUBLIC, key: process.env.MCP_API_KEY, iss: process.env.OAUTH_ISSUER };
  beforeEach(() => {
    delete process.env.DASHBOARD_PUBLIC;
    delete process.env.MCP_API_KEY;
    delete process.env.OAUTH_ISSUER;
  });
  afterEach(() => {
    for (const [k, v] of [["DASHBOARD_PUBLIC", saved.pub], ["MCP_API_KEY", saved.key], ["OAUTH_ISSUER", saved.iss]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("is open by default (demo) — passes through", () => {
    const { req, res, next } = ctx();
    dashboardApiGuard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("fails closed with 503 when private but no auth is configured", () => {
    process.env.DASHBOARD_PUBLIC = "false";
    const { req, res, next } = ctx();
    dashboardApiGuard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
  });

  it("private + API key configured + no bearer → 401", async () => {
    process.env.DASHBOARD_PUBLIC = "false";
    process.env.MCP_API_KEY = "secret";
    const { req, res, next } = ctx();
    dashboardApiGuard(req, res, next);
    await new Promise((r) => setTimeout(r, 0));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("private + API key configured + correct bearer → passes through", async () => {
    process.env.DASHBOARD_PUBLIC = "false";
    process.env.MCP_API_KEY = "secret";
    const { req, res, next } = ctx({ authorization: "Bearer secret" });
    dashboardApiGuard(req, res, next);
    await new Promise((r) => setTimeout(r, 0));
    expect(next).toHaveBeenCalledOnce();
  });
});
