import type { Logger } from "../logger";
import { getJobById } from "../services/db";
import { createAttempt, updateJobStatus } from "../services/jobs";
import type { Env, PublishJobMessage, SerializedNostrEvent } from "../types";

const RELAY_SEND_TIMEOUT_MS = 8_000;

/**
 * Send one event to one relay via WebSocket, return { success, errorCode?, latencyMs }.
 */
async function sendEventToRelay(
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

  let successCount = 0;
  let failedCount = 0;
  let attemptNumber = 0;

  for (const relayUrl of resolvedRelays) {
    attemptNumber += 1;
    const result = await sendEventToRelay(relayUrl, event);
    const status = result.success ? "ok" : "failed";
    await createAttempt(env.DB, {
      jobId: jobIdNum,
      relayUrl,
      attemptNumber,
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
