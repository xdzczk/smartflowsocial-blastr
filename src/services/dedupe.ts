import type { KVNamespace } from "@cloudflare/workers-types";

const DEDUPE_PREFIX = "published:";
const DEDUPE_TTL_SECONDS = 86400 * 7; // 7 days

export async function isPublished(
  eventId: string,
  kv: KVNamespace,
): Promise<boolean> {
  const key = `${DEDUPE_PREFIX}${eventId}`;
  const value = await kv.get(key);
  return value !== null;
}

export async function markPublished(
  eventId: string,
  kv: KVNamespace,
): Promise<void> {
  const key = `${DEDUPE_PREFIX}${eventId}`;
  await kv.put(key, new Date().toISOString(), {
    expirationTtl: DEDUPE_TTL_SECONDS,
  });
}
