import { describe, it, expect, afterEach } from "vitest";
import { createQuotaEnforcer, quotaDeniedMessage, ALLOW_ALL_QUOTA } from "./quota";

describe("createQuotaEnforcer", () => {
  const saved = { on: process.env.QUOTA_ENABLED, redis: process.env.REDIS_URL };
  afterEach(() => {
    if (saved.on === undefined) delete process.env.QUOTA_ENABLED;
    else process.env.QUOTA_ENABLED = saved.on;
    if (saved.redis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = saved.redis;
  });

  it("is allow-all unless QUOTA_ENABLED=true", async () => {
    delete process.env.QUOTA_ENABLED;
    process.env.REDIS_URL = "redis://localhost:6379";
    expect(createQuotaEnforcer()).toBe(ALLOW_ALL_QUOTA);
  });

  it("is allow-all when enabled but no REDIS_URL", () => {
    process.env.QUOTA_ENABLED = "true";
    delete process.env.REDIS_URL;
    expect(createQuotaEnforcer()).toBe(ALLOW_ALL_QUOTA);
  });

  it("allow-all enforcer always allows", async () => {
    expect(await ALLOW_ALL_QUOTA.check("anyone")).toEqual({ allowed: true });
  });

  it("denied messages distinguish user vs global limit", () => {
    expect(quotaDeniedMessage({ allowed: false, reason: "user" })).toMatch(/your daily run limit/i);
    expect(quotaDeniedMessage({ allowed: false, reason: "global" })).toMatch(/global daily run limit/i);
  });
});
