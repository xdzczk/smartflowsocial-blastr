import type { D1Database } from "@cloudflare/workers-types";

import type { PublishJobSource } from "../types";

import { getJobByEventId } from "./db";

export interface CreateJobParams {
  eventId: string;
  pubkey: string;
  source: PublishJobSource;
  resolvedRelays: string[];
}

export interface EnsureJobResult {
  jobId: number;
  inserted: boolean;
}

/**
 * Atomically insert a job or return the existing one for this event_id.
 * Only one concurrent request can "win" the insert; others get the same job id.
 * Requires UNIQUE(event_id) on blastr_publish_jobs.
 */
export async function ensureJob(
  db: D1Database,
  params: CreateJobParams,
): Promise<EnsureJobResult> {
  const { eventId, pubkey, source, resolvedRelays } = params;
  const receivedAt = Math.floor(Date.now() / 1000);
  const resolvedRelaysJson = JSON.stringify(resolvedRelays);
  const stmt = db
    .prepare(
      `INSERT INTO blastr_publish_jobs
       (event_id, pubkey, source, received_at, status, relay_count_target, relay_count_success, relay_count_failed, resolved_relays)
       VALUES (?, ?, ?, ?, 'queued', ?, 0, 0, ?)
       ON CONFLICT(event_id) DO NOTHING RETURNING id`,
    )
    .bind(
      eventId,
      pubkey,
      source,
      receivedAt,
      resolvedRelays.length,
      resolvedRelaysJson,
    );
  const { results } = await stmt.all<{ id: number }>();
  const first = results[0];
  if (first !== undefined) {
    return { jobId: first.id, inserted: true };
  }
  const existing = await getJobByEventId(db, eventId);
  if (!existing) {
    throw new Error(
      `ensureJob: no row after ON CONFLICT DO NOTHING and getJobByEventId returned null for event_id=${eventId}`,
    );
  }
  return { jobId: existing.id, inserted: false };
}

export async function createJob(
  db: D1Database,
  params: CreateJobParams,
): Promise<number> {
  const { eventId, pubkey, source, resolvedRelays } = params;
  const receivedAt = Math.floor(Date.now() / 1000);
  const resolvedRelaysJson = JSON.stringify(resolvedRelays);
  const stmt = db
    .prepare(
      `INSERT INTO blastr_publish_jobs
       (event_id, pubkey, source, received_at, status, relay_count_target, relay_count_success, relay_count_failed, resolved_relays)
       VALUES (?, ?, ?, ?, 'queued', ?, 0, 0, ?)`,
    )
    .bind(
      eventId,
      pubkey,
      source,
      receivedAt,
      resolvedRelays.length,
      resolvedRelaysJson,
    );
  const result = await stmt.run();
  return result.meta.last_row_id;
}

export async function updateJobStatus(
  db: D1Database,
  jobId: number,
  status: "processing" | "partial" | "success" | "failed",
  counts: { success: number; failed: number },
): Promise<void> {
  await db
    .prepare(
      `UPDATE blastr_publish_jobs
       SET status = ?, relay_count_success = ?, relay_count_failed = ?
       WHERE id = ?`,
    )
    .bind(status, counts.success, counts.failed, jobId)
    .run();
}

export interface CreateAttemptParams {
  jobId: number;
  relayUrl: string;
  attemptNumber: number;
  status: string;
  errorCode?: string | null;
  latencyMs?: number | null;
}

export async function createAttempt(
  db: D1Database,
  params: CreateAttemptParams,
): Promise<void> {
  const { jobId, relayUrl, attemptNumber, status, errorCode, latencyMs } =
    params;
  await db
    .prepare(
      `INSERT INTO blastr_publish_attempts (job_id, relay_url, attempt_number, status, error_code, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      jobId,
      relayUrl,
      attemptNumber,
      status,
      errorCode ?? null,
      latencyMs ?? null,
    )
    .run();
}
