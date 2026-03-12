import type { D1Database } from "@cloudflare/workers-types";

import { getSystemRelays } from "../services/db";
import type { SystemRelayRow } from "../services/db";

/**
 * Load system relay universe from D1 (enabled relays only).
 * No KV cache in Phase 1; can add caching later.
 */
export async function loadSystemRelayUniverse(
  db: D1Database,
): Promise<SystemRelayRow[]> {
  return getSystemRelays(db);
}
