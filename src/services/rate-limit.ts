import type { Env } from "../types";

const KV_PREFIX = "ratelimit:pubkey:";
const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_REQUESTS_PER_WINDOW = 60;
const MIN_WINDOW_SECONDS = 1;
const MAX_WINDOW_SECONDS = 86400;

/** Per-profile overrides (optional). Profile name from entitlement.rate_limit_profile. */
const PROFILE_LIMITS: Record<
  string,
  { requestsPerWindow: number; windowSeconds: number }
> = {
  premium: { requestsPerWindow: 300, windowSeconds: 60 },
  default: {
    requestsPerWindow: DEFAULT_REQUESTS_PER_WINDOW,
    windowSeconds: DEFAULT_WINDOW_SECONDS,
  },
};

function getRateLimitConfig(
  env: Env,
  profile?: string | null,
): {
  windowSeconds: number;
  requestsPerWindow: number;
} {
  if (profile && PROFILE_LIMITS[profile]) {
    return PROFILE_LIMITS[profile];
  }
  let windowSeconds = DEFAULT_WINDOW_SECONDS;
  if (env.RATE_LIMIT_WINDOW_MS) {
    const ms = parseInt(env.RATE_LIMIT_WINDOW_MS, 10);
    if (!Number.isNaN(ms) && ms > 0) {
      windowSeconds = Math.max(
        MIN_WINDOW_SECONDS,
        Math.min(MAX_WINDOW_SECONDS, Math.floor(ms / 1000)),
      );
    }
  }
  let requestsPerWindow = DEFAULT_REQUESTS_PER_WINDOW;
  if (env.RATE_LIMIT_REQUESTS) {
    const n = parseInt(env.RATE_LIMIT_REQUESTS, 10);
    if (!Number.isNaN(n) && n > 0) {
      requestsPerWindow = n;
    }
  }
  return { windowSeconds, requestsPerWindow };
}

/**
 * Check per-pubkey rate limit using KV.
 * Window and limit from env or from profile (entitlement.rate_limit_profile).
 * Returns { allowed: true } or { allowed: false, retryAfter }.
 */
export async function checkRateLimit(
  pubkey: string,
  env: Env,
  options?: { requestsPerMinute?: number; rateLimitProfile?: string | null },
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const config = getRateLimitConfig(env, options?.rateLimitProfile);
  const requestsPerWindow =
    options?.requestsPerMinute ?? config.requestsPerWindow;
  const windowSeconds = config.windowSeconds;

  const key = `${KV_PREFIX}${pubkey}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSeconds;

  const raw = await env.PUBLISHED_NOTES.get(key, { type: "json" });
  type Count = { count: number; windowStart: number };
  const data = raw as Count | null;
  let count = 0;
  let start = windowStart;
  if (data && typeof data === "object" && typeof data.count === "number") {
    if (data.windowStart >= windowStart) {
      count = data.count;
      start = data.windowStart;
    }
  }

  if (count >= requestsPerWindow) {
    const retryAfter = Math.max(1, start + windowSeconds - now);
    return { allowed: false, retryAfter };
  }

  const newCount = count + 1;
  const ttlSeconds = Math.min(86400, windowSeconds * 2);
  await env.PUBLISHED_NOTES.put(
    key,
    JSON.stringify({ count: newCount, windowStart: start }),
    { expirationTtl: ttlSeconds },
  );
  return { allowed: true };
}
