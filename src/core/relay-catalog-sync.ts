import type { Logger } from "../logger";
import {
  applySystemRelayMembership,
  listSystemRelayMembership,
} from "../services/db";
import type { SystemRelayMembership } from "../services/db";
import type { Env } from "../types";

/** NostrMash catalog default and maximum page size. */
export const CATALOG_LIMIT_DEFAULT = 50;
export const CATALOG_LIMIT_MAX = 100;

const CATALOG_PATH = "/api/v1/relays/catalog";
const CATALOG_FETCH_TIMEOUT_MS = 10_000;
const SYNC_SKIPPED = "Relay catalog sync skipped";

export interface CatalogRelay {
  relay_url: string;
  distinct_users: number;
}

export interface ParsedCatalog {
  generatedAt: string;
  freshnessSeconds: number;
  relays: CatalogRelay[];
}

export type CatalogSyncResult =
  | {
      applied: false;
      reason:
        | "missing_base_url"
        | "fetch_failed"
        | "parse_failed"
        | "empty_catalog";
    }
  | { applied: true; inserted: number; updated: number };

type CatalogFetchResult =
  | { ok: true; catalog: ParsedCatalog }
  | { ok: false; reason: "fetch_failed"; status?: number }
  | { ok: false; reason: "parse_failed" };

/**
 * Blastr's catalog cap. Unset or non-numeric values use 50.
 * Numeric values clamp to 1..100 (the NostrMash maximum).
 */
export function clampCatalogLimit(raw: string | undefined): number {
  if (raw === undefined) return CATALOG_LIMIT_DEFAULT;
  const trimmed = raw.trim();
  if (trimmed === "") return CATALOG_LIMIT_DEFAULT;
  if (/^-\d+$/.test(trimmed)) return 1;
  if (!/^\d+$/.test(trimmed)) return CATALOG_LIMIT_DEFAULT;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) return CATALOG_LIMIT_DEFAULT;
  if (parsed < 1) return 1;
  if (parsed > CATALOG_LIMIT_MAX) return CATALOG_LIMIT_MAX;
  return parsed;
}

