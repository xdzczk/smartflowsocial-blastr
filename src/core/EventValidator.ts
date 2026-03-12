import { verifyEventSignature } from "../adapters/nostr";
import { ALLOWED_KINDS, MAX_EVENT_SIZE } from "../config/env";
import { BlastrError, ErrorCodes } from "../errors";
import type { SerializedNostrEvent } from "../types";

export interface ValidationResult {
  ok: true;
  event: SerializedNostrEvent;
}

export type ValidateEventResult =
  | ValidationResult
  | { ok: false; error: BlastrError };

/**
 * Validates Nostr event: shape, kind, size, and signature.
 * Returns either { ok: true, event } or { ok: false, error }.
 */
export function validateEvent(
  raw: unknown,
  maxSizeBytes: number = MAX_EVENT_SIZE,
): ValidateEventResult {
  if (raw === null || typeof raw !== "object") {
    return {
      ok: false,
      error: new BlastrError(
        "Invalid event shape",
        ErrorCodes.INVALID_SIGNATURE,
        { status: 400 },
      ),
    };
  }

  const o = raw as Record<string, unknown>;
  const tags = Array.isArray(o["tags"]) ? (o["tags"] as string[][]) : [];
  const ev: SerializedNostrEvent = {
    id: o["id"] as string,
    pubkey: o["pubkey"] as string,
    created_at: o["created_at"] as number,
    kind: o["kind"] as number,
    content: o["content"] as string,
    sig: o["sig"] as string,
    tags,
  };
  if (
    typeof ev.id !== "string" ||
    typeof ev.pubkey !== "string" ||
    typeof ev.created_at !== "number" ||
    typeof ev.kind !== "number" ||
    typeof ev.content !== "string" ||
    typeof ev.sig !== "string"
  ) {
    return {
      ok: false,
      error: new BlastrError(
        "Invalid event shape",
        ErrorCodes.INVALID_SIGNATURE,
        { status: 400 },
      ),
    };
  }

  const payloadSize = new TextEncoder().encode(JSON.stringify(ev)).length;
  if (payloadSize > maxSizeBytes) {
    return {
      ok: false,
      error: new BlastrError("Event too large", ErrorCodes.EVENT_TOO_LARGE, {
        status: 413,
      }),
    };
  }

  if (!ALLOWED_KINDS.includes(ev.kind as (typeof ALLOWED_KINDS)[number])) {
    return {
      ok: false,
      error: new BlastrError(
        "Disallowed event kind",
        ErrorCodes.DISALLOWED_KIND,
        { status: 400 },
      ),
    };
  }

  if (!verifyEventSignature(ev)) {
    return {
      ok: false,
      error: new BlastrError(
        "Invalid signature",
        ErrorCodes.INVALID_SIGNATURE,
        { status: 400 },
      ),
    };
  }

  return { ok: true, event: ev };
}
