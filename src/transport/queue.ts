import type { Logger } from "../logger";
import {
  recordFanoutFailed,
  recordFanoutLatencyMs,
  recordFanoutSuccess,
} from "../observability/metrics";
import { getJobById } from "../services/db";
import { createAttempt, updateJobStatus } from "../services/jobs";
import type { Env, PublishJobMessage, SerializedNostrEvent } from "../types";

const RELAY_SEND_TIMEOUT_MS = 8_000;
const FANOUT_CONCURRENCY = 8;
const RELAY_MAX_RETRIES = 2;
const RELAY_RETRY_DELAY_MS = 500;
/** Cap relays per job so a single run doesn't exceed limits. Requires limits.cpu_ms in wrangler.toml (e.g. 180000) for 100+. */
const MAX_RELAYS_PER_FANOUT = 150;

export type RelayErrorKind = "transient" | "permanent";

/** Classify relay error for retry: transient errors are retried, permanent are not. */
export function classifyRelayError(errorCode?: string): RelayErrorKind {
  if (!errorCode) return "transient";
  switch (errorCode) {
    case "blocked":
    case "invalid":
    case "duplicate":
      return "permanent";
    case "timeout":
    case "connection_error":
    case "closed":
    default:
      return "transient";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run async tasks with bounded concurrency. Returns results in the same order as inputs.
 * Exported so tests can restore after __setRunWithConcurrencyForTesting.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      const item = items[i];
      if (item !== undefined) {
        results[i] = await fn(item, i);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/** Test hook: override fanout so tests can assert on attemptNumber without real relay calls. */
let _runWithConcurrencyImpl: typeof runWithConcurrency = runWithConcurrency;
export function __setRunWithConcurrencyForTesting(
  fn: typeof runWithConcurrency,
): void {
  _runWithConcurrencyImpl = fn;
}

/**
 * Send one event to one relay via WebSocket, return { success, errorCode?, latencyMs }.
 */
async function sendEventToRelayOnce(
  relayUrl: string,
  event: SerializedNostrEvent,
): Promise<{ success: boolean; errorCode?: string; latencyMs: number }> {
  const start = Date.now();
  return new Promise((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      resolve({
        success: false,
        errorCode: "timeout",
        latencyMs: Date.now() - start,
      });
    }, RELAY_SEND_TIMEOUT_MS);

    try {
      const ws = new WebSocket(relayUrl);
      const payload = JSON.stringify(["EVENT", event]);

      ws.addEventListener("open", () => {
        ws.send(payload);
      });

      ws.addEventListener("message", (ev: MessageEvent) => {
        if (resolved) return;
        try {
          const msg = JSON.parse(ev.data as string) as unknown[];
          if (msg[0] === "OK" && msg[1] === event.id) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            resolve({
              success: (msg[2] as boolean) === true,
              errorCode: (msg[3] as string) || undefined,
              latencyMs: Date.now() - start,
            });
          }
        } catch {
          // ignore parse errors
        }
      });

      ws.addEventListener("error", () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        resolve({
          success: false,
          errorCode: "connection_error",
          latencyMs: Date.now() - start,
        });
      });

      ws.addEventListener("close", () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        resolve({
          success: false,
          errorCode: "closed",
          latencyMs: Date.now() - start,
        });
      });
    } catch (err) {
      resolved = true;
      clearTimeout(timeout);
      resolve({
        success: false,
        errorCode: err instanceof Error ? err.message : "error",
        latencyMs: Date.now() - start,
      });
    }
  });
}

/** Result of sending one event to one relay (after retries). attemptNumber is 1-based try index (1 = first try, 2 = first retry, …). */
export type SendEventToRelayResult = {
  success: boolean;
  errorCode?: string;
  latencyMs: number;
  attemptNumber: number;
};

/**
 * Send one event to one relay with retries for transient errors only.
 * Returns attemptNumber = 1-based try that produced the result (1 = first try, 2 = first retry, …).
 */
