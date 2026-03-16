import type { ExecutionContext } from "@cloudflare/workers-types";
import type { Logger } from "../../logger";
import type { Env, PublishJobSource } from "../../types";
import { toNostrOk, mapErrorToNostrMessage } from "../http/mappers";
import { runEnqueue, runIngressPipeline } from "../pipeline";

const WS_SOURCE: PublishJobSource = "external-client";

const NOTICE_INVALID_JSON = "invalid JSON";
const NOTICE_INVALID_FORMAT = "invalid message format";
const NOTICE_UNSUPPORTED = "unsupported: only EVENT is supported";
const NOTICE_AUTH_NOT_REQUIRED = "auth not required for this relay";

/** Send a NIP-01 NOTICE to the client. */
function sendNotice(server: WebSocket, message: string): void {
  server.send(JSON.stringify(["NOTICE", message]));
}

/**
 * Handle a single incoming WebSocket message (Nostr relay protocol).
 * Expects ["EVENT", event] and responds with ["OK", eventId, accepted, message].
 * Sends OK, schedules enqueue via waitUntil (so it runs to completion), then closes.
 * Without waitUntil, close() tears down the request and cancels fire-and-forget enqueue.
 */
async function handleEventMessage(
  server: WebSocket,
  env: Env,
  logger: Logger,
  ctx: ExecutionContext,
  event: MessageEvent,
): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(event.data as string) as unknown;
  } catch {
    sendNotice(server, NOTICE_INVALID_JSON);
    logger.warn("WS: Invalid JSON", {});
    return;
  }

  if (!Array.isArray(raw) || raw.length < 2) {
    sendNotice(server, NOTICE_INVALID_FORMAT);
    return;
  }

  const [type, payload] = raw as [unknown, unknown];
  if (typeof type !== "string") {
    sendNotice(server, NOTICE_INVALID_FORMAT);
    return;
  }

  if (type === "AUTH") {
    sendNotice(server, NOTICE_AUTH_NOT_REQUIRED);
    return;
  }

  if (type !== "EVENT") {
    sendNotice(server, NOTICE_UNSUPPORTED);
    return;
  }

  const result = await runIngressPipeline(env, payload, WS_SOURCE, logger, {
    deferEnqueue: true,
  });

  if (result.ok) {
    server.send(toNostrOk(result.eventId, true, ""));
    if (result.enqueuePayload) {
      ctx.waitUntil(
        runEnqueue(env, logger, result.enqueuePayload).catch((err) => {
          logger.error("WS: enqueue failed", { error: err });
        }),
      );
    }
  } else {
    const eventId = (payload as Record<string, unknown>)["id"] ?? "";
    server.send(
      mapErrorToNostrMessage(
        typeof eventId === "string" ? eventId : "",
        result.error,
      ),
    );
  }
  server.close();
}

export function handleWebSocketRelay(
  server: WebSocket,
  env: Env,
  logger: Logger,
  ctx: ExecutionContext,
): void {
  server.addEventListener("message", (event: MessageEvent) => {
    void handleEventMessage(server, env, logger, ctx, event);
  });

  server.addEventListener("close", () => {
    logger.info("WS: connection closed", {});
  });

  server.addEventListener("error", () => {
    logger.warn("WS: error", {});
  });
}
