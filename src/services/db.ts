import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";

import {
  healthStatusAfterAttempts,
  WRITE_HEALTH_FAILURE_THRESHOLD,
} from "../core/relay-write-health";
import type {
  EntitlementStatus,
  PolicyRelayAction,
  PublishJobSource,
  PublishJobStatus,
  UserPolicyMode,
} from "../types";

export interface EntitlementRow {
  pubkey: string;
  plan_tier: string;
  status: EntitlementStatus;
  rate_limit_profile: string | null;
  updated_at: number;
}

export interface UserPolicyRow {
  pubkey: string;
  mode: UserPolicyMode;
  enabled: number;
  updated_at: number;
}

export interface PolicyRelayRow {
  pubkey: string;
  relay_url: string;
  action: PolicyRelayAction;
  created_at: number;
}

export interface SystemRelayRow {
  id: number;
  relay_url: string;
  enabled: number;
  health_status: string | null;
  score: number;
  category: string | null;
  last_checked_at: number | null;
  notes: string | null;
}

export interface PublishJobRow {
  id: number;
  event_id: string;
  pubkey: string;
  source: PublishJobSource;
  received_at: number;
  status: PublishJobStatus;
  relay_count_target: number;
  relay_count_success: number;
  relay_count_failed: number;
  resolved_relays: string;
}

/** Normalize hex pubkey to lowercase so lookups match regardless of event/signer case. */
function normalizePubkeyHex(pubkey: string): string {
  if (typeof pubkey !== "string" || pubkey.length !== 64) return pubkey;
  if (/^[0-9a-fA-F]{64}$/.test(pubkey)) return pubkey.toLowerCase();
  return pubkey;
}

export async function getEntitlement(
  db: D1Database,
  pubkey: string,
): Promise<EntitlementRow | null> {
  const key = normalizePubkeyHex(pubkey);
  const stmt = db
    .prepare(
      `SELECT pubkey, plan_tier, status, rate_limit_profile, updated_at
     FROM blastr_entitlements WHERE pubkey = ? AND status IN (?, ?)`,
    )
    .bind(key, "active", "grace");
  const row = await stmt.first<EntitlementRow>();
  return row ?? null;
}

export async function getUserPolicy(
  db: D1Database,
  pubkey: string,
): Promise<UserPolicyRow | null> {
  const key = normalizePubkeyHex(pubkey);
  const stmt = db
    .prepare(
      `SELECT pubkey, mode, enabled, updated_at FROM blastr_user_policies WHERE pubkey = ?`,
    )
    .bind(key);
  const row = await stmt.first<UserPolicyRow>();
  return row ?? null;
}

export async function getPolicyRelays(
  db: D1Database,
  pubkey: string,
): Promise<PolicyRelayRow[]> {
  const key = normalizePubkeyHex(pubkey);
  const stmt = db
    .prepare(
      `SELECT pubkey, relay_url, action, created_at FROM blastr_policy_relays WHERE pubkey = ? ORDER BY created_at ASC`,
    )
    .bind(key);
  const { results } = await stmt.all<PolicyRelayRow>();
  return results;
}

export async function getSystemRelays(
  db: D1Database,
): Promise<SystemRelayRow[]> {
  const stmt = db.prepare(
    `SELECT id, relay_url, enabled, health_status, score, category, last_checked_at, notes
     FROM blastr_system_relays WHERE enabled = 1 ORDER BY score DESC, relay_url ASC`,
  );
  const { results } = await stmt.all<SystemRelayRow>();
  return results;
}

export async function getJobById(
  db: D1Database,
  jobId: number,
): Promise<PublishJobRow | null> {
  const stmt = db
    .prepare(
      `SELECT id, event_id, pubkey, source, received_at, status,
              relay_count_target, relay_count_success, relay_count_failed, resolved_relays
       FROM blastr_publish_jobs WHERE id = ?`,
    )
    .bind(jobId);
  const row = await stmt.first<PublishJobRow>();
  return row ?? null;
}

export async function getJobByEventId(
  db: D1Database,
  eventId: string,
): Promise<PublishJobRow | null> {
  const stmt = db
    .prepare(
      `SELECT id, event_id, pubkey, source, received_at, status,
              relay_count_target, relay_count_success, relay_count_failed, resolved_relays
       FROM blastr_publish_jobs WHERE event_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .bind(eventId);
  const row = await stmt.first<PublishJobRow>();
  return row ?? null;
}

export async function upsertEntitlement(
  db: D1Database,
  params: {
    pubkey: string;
    plan_tier: string;
    status: EntitlementStatus;
    rate_limit_profile?: string | null;
  },
): Promise<void> {
  const key = normalizePubkeyHex(params.pubkey);
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO blastr_entitlements (pubkey, plan_tier, status, rate_limit_profile, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(pubkey) DO UPDATE SET
         plan_tier = excluded.plan_tier,
         status = excluded.status,
         rate_limit_profile = excluded.rate_limit_profile,
         updated_at = excluded.updated_at`,
    )
    .bind(
      key,
      params.plan_tier,
      params.status,
      params.rate_limit_profile ?? null,
      now,
    )
    .run();
}

