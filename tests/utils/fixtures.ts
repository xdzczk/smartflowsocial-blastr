/**
 * Test fixtures for Nostr events and env.
 */
import type { SerializedNostrEvent } from "../../src/types";

export const validEventId = "a".repeat(64);
export const validPubkey = "b".repeat(64);
export const validSig = "c".repeat(128);

export function createSerializedEvent(
  overrides?: Partial<SerializedNostrEvent>,
): SerializedNostrEvent {
  return {
    id: validEventId,
    pubkey: validPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 1,
    tags: [],
    content: "hello",
    sig: validSig,
    ...overrides,
  };
}
