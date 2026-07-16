import { Redis } from "ioredis";
import { logger } from "./logger";

/**
 * Per-provider rate limiting via a Redis token bucket (FMEA P1: an unbounded panel
 * or many concurrent runs could hammer a provider into 429s / bans). Each provider
 * (anthropic / google / groq / perplexity) gets its own bucket keyed by name, shared
 * across all server + worker instances through Redis, so the aggregate call rate to
 * each provider is bounded regardless of how the work is spread.
 *
 * `acquire()` blocks until a token is available (smoothing bursts), giving up after
 * `maxWaitMs` and proceeding best-effort rather than hanging a run forever.
 */
export interface ProviderRateLimiter {
  acquire(provider: string): Promise<void>;
  close(): Promise<void>;
}

/** No-op limiter (no Redis / disabled) — used for local dev, tests, mock runs. */
export const NOOP_RATE_LIMITER: ProviderRateLimiter = {
  async acquire() {},
  async close() {},
};

export interface TokenBucketConfig {
  /** Sustained refill rate, tokens per second. */
  rate: number;
  /** Bucket capacity (max burst). */
  capacity: number;
}

export interface TokenBucketState {
  tokens: number;
  /** Last refill time (ms since epoch). */
  ts: number;
}

export interface TokenBucketDecision {
  allowed: boolean;
  retryAfterMs: number;
  state: TokenBucketState;
}

/**
 * Pure token-bucket step — the algorithm of record. `RedisTokenBucketLimiter` runs
 * an equivalent atomic Lua script (below); this function is what the tests pin, and
 * the Lua must stay behaviorally in sync with it.
 */
export function tokenBucketStep(
  prev: TokenBucketState | null,
  cfg: TokenBucketConfig,
  now: number,
  requested = 1,
): TokenBucketDecision {
  const tokens0 = prev ? prev.tokens : cfg.capacity;
  const ts0 = prev ? prev.ts : now;
  const refilled = Math.min(cfg.capacity, tokens0 + (Math.max(0, now - ts0) / 1000) * cfg.rate);
  if (refilled >= requested) {
    return { allowed: true, retryAfterMs: 0, state: { tokens: refilled - requested, ts: now } };
  }
  const retryAfterMs = Math.ceil(((requested - refilled) / cfg.rate) * 1000);
  return { allowed: false, retryAfterMs, state: { tokens: refilled, ts: now } };
}

// Atomic Redis equivalent of tokenBucketStep. Sources time from Redis (TIME) so
// buckets are correct across instances with skewed clocks. Returns {allowed, retryMs}.
const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local rate = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local requested = tonumber(ARGV[3])
local t = redis.call('TIME')
local now = (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then tokens = capacity; ts = now end
local refilled = math.min(capacity, tokens + ((math.max(0, now - ts) / 1000) * rate))
local allowed = 0
local retry = 0
if refilled >= requested then
  refilled = refilled - requested
  allowed = 1
else
  retry = math.ceil(((requested - refilled) / rate) * 1000)
end
redis.call('HSET', key, 'tokens', tostring(refilled), 'ts', tostring(now))
redis.call('PEXPIRE', key, math.ceil((capacity / rate) * 1000) + 2000)
return {allowed, retry}
`;

class RedisTokenBucketLimiter implements ProviderRateLimiter {
  private readonly redis: Redis;
  constructor(
    redisUrl: string,
    private readonly cfg: TokenBucketConfig,
    private readonly maxWaitMs: number,
  ) {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  }

  async acquire(provider: string): Promise<void> {
    const key = `ratelimit:provider:${provider}`;
    const deadline = Date.now() + this.maxWaitMs;
    for (;;) {
      let allowed = 1;
      let retry = 0;
      try {
        const res = (await this.redis.eval(
          TOKEN_BUCKET_LUA,
          1,
          key,
          this.cfg.rate,
          this.cfg.capacity,
          1,
        )) as [number, number];
        [allowed, retry] = res;
      } catch (err) {
        // Never let a limiter outage block real work — fail open.
        logger.warn("rate-limit: redis error, allowing through", {
          provider,
          err: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      if (allowed === 1) return;
      if (Date.now() + retry > deadline) {
        logger.warn("rate-limit: max wait exceeded, proceeding best-effort", { provider, retry });
        return;
      }
      await new Promise((r) => setTimeout(r, Math.min(retry, 250)));
    }
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

/**
 * Build the provider rate limiter from the environment. Active only when `REDIS_URL`
 * is set and `PROVIDER_RATE_LIMIT !== "off"`. Defaults: 5 tokens/s, burst 10, per
 * provider. Tune with PROVIDER_RATE_LIMIT_RPS / _BURST / _MAX_WAIT_MS.
 */
export function createProviderRateLimiter(): ProviderRateLimiter {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl || process.env.PROVIDER_RATE_LIMIT === "off") return NOOP_RATE_LIMITER;
  const rate = Number(process.env.PROVIDER_RATE_LIMIT_RPS ?? "5") || 5;
  const capacity = Number(process.env.PROVIDER_RATE_LIMIT_BURST ?? "10") || 10;
  const maxWaitMs = Number(process.env.PROVIDER_RATE_LIMIT_MAX_WAIT_MS ?? "30000") || 30000;
  logger.info("rate-limit: per-provider token bucket enabled", { rate, capacity, maxWaitMs });
  return new RedisTokenBucketLimiter(redisUrl, { rate, capacity }, maxWaitMs);
}
