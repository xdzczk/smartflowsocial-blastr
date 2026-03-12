import type { D1Database } from "@cloudflare/workers-types";

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

export async function getEntitlement(
  db: D1Database,
  pubkey: string,
): Promise<EntitlementRow | null> {
  const stmt = db
    .prepare(
      `SELECT pubkey, plan_tier, status, rate_limit_profile, updated_at
     FROM blastr_entitlements WHERE pubkey = ? AND status IN (?, ?)`,
    )
    .bind(pubkey, "active", "grace");
  const row = await stmt.first<EntitlementRow>();
  return row ?? null;
}

export async function getUserPolicy(
  db: D1Database,
  pubkey: string,
): Promise<UserPolicyRow | null> {
  const stmt = db
    .prepare(
      `SELECT pubkey, mode, enabled, updated_at FROM blastr_user_policies WHERE pubkey = ?`,
    )
    .bind(pubkey);
  const row = await stmt.first<UserPolicyRow>();
  return row ?? null;
}

export async function getPolicyRelays(
  db: D1Database,
  pubkey: string,
): Promise<PolicyRelayRow[]> {
  const stmt = db
    .prepare(
      `SELECT pubkey, relay_url, action, created_at FROM blastr_policy_relays WHERE pubkey = ? ORDER BY created_at ASC`,
    )
    .bind(pubkey);
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
      params.pubkey,
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
    .bind(params.pubkey, params.mode, enabled, now)
    .run();
}

export async function addPolicyRelay(
  db: D1Database,
  params: { pubkey: string; relay_url: string; action: PolicyRelayAction },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO blastr_policy_relays (pubkey, relay_url, action, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(pubkey, relay_url) DO UPDATE SET action = excluded.action, created_at = excluded.created_at`,
    )
    .bind(params.pubkey, params.relay_url, params.action, now)
    .run();
}

export async function removePolicyRelay(
  db: D1Database,
  pubkey: string,
  relayUrl: string,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM blastr_policy_relays WHERE pubkey = ? AND relay_url = ?`,
    )
    .bind(pubkey, relayUrl)
    .run();
}
