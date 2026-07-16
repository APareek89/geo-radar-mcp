import { Redis } from "ioredis";
import { logger } from "./logger";

/**
 * Per-user + global daily run quotas (for a PUBLIC deployment where signed-up users
 * spend the owner's LLM budget). Each authenticated user gets `QUOTA_PER_USER_DAILY`
 * runs/day; a `QUOTA_GLOBAL_DAILY` ceiling caps everyone combined. Counters live in
 * Redis keyed by user id + calendar day, so limits hold across all instances.
 *
 * Opt-in: active only when `QUOTA_ENABLED=true` (single-owner/self-hosted deploys
 * leave it off). The per-run cost cap (`PANEL_COST_CAP_USD_PER_RUN`) is the backstop,
 * so this fails **open** on a Redis error rather than denying legitimate users.
 */
export interface QuotaResult {
  allowed: boolean;
  reason?: "user" | "global";
  remainingUser?: number;
  remainingGlobal?: number;
}

export interface QuotaEnforcer {
  /** Atomically check + consume one run for `userId`. */
  check(userId: string): Promise<QuotaResult>;
  close(): Promise<void>;
}

export const ALLOW_ALL_QUOTA: QuotaEnforcer = {
  async check() {
    return { allowed: true };
  },
  async close() {},
};

// Atomic check-and-increment of both counters. Denies (without incrementing) if the
// next run would exceed either limit; otherwise increments both and sets a 2-day TTL
// (the calendar day is already in the key, so this just auto-cleans old keys).
const QUOTA_LUA = `
local uKey, gKey = KEYS[1], KEYS[2]
local uLimit = tonumber(ARGV[1])
local gLimit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local u = tonumber(redis.call('GET', uKey) or '0')
local g = tonumber(redis.call('GET', gKey) or '0')
if u + 1 > uLimit then return {0, 'user', 0, gLimit - g} end
if g + 1 > gLimit then return {0, 'global', uLimit - u, 0} end
redis.call('INCR', uKey); redis.call('EXPIRE', uKey, ttl)
redis.call('INCR', gKey); redis.call('EXPIRE', gKey, ttl)
return {1, '', uLimit - u - 1, gLimit - g - 1}
`;

class RedisQuotaEnforcer implements QuotaEnforcer {
  private readonly redis: Redis;
  private loggedErr = false;
  constructor(
    redisUrl: string,
    private readonly perUser: number,
    private readonly global: number,
    private readonly exempt: Set<string>,
  ) {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.redis.on("error", (err: Error) => {
      if (this.loggedErr) return;
      this.loggedErr = true;
      logger.warn("quota: redis connection error (failing open)", { err: err.message });
    });
  }

  async check(userId: string): Promise<QuotaResult> {
    if (this.exempt.has(userId)) return { allowed: true };
    const day = new Date().toISOString().slice(0, 10);
    try {
      const res = (await this.redis.eval(
        QUOTA_LUA,
        2,
        `quota:user:${userId}:${day}`,
        `quota:global:${day}`,
        this.perUser,
        this.global,
        172800, // 2 days
      )) as [number, string, number, number];
      const [allowed, reason, remainingUser, remainingGlobal] = res;
      if (allowed === 1) return { allowed: true, remainingUser, remainingGlobal };
      logger.info("quota: denied", { userId, reason, remainingUser, remainingGlobal });
      return { allowed: false, reason: reason as "user" | "global", remainingUser, remainingGlobal };
    } catch (err) {
      // Fail open — the per-run cost cap bounds the damage of a brief miss.
      logger.warn("quota: check failed, allowing through", {
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { allowed: true };
    }
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

/**
 * Build the quota enforcer from the environment. Off (allow-all) unless
 * `QUOTA_ENABLED=true` and `REDIS_URL` is set. Config: `QUOTA_PER_USER_DAILY`
 * (default 10), `QUOTA_GLOBAL_DAILY` (default 200), `QUOTA_EXEMPT_USERS` (csv of
 * user ids/emails, e.g. the owner).
 */
export function createQuotaEnforcer(): QuotaEnforcer {
  const redisUrl = process.env.REDIS_URL;
  if (process.env.QUOTA_ENABLED !== "true" || !redisUrl) return ALLOW_ALL_QUOTA;
  const perUser = Number(process.env.QUOTA_PER_USER_DAILY ?? "10") || 10;
  const global = Number(process.env.QUOTA_GLOBAL_DAILY ?? "200") || 200;
  const exempt = new Set(
    (process.env.QUOTA_EXEMPT_USERS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  logger.info("quota: per-user daily quotas enabled", { perUser, global, exempt: exempt.size });
  return new RedisQuotaEnforcer(redisUrl, perUser, global, exempt);
}

/** A user-facing message for a denied run. */
export function quotaDeniedMessage(r: QuotaResult): string {
  if (r.reason === "global") {
    return "This shared demo has hit its global daily run limit. Please try again tomorrow.";
  }
  return "You've reached your daily run limit for this MCP. Please try again tomorrow.";
}