export async function upsertUserPolicy(
  db: D1Database,
  params: { pubkey: string; mode: UserPolicyMode; enabled?: number },
): Promise<void> {
  const key = normalizePubkeyHex(params.pubkey);
  const now = Math.floor(Date.now() / 1000);
  const enabled = params.enabled ?? 1;
  await db
    .prepare(
      `INSERT INTO blastr_user_policies (pubkey, mode, enabled, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(pubkey) DO UPDATE SET
         mode = excluded.mode,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`,
    )
    .bind(key, params.mode, enabled, now)
    .run();
}

export async function addPolicyRelay(
  db: D1Database,
  params: { pubkey: string; relay_url: string; action: PolicyRelayAction },
): Promise<void> {
  const key = normalizePubkeyHex(params.pubkey);
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO blastr_policy_relays (pubkey, relay_url, action, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(pubkey, relay_url) DO UPDATE SET action = excluded.action, created_at = excluded.created_at`,
    )
    .bind(key, params.relay_url, params.action, now)
    .run();
}

/** All system relays, including disabled rows, for catalog sync. */
export interface SystemRelayMembership {
  relay_url: string;
  enabled: number;
  health_status: string | null;
  score: number;
  operator_hold: number;
  last_checked_at: number | null;
}

/** Catalog sync writes. Updates must not carry health or last_checked_at. */
export interface MembershipDiff {
  insert: { relay_url: string; score: number }[];
  update: { relay_url: string; enabled: number; score: number }[];
}

const LIST_SYSTEM_RELAY_MEMBERSHIP_SQL =
  "SELECT relay_url, enabled, health_status, score, operator_hold, last_checked_at FROM blastr_system_relays";

/** New catalog rows only. health_status starts unknown; updates never use this statement. */
const INSERT_CATALOG_RELAY_SQL =
  "INSERT INTO blastr_system_relays (relay_url, enabled, health_status, score, operator_hold) VALUES (?, 1, 'unknown', ?, 0)";

/** Membership and score only. Does not write health_status or last_checked_at. */
const UPDATE_CATALOG_MEMBERSHIP_SQL =
  "UPDATE blastr_system_relays SET enabled = ?, score = ? WHERE relay_url = ?";

const RECENT_ATTEMPT_STATUSES_SQL =
  "SELECT status FROM blastr_publish_attempts WHERE relay_url = ? ORDER BY id DESC LIMIT ?";

const MARK_WRITE_HEALTH_SQL =
  "UPDATE blastr_system_relays SET last_checked_at = ?, health_status = ? WHERE relay_url = ?";

const TOUCH_WRITE_CHECKED_SQL =
  "UPDATE blastr_system_relays SET last_checked_at = ? WHERE relay_url = ?";

export async function listSystemRelayMembership(
  db: D1Database,
): Promise<SystemRelayMembership[]> {
  const { results } = await db
    .prepare(LIST_SYSTEM_RELAY_MEMBERSHIP_SQL)
    .all<SystemRelayMembership>();
  return results;
}

/**
 * Apply a catalog diff. Inserts start at health unknown.
 * Updates change enabled and score only.
 */
export async function applySystemRelayMembership(
  db: D1Database,
  diff: MembershipDiff,
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (const row of diff.insert) {
    statements.push(
      db.prepare(INSERT_CATALOG_RELAY_SQL).bind(row.relay_url, row.score),
    );
  }
  for (const row of diff.update) {
    statements.push(
      db
        .prepare(UPDATE_CATALOG_MEMBERSHIP_SQL)
        .bind(row.enabled, row.score, row.relay_url),
    );
  }
  if (statements.length === 0) return;
  await db.batch(statements);
}

async function recentAttemptStatuses(
  db: D1Database,
  relayUrl: string,
): Promise<string[]> {
  const { results } = await db
    .prepare(RECENT_ATTEMPT_STATUSES_SQL)
    .bind(relayUrl, WRITE_HEALTH_FAILURE_THRESHOLD)
    .all<{ status: string }>();
  return results.map((row) => row.status);
}

/**
 * Write health from one fanout result for a system relay.
 * The attempt row must already be inserted so a failure streak includes it.
 * Success sets ok. Three consecutive failed results set failed.
 * A shorter failure streak only moves last_checked_at.
 * Relays that are not in blastr_system_relays are unchanged (no matching row).
 */
export async function recordSystemRelayWriteHealth(
  db: D1Database,
  params: { relayUrl: string; success: boolean },
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<void> {
  const statuses = params.success
    ? []
    : await recentAttemptStatuses(db, params.relayUrl);
  const next = healthStatusAfterAttempts(params.success, statuses);
  if (next === null) {
    await db
      .prepare(TOUCH_WRITE_CHECKED_SQL)
      .bind(nowSeconds, params.relayUrl)
      .run();
    return;
  }
  await db
    .prepare(MARK_WRITE_HEALTH_SQL)
    .bind(nowSeconds, next, params.relayUrl)
    .run();
}

export async function removePolicyRelay(
  db: D1Database,
  pubkey: string,
  relayUrl: string,
): Promise<void> {
  const key = normalizePubkeyHex(pubkey);
  await db
    .prepare(
      `DELETE FROM blastr_policy_relays WHERE pubkey = ? AND relay_url = ?`,
    )
    .bind(key, relayUrl)
    .run();
}