async function sendEventToRelay(
  relayUrl: string,
  event: SerializedNostrEvent,
): Promise<SendEventToRelayResult> {
  let last: { success: boolean; errorCode?: string; latencyMs: number } = {
    success: false,
    errorCode: "error",
    latencyMs: 0,
  };
  for (let attempt = 0; attempt <= RELAY_MAX_RETRIES; attempt++) {
    last = await sendEventToRelayOnce(relayUrl, event);
    const attemptNumber = attempt + 1;
    if (last.success) return { ...last, attemptNumber };
    if (classifyRelayError(last.errorCode) === "permanent")
      return { ...last, attemptNumber };
    if (attempt < RELAY_MAX_RETRIES) await sleep(RELAY_RETRY_DELAY_MS);
  }
  return { ...last, attemptNumber: RELAY_MAX_RETRIES + 1 };
}

/**
 * Process one queue message: load job (for jobId -> DB updates), fan out to resolved relays, record attempts, update job status.
 */
export async function processQueueMessage(
  body: PublishJobMessage,
  env: Env,
  logger: Logger,
): Promise<void> {
  const fanoutStartMs = Date.now();
  const { jobId, event, resolvedRelays } = body;
  const jobIdNum = Number.parseInt(jobId, 10);
  if (Number.isNaN(jobIdNum)) {
    logger.warn("Invalid jobId in queue message", { jobId });
    return;
  }

  const relaysToUse =
    resolvedRelays.length > MAX_RELAYS_PER_FANOUT
      ? resolvedRelays.slice(0, MAX_RELAYS_PER_FANOUT)
      : resolvedRelays;
  if (relaysToUse.length < resolvedRelays.length) {
    logger.info("Fanout capped relays to stay within execution limit", {
      jobId,
      requested: resolvedRelays.length,
      capped: relaysToUse.length,
      maxPerFanout: MAX_RELAYS_PER_FANOUT,
    });
  }
  logger.info("Fanout starting", {
    jobId,
    eventId: event.id,
    relayCount: relaysToUse.length,
    relays: relaysToUse,
  });

  if (relaysToUse.length === 0) {
    logger.warn("Fanout skipped: no relays to send to — note will not appear on other relays. Check blastr_system_relays (D1) has enabled rows and, if user uses whitelist policy, that they have allowed relays.", {
      jobId,
      eventId: event.id,
    });
    await updateJobStatus(env.DB, jobIdNum, "failed", { success: 0, failed: 0 });
    recordFanoutFailed();
    recordFanoutLatencyMs(Date.now() - fanoutStartMs);
    return;
  }

  const job = await getJobById(env.DB, jobIdNum);
  if (!job) {
    logger.warn("Job not found", { jobId });
    throw new Error(`Job not found: ${jobId}`);
  }

  await updateJobStatus(env.DB, jobIdNum, "processing", {
    success: 0,
    failed: 0,
  });

  const results = await _runWithConcurrencyImpl(
    relaysToUse,
    FANOUT_CONCURRENCY,
    (relayUrl) => sendEventToRelay(relayUrl, event),
  );

  let successCount = 0;
  let failedCount = 0;
  const relayResults: Array<{
    relay: string;
    success: boolean;
    errorCode?: string;
    latencyMs: number;
  }> = [];
  for (let i = 0; i < relaysToUse.length; i++) {
    const relayUrl = relaysToUse[i];
    const result = results[i];
    if (relayUrl === undefined || result === undefined) continue;
    const status = result.success ? "ok" : "failed";
    await createAttempt(env.DB, {
      jobId: jobIdNum,
      relayUrl,
      attemptNumber: result.attemptNumber,
      status,
      errorCode: result.errorCode ?? null,
      latencyMs: result.latencyMs,
    });
    relayResults.push({
      relay: relayUrl,
      success: result.success,
      errorCode: result.errorCode,
      latencyMs: result.latencyMs,
    });
    logger.info("Fanout relay", {
      jobId,
      relay: relayUrl,
      success: result.success,
      errorCode: result.errorCode ?? null,
      latencyMs: result.latencyMs,
    });
    if (result.success) successCount += 1;
    else failedCount += 1;
  }

  const finalStatus =
    failedCount === 0 ? "success" : successCount === 0 ? "failed" : "partial";
  await updateJobStatus(env.DB, jobIdNum, finalStatus, {
    success: successCount,
    failed: failedCount,
  });

  if (finalStatus === "success") recordFanoutSuccess();
  else recordFanoutFailed();
  recordFanoutLatencyMs(Date.now() - fanoutStartMs);

  logger.info("Fanout complete", {
    jobId,
    eventId: event.id,
    success: successCount,
    failed: failedCount,
    status: finalStatus,
    totalRelays: relaysToUse.length,
    relayResults,
  });
}
