import type { D1Database } from "@cloudflare/workers-types";

import { getSystemRelays } from "../services/db";
import type { SystemRelayRow } from "../services/db";

/** Health status values that allow a relay to be used for fanout. */
const HEALTHY_STATUSES = new Set(["ok", "unknown", null, undefined]);

/**
 * Load system relay universe from D1 (enabled relays only).
 * Filters out relays with health_status indicating unhealthy (e.g. "unhealthy", "failed").
 * No KV cache in Phase 1; can add caching later.
 */
export async function loadSystemRelayUniverse(
  db: D1Database,
): Promise<SystemRelayRow[]> {
  const rows = await getSystemRelays(db);
  return rows.filter((r) => HEALTHY_STATUSES.has(r.health_status ?? "unknown"));
}
