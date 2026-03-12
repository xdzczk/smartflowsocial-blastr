import type { Env } from "../types";

const KV_PREFIX = "ratelimit:pubkey:";
const TTL_SECONDS = 60;

/**
 * Check per-pubkey rate limit using KV.
 * Returns { allowed: true } or { allowed: false, retryAfter }.
 */
export async function checkRateLimit(
  pubkey: string,
  env: Env,
  options?: { requestsPerMinute?: number },
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const requestsPerMinute = options?.requestsPerMinute ?? 60;
  const key = `${KV_PREFIX}${pubkey}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - 60;

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

  if (count >= requestsPerMinute) {
    const retryAfter = Math.max(1, start + 60 - now);
    return { allowed: false, retryAfter };
  }

  const newCount = count + 1;
  await env.PUBLISHED_NOTES.put(
    key,
    JSON.stringify({ count: newCount, windowStart: start }),
    { expirationTtl: TTL_SECONDS * 2 },
  );
  return { allowed: true };
}
