import type { Logger } from "../logger";
import { getJobById } from "../services/db";
import { createAttempt, updateJobStatus } from "../services/jobs";
import type { Env, PublishJobMessage, SerializedNostrEvent } from "../types";

const RELAY_SEND_TIMEOUT_MS = 8_000;
const FANOUT_CONCURRENCY = 8;
const RELAY_MAX_RETRIES = 2;
const RELAY_RETRY_DELAY_MS = 500;

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
 */
async function runWithConcurrency<T, R>(
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

/**
 * Send one event to one relay with retries for transient errors only.
 */
async function sendEventToRelay(
  relayUrl: string,
  event: SerializedNostrEvent,
): Promise<{ success: boolean; errorCode?: string; latencyMs: number }> {
  let last: { success: boolean; errorCode?: string; latencyMs: number } = {
    success: false,
    errorCode: "error",
    latencyMs: 0,
  };
  for (let attempt = 0; attempt <= RELAY_MAX_RETRIES; attempt++) {
    last = await sendEventToRelayOnce(relayUrl, event);
    if (last.success) return last;
    if (classifyRelayError(last.errorCode) === "permanent") return last;
    if (attempt < RELAY_MAX_RETRIES) await sleep(RELAY_RETRY_DELAY_MS);
  }
  return last;
}

/**
 * Process one queue message: load job (for jobId -> DB updates), fan out to resolved relays, record attempts, update job status.
 */
export async function processQueueMessage(
  body: PublishJobMessage,
  env: Env,
  logger: Logger,
): Promise<void> {
  const { jobId, event, resolvedRelays } = body;
  const jobIdNum = Number.parseInt(jobId, 10);
  if (Number.isNaN(jobIdNum)) {
    logger.warn("Invalid jobId in queue message", { jobId });
    return;
  }

  const job = await getJobById(env.DB, jobIdNum);
  if (!job) {
    logger.warn("Job not found", { jobId });
    return;
  }

  await updateJobStatus(env.DB, jobIdNum, "processing", {
    success: 0,
    failed: 0,
  });

  const results = await runWithConcurrency(
    resolvedRelays,
    FANOUT_CONCURRENCY,
    (relayUrl) => sendEventToRelay(relayUrl, event),
  );

  let successCount = 0;
  let failedCount = 0;
  for (let i = 0; i < resolvedRelays.length; i++) {
    const relayUrl = resolvedRelays[i];
    const result = results[i];
    if (relayUrl === undefined || result === undefined) continue;
    const status = result.success ? "ok" : "failed";
    await createAttempt(env.DB, {
      jobId: jobIdNum,
      relayUrl,
      attemptNumber: i + 1,
      status,
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

  logger.info("Fanout complete", {
    jobId,
    success: successCount,
    failed: failedCount,
    status: finalStatus,
  });
}
