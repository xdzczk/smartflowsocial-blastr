import { BlastrError } from "../../errors";

/** Nostr relay OK message: ["OK", event_id, accepted, message] */
export function toNostrOk(
  eventId: string,
  accepted: boolean,
  message: string,
): string {
  return JSON.stringify(["OK", eventId, accepted, message]);
}

export function mapErrorToNostrMessage(
  eventId: string,
  error: BlastrError,
): string {
  return toNostrOk(eventId, false, error.message);
}

export function mapErrorToResponse(error: unknown): {
  response: Record<string, unknown>;
  status: number;
} {
  if (error instanceof BlastrError) {
    return {
      response: { error: error.message, code: error.code },
      status: error.status,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    response: { error: message, code: "internal_error" },
    status: 500,
  };
}

export function createResponseHeaders(
  correlationId: string,
  startTime: number,
  extra?: Record<string, string>,
): Headers {
  const headers = new Headers(extra);
  headers.set("X-Request-ID", correlationId);
  headers.set("X-Response-Time", String(Date.now() - startTime));
  return headers;
}
