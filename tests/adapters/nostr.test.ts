import { describe, it, expect, vi, beforeEach } from "vitest";

const { verifyEvent } = vi.hoisted(() => ({ verifyEvent: vi.fn() }));
vi.mock("nostr-tools/pure", () => ({ verifyEvent }));

import {
  toNostrEvent,
  verifyEventSignature,
} from "../../src/adapters/nostr";

describe("nostr adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("toNostrEvent", () => {
    it("maps SerializedNostrEvent to event shape", () => {
      const ev = {
        id: "e".repeat(64),
        pubkey: "p".repeat(64),
        created_at: 12345,
        kind: 1,
        tags: [["e", "abc"]],
        content: "hi",
        sig: "s".repeat(128),
      };
      expect(toNostrEvent(ev)).toEqual({
        id: ev.id,
        pubkey: ev.pubkey,
        created_at: ev.created_at,
        kind: ev.kind,
        tags: ev.tags,
        content: ev.content,
        sig: ev.sig,
      });
    });
  });

  describe("verifyEventSignature", () => {
    it("returns true when nostr-tools verifyEvent returns true", () => {
      verifyEvent.mockReturnValue(true);
      const ev = {
        id: "e".repeat(64),
        pubkey: "p".repeat(64),
        created_at: 12345,
        kind: 1,
        tags: [],
        content: "",
        sig: "s".repeat(128),
      };
      expect(verifyEventSignature(ev)).toBe(true);
      expect(verifyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: ev.id, kind: 1 }),
      );
    });

    it("returns false when nostr-tools verifyEvent returns false", () => {
      verifyEvent.mockReturnValue(false);
      const ev = {
        id: "e".repeat(64),
        pubkey: "p".repeat(64),
        created_at: 12345,
        kind: 1,
        tags: [],
        content: "",
        sig: "bad",
      };
      expect(verifyEventSignature(ev)).toBe(false);
    });
  });
});
