import type { Logger } from "../../logger";
import {
  recordEventsAccepted,
  recordEventsRejected,
  recordIngressLatencyMs,
  rejectReasonFromErrorCode,
} from "../../observability/metrics";
import type { Env, PublishJobSource } from "../../types";
import { runIngressPipeline } from "../pipeline";

import { toNostrOk, mapErrorToNostrMessage } from "./mappers";

export async function publishHandler(
  request: Request,
  env: Env,
  logger: Logger,
): Promise<Response> {
  const startMs = Date.now();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    recordIngressLatencyMs(Date.now() - startMs);
    recordEventsRejected("validation_error");
    return new Response(
      JSON.stringify({ error: "Invalid JSON", code: "invalid_json" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const eventPayload: unknown =
    Array.isArray(body) && (body as [string, unknown])[0] === "EVENT"
      ? (body as [string, unknown])[1]
      : body;

  const source: PublishJobSource = "external-client";
  const result = await runIngressPipeline(env, eventPayload, source, logger);
  recordIngressLatencyMs(Date.now() - startMs);

  if (result.ok) {
    recordEventsAccepted();
    const msg = toNostrOk(result.eventId, true, "");
    return new Response(msg, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  recordEventsRejected(rejectReasonFromErrorCode(result.error.code));
  const eventId =
    (eventPayload as { id?: string })["id"] ??
    (body as { id?: string })["id"] ??
    "";
  const nostrMsg = eventId
    ? mapErrorToNostrMessage(eventId, result.error)
    : JSON.stringify({ error: result.error.message, code: result.error.code });
  return new Response(nostrMsg, {
    status: result.error.status,
    headers: { "Content-Type": "application/json" },
  });
}

export function nip11Handler(): Response {
  return new Response(
    JSON.stringify({
      name: "Blastr",
      description: "SFS Broadcast Relay - write-focused managed relay",
      supported_nips: [1, 11, 15, 20],
    }),
    { headers: { "Content-Type": "application/nostr+json" } },
  );
}
