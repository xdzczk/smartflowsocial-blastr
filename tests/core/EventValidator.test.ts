import { describe, it, expect, vi, beforeEach } from "vitest";

import * as nostrAdapter from "../../src/adapters/nostr";
import { validateEvent } from "../../src/core/EventValidator";

vi.mock("../../src/adapters/nostr", () => ({
  verifyEventSignature: vi.fn(),
}));

describe("EventValidator", () => {
  beforeEach(() => {
    vi.mocked(nostrAdapter.verifyEventSignature).mockReturnValue(true);
  });

  it("rejects non-object input", () => {
    const r = validateEvent(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_signature");
  });

  it("rejects when kind not in allow list", () => {
    const r = validateEvent({
      id: "a".repeat(64),
      pubkey: "b".repeat(64),
      created_at: Math.floor(Date.now() / 1000),
      kind: 1064,
      tags: [],
      content: "",
      sig: "c".repeat(128),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("disallowed_kind");
  });

  it("accepts allowed kinds (0, 1, 6, 30023) with valid shape and mocked signature", () => {
    const base = {
      id: "a".repeat(64),
      pubkey: "b".repeat(64),
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: "hello",
      sig: "c".repeat(128),
    };
    for (const kind of [0, 1, 6, 30023]) {
      const r = validateEvent({ ...base, kind });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.event.kind).toBe(kind);
    }
  });

  it("rejects when signature verification fails", () => {
    vi.mocked(nostrAdapter.verifyEventSignature).mockReturnValue(false);
    const r = validateEvent({
      id: "a".repeat(64),
      pubkey: "b".repeat(64),
      created_at: Math.floor(Date.now() / 1000),
      kind: 1,
      tags: [],
      content: "",
      sig: "bad",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_signature");
  });

  it("rejects when event shape has wrong types (e.g. id not string)", () => {
    const r = validateEvent({
      id: 123,
      pubkey: "b".repeat(64),
      created_at: Math.floor(Date.now() / 1000),
      kind: 1,
      tags: [],
      content: "",
      sig: "c".repeat(128),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_signature");
  });

  it("rejects when event exceeds max size", () => {
    const smallMax = 10;
    const r = validateEvent(
      {
        id: "a".repeat(64),
        pubkey: "b".repeat(64),
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        tags: [],
        content: "x".repeat(100),
        sig: "c".repeat(128),
      },
      smallMax,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("event_too_large");
  });
});
