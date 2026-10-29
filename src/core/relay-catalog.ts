import type { D1Database } from "@cloudflare/workers-types";

import { getSystemRelays } from "../services/db";
import type { SystemRelayRow } from "../services/db";

/**
 * Fanout may use ok, unknown, null, or blank health.
 * Any other status (including write-health "failed") is out of the universe.
 * Catalog read probes do not set this value.
 */
export function isUsableSystemRelayHealth(
  status: string | null | undefined,
): boolean {
  return (
    status == null || status === "" || status === "ok" || status === "unknown"
  );
}

/**
 * Load system relay universe from D1 (enabled relays only).
 * Filters out relays whose write health is not usable.
 */
export async function loadSystemRelayUniverse(
  db: D1Database,
): Promise<SystemRelayRow[]> {
  const rows = await getSystemRelays(db);
  return rows.filter((row) => isUsableSystemRelayHealth(row.health_status));
}
