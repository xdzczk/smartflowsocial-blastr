import { verifyEvent } from "nostr-tools/pure";

import type { SerializedNostrEvent } from "../types";

/** Convert serialized event to Event shape for nostr-tools. */
export function toNostrEvent(ev: SerializedNostrEvent): {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
} {
  return {
    id: ev.id,
    pubkey: ev.pubkey,
    created_at: ev.created_at,
    kind: ev.kind,
    tags: ev.tags,
    content: ev.content,
    sig: ev.sig,
  };
}

/**
 * Verify event signature using nostr-tools.
 * Returns true if the event signature is valid.
 */
export function verifyEventSignature(ev: SerializedNostrEvent): boolean {
  const event = toNostrEvent(ev);
  return verifyEvent(event);
}
