import { describe, it, expect, afterEach } from "vitest";
import { tokenBucketStep, createProviderRateLimiter, NOOP_RATE_LIMITER } from "./rate-limit";

/**
 * tokenBucketStep is the algorithm of record (the Redis Lua mirrors it). These pin
 * refill, burst capping, depletion, and the retry-after estimate.
 */
describe("tokenBucketStep", () => {
  const cfg = { rate: 5, capacity: 10 }; // 5 tokens/s, burst 10

  it("starts full and allows a burst up to capacity", () => {
    let state = null as null | { tokens: number; ts: number };
    const now = 1_000_000;
    let allowedCount = 0;
    for (let i = 0; i < 12; i++) {
      const d = tokenBucketStep(state, cfg, now); // same instant → no refill
      if (d.allowed) allowedCount++;
      state = d.state;
    }
    expect(allowedCount).toBe(10); // exactly the burst capacity, then blocked
  });

  it("blocks when empty and reports a positive retry-after", () => {
    const empty = { tokens: 0, ts: 2_000_000 };
    const d = tokenBucketStep(empty, cfg, 2_000_000);
    expect(d.allowed).toBe(false);
    expect(d.retryAfterMs).toBe(200); // 1 token / 5 per sec = 200ms
  });

  it("refills over elapsed time (2s → 10 tokens at 5/s, capped at capacity)", () => {
    const empty = { tokens: 0, ts: 3_000_000 };
    const d = tokenBucketStep(empty, cfg, 3_002_000); // +2s
    expect(d.allowed).toBe(true);
    expect(d.state.tokens).toBeCloseTo(9, 5); // 10 refilled, minus 1 taken
  });

  it("never refills beyond capacity", () => {
    const d = tokenBucketStep({ tokens: 8, ts: 0 }, cfg, 100_000); // huge elapsed
    expect(d.state.tokens).toBeLessThanOrEqual(cfg.capacity);
  });
});

describe("createProviderRateLimiter", () => {
  const saved = { redis: process.env.REDIS_URL, off: process.env.PROVIDER_RATE_LIMIT };
  afterEach(() => {
    if (saved.redis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = saved.redis;
    if (saved.off === undefined) delete process.env.PROVIDER_RATE_LIMIT;
    else process.env.PROVIDER_RATE_LIMIT = saved.off;
  });

  it("is a no-op when REDIS_URL is not set", () => {
    delete process.env.REDIS_URL;
    expect(createProviderRateLimiter()).toBe(NOOP_RATE_LIMITER);
  });

  it("is a no-op when explicitly disabled", () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.PROVIDER_RATE_LIMIT = "off";
    expect(createProviderRateLimiter()).toBe(NOOP_RATE_LIMITER);
  });
});
