import type { D1Database } from "@cloudflare/workers-types";

import { getSystemRelays } from "../services/db";
import type { SystemRelayRow } from "../services/db";

import {
  WRITE_HEALTH_FAILED,
  isFailedRelayDueForRetry,
} from "./relay-write-health";

/**
 * Fanout may use ok, unknown, null, or blank health.
 * `failed` stays out until the write-health cooldown elapses.
 * Any other status stays out. Catalog read probes do not set this value.
 */
export function isUsableSystemRelayHealth(status?: string | null): boolean {
  return (
    status == null || status === "" || status === "ok" || status === "unknown"
  );
}

/**
 * Usable health is always in the universe. A failed relay returns after the cooldown.
 */
export function isSystemRelayInUniverse(
  healthStatus: string | null | undefined,
  lastCheckedAt: number | null | undefined,
  nowSeconds: number,
): boolean {
  if (isUsableSystemRelayHealth(healthStatus)) return true;
  if (healthStatus !== WRITE_HEALTH_FAILED) return false;
  return isFailedRelayDueForRetry(lastCheckedAt, nowSeconds);
}

/**
 * Load system relay universe from D1 (enabled relays only).
 * Failed relays are included again once their cooldown has elapsed.
 */
export async function loadSystemRelayUniverse(
  db: D1Database,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<SystemRelayRow[]> {
  const rows = await getSystemRelays(db);
  return rows.filter((row) =>
    isSystemRelayInUniverse(row.health_status, row.last_checked_at, nowSeconds),
  );
}
