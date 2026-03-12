import type { Logger } from "../../logger";
import type { Env, PublishJobSource } from "../../types";
import { toNostrOk, mapErrorToNostrMessage } from "../http/mappers";
import { runIngressPipeline } from "../pipeline";

const WS_SOURCE: PublishJobSource = "external-client";

/**
 * Handle a single incoming WebSocket message (Nostr relay protocol).
 * Expects ["EVENT", event] and responds with ["OK", eventId, accepted, message].
 * Other message types (REQ, CLOSE, etc.) are ignored for write-only relay.
 */
async function handleEventMessage(
  server: WebSocket,
  env: Env,
  logger: Logger,
  event: MessageEvent,
): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(event.data as string) as unknown;
  } catch {
    logger.warn("WS: Invalid JSON", {});
    return;
  }

  if (!Array.isArray(raw) || raw.length < 2) {
    return;
  }

  const [type, payload] = raw as [string, unknown];
  if (type !== "EVENT") {
    return;
  }

  const result = await runIngressPipeline(env, payload, WS_SOURCE, logger);

  if (result.ok) {
    server.send(toNostrOk(result.eventId, true, ""));
  } else {
    const eventId = (payload as Record<string, unknown>)["id"] ?? "";
    server.send(
      mapErrorToNostrMessage(
        typeof eventId === "string" ? eventId : "",
        result.error,
      ),
    );
  }
}

export function handleWebSocketRelay(
  server: WebSocket,
  env: Env,
  logger: Logger,
): void {
  server.addEventListener("message", (event: MessageEvent) => {
    void handleEventMessage(server, env, logger, event);
  });

  server.addEventListener("close", () => {
    logger.info("WS: connection closed", {});
  });

  server.addEventListener("error", () => {
    logger.warn("WS: error", {});
  });
}