export function catalogRequestUrl(apiBase: string, limit: number): string {
  const base = apiBase.trim().replace(/\/+$/, "");
  return `${base}${CATALOG_PATH}?limit=${limit}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Read relay_url and distinct_users only. The catalog float `score` is ignored
 * so it is never truncated into the integer score column.
 * Returns null when the entry is not usable; the caller rejects the whole body.
 */
function parseCatalogRelay(entry: unknown): CatalogRelay | null {
  if (!isRecord(entry)) return null;
  const relayUrl = entry["relay_url"];
  const distinctUsers = entry["distinct_users"];
  if (typeof relayUrl !== "string" || relayUrl === "") return null;
  if (!isNonNegativeSafeInteger(distinctUsers)) return null;
  return { relay_url: relayUrl, distinct_users: distinctUsers };
}

/** Null means the body is not a catalog. An empty relays array is valid. */
export function parseRelayCatalog(body: unknown): ParsedCatalog | null {
  if (!isRecord(body)) return null;
  const generatedAt = body["generated_at"];
  const freshnessSeconds = body["freshness_seconds"];
  const relays = body["relays"];
  if (typeof generatedAt !== "string" || generatedAt === "") return null;
  if (!isNonNegativeSafeInteger(freshnessSeconds)) return null;
  if (!Array.isArray(relays)) return null;

  const parsed: CatalogRelay[] = [];
  const seen = new Set<string>();
  for (const entry of relays) {
    const relay = parseCatalogRelay(entry);
    if (!relay) return null;
    if (seen.has(relay.relay_url)) continue;
    seen.add(relay.relay_url);
    parsed.push(relay);
  }
  return { generatedAt, freshnessSeconds, relays: parsed };
}

function isOperatorHeld(row: SystemRelayMembership): boolean {
  return row.operator_hold !== 0;
}

function copyMembership(row: SystemRelayMembership): SystemRelayMembership {
  return { ...row };
}

function newCatalogMembership(
  relayUrl: string,
  distinctUsers: number,
): SystemRelayMembership {
  return {
    relay_url: relayUrl,
    enabled: 1,
    health_status: "unknown",
    score: distinctUsers,
    operator_hold: 0,
    last_checked_at: null,
  };
}

function membershipFromCatalog(
  existing: SystemRelayMembership,
  distinctUsers: number,
): SystemRelayMembership {
  return {
    ...existing,
    score: distinctUsers,
    enabled: isOperatorHeld(existing) ? existing.enabled : 1,
  };
}

function catalogScoresByUrl(
  catalog: readonly CatalogRelay[],
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const relay of catalog) {
    if (!scores.has(relay.relay_url)) {
      scores.set(relay.relay_url, relay.distinct_users);
    }
  }
  return scores;
}

/**
 * Next membership after a non-empty catalog.
 * An empty catalog returns the current rows unchanged (do not wipe).
 * Copies health_status and last_checked_at. Score is distinct_users.
 * operator_hold freezes enabled: disabled stays off, pinned stays when absent.
 */
export function planCatalogMembership(
  current: readonly SystemRelayMembership[],
  catalog: readonly CatalogRelay[],
): SystemRelayMembership[] {
  if (catalog.length === 0) return current.map((row) => copyMembership(row));

  const catalogScores = catalogScoresByUrl(catalog);
  const currentByUrl = new Map(current.map((row) => [row.relay_url, row]));
  const next: SystemRelayMembership[] = [];

  for (const [relayUrl, distinctUsers] of catalogScores) {
    const existing = currentByUrl.get(relayUrl);
    next.push(
      existing
        ? membershipFromCatalog(existing, distinctUsers)
        : newCatalogMembership(relayUrl, distinctUsers),
    );
  }

  for (const row of current) {
    if (catalogScores.has(row.relay_url)) continue;
    next.push(
      isOperatorHeld(row) ? copyMembership(row) : { ...row, enabled: 0 },
    );
  }
  return next;
}

async function fetchRelayCatalog(
  apiBase: string,
  limit: number,
  fetchImpl: typeof fetch,
): Promise<CatalogFetchResult> {
  let response: Response;
  try {
    response = await fetchImpl(catalogRequestUrl(apiBase, limit), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }
  if (!response.ok) {
    return { ok: false, reason: "fetch_failed", status: response.status };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "parse_failed" };
  }
  const catalog = parseRelayCatalog(body);
  if (!catalog) return { ok: false, reason: "parse_failed" };
  return { ok: true, catalog };
}

/**
 * Scheduled catalog sync. Not used on the publish path.
 * Read-liveness membership only: a catalog relay may still reject EVENT.
 * HTTP failure, parse failure, and relays: [] leave D1 membership unchanged.
 */
export async function syncSystemRelayCatalog(
  env: Env,
  logger: Pick<Logger, "info" | "warn">,
  fetchImpl: typeof fetch = fetch,
): Promise<CatalogSyncResult> {
  const apiBase = env.NOSTRMASH_API_BASE?.trim() ?? "";
  if (apiBase === "") {
    logger.warn(SYNC_SKIPPED, { reason: "missing_base_url" });
    return { applied: false, reason: "missing_base_url" };
  }

  const limit = clampCatalogLimit(env.BLASTR_RELAY_CATALOG_LIMIT);
  const fetched = await fetchRelayCatalog(apiBase, limit, fetchImpl);
  if (!fetched.ok) {
    logger.warn(SYNC_SKIPPED, {
      reason: fetched.reason,
      ...(fetched.reason === "fetch_failed" && fetched.status !== undefined
        ? { status: fetched.status }
        : {}),
    });
    return { applied: false, reason: fetched.reason };
  }
  if (fetched.catalog.relays.length === 0) {
    logger.info(SYNC_SKIPPED, { reason: "empty_catalog" });
    return { applied: false, reason: "empty_catalog" };
  }

  const current = await listSystemRelayMembership(env.DB);
  const next = planCatalogMembership(current, fetched.catalog.relays);
  const diff = diffFromMembership(current, next);
  if (diff.insert.length === 0 && diff.update.length === 0) {
    logger.info("Relay catalog sync finished", {
      generatedAt: fetched.catalog.generatedAt,
      inserted: 0,
      updated: 0,
    });
    return { applied: true, inserted: 0, updated: 0 };
  }

  await applySystemRelayMembership(env.DB, diff);
  logger.info("Relay catalog sync finished", {
    generatedAt: fetched.catalog.generatedAt,
    freshnessSeconds: fetched.catalog.freshnessSeconds,
    inserted: diff.insert.length,
    updated: diff.update.length,
  });
  return {
    applied: true,
    inserted: diff.insert.length,
    updated: diff.update.length,
  };
}

/**
 * Diff used by sync. Exported so tests can show updates carry enabled and
 * score only. Production sync uses the same comparison.
 */
export function diffFromMembership(
  current: readonly SystemRelayMembership[],
  next: readonly SystemRelayMembership[],
): {
  insert: { relay_url: string; score: number }[];
  update: { relay_url: string; enabled: number; score: number }[];
} {
  const currentByUrl = new Map(current.map((row) => [row.relay_url, row]));
  const insert: { relay_url: string; score: number }[] = [];
  const update: { relay_url: string; enabled: number; score: number }[] = [];
  for (const row of next) {
    const prev = currentByUrl.get(row.relay_url);
    if (!prev) {
      insert.push({ relay_url: row.relay_url, score: row.score });
      continue;
    }
    if (prev.enabled !== row.enabled || prev.score !== row.score) {
      update.push({
        relay_url: row.relay_url,
        enabled: row.enabled,
        score: row.score,
      });
    }
  }
  return { insert, update };
}
