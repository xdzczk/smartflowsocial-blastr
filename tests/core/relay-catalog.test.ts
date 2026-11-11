import type { D1Database } from "@cloudflare/workers-types";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  isSystemRelayInUniverse,
  isUsableSystemRelayHealth,
  loadSystemRelayUniverse,
} from "../../src/core/relay-catalog";
import { WRITE_HEALTH_COOLDOWN_SECONDS } from "../../src/core/relay-write-health";
import * as db from "../../src/services/db";
import type { SystemRelayRow } from "../../src/services/db";

vi.mock("../../src/services/db");

function relay(
  health: string | null,
  lastCheckedAt: number | null = null,
): SystemRelayRow {
  return {
    id: 1,
    relay_url: `wss://relay.example/${String(health)}/${String(lastCheckedAt)}`,
    enabled: 1,
    health_status: health,
    score: 1,
    category: null,
    last_checked_at: lastCheckedAt,
    notes: null,
  };
}

describe("isUsableSystemRelayHealth", () => {
  it("keeps ok, unknown, null, and blank health", () => {
    expect(isUsableSystemRelayHealth("ok")).toBe(true);
    expect(isUsableSystemRelayHealth("unknown")).toBe(true);
    expect(isUsableSystemRelayHealth(null)).toBe(true);
    expect(isUsableSystemRelayHealth()).toBe(true);
    expect(isUsableSystemRelayHealth("")).toBe(true);
    expect(isUsableSystemRelayHealth("failed")).toBe(false);
    expect(isUsableSystemRelayHealth("unhealthy")).toBe(false);
  });
});

describe("loadSystemRelayUniverse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops write-unhealthy relays and keeps blank health", async () => {
    const now = 1_000_000;
    vi.mocked(db.getSystemRelays).mockResolvedValue([
      relay("ok"),
      relay("unknown"),
      relay(null),
      relay(""),
      relay("failed", now),
      relay("unhealthy", null),
    ]);
    const rows = await loadSystemRelayUniverse({} as D1Database, now);
    expect(rows.map((row) => row.health_status)).toEqual([
      "ok",
      "unknown",
      null,
      "",
    ]);
  });

  it("returns a failed relay after the cooldown", async () => {
    const now = 1_000_000;
    const due = now - WRITE_HEALTH_COOLDOWN_SECONDS;
    vi.mocked(db.getSystemRelays).mockResolvedValue([
      relay("failed", due),
      relay("failed", due + 1),
      relay("failed", null),
      relay("unhealthy", due),
    ]);
    const rows = await loadSystemRelayUniverse({} as D1Database, now);
    expect(rows.map((row) => row.last_checked_at)).toEqual([due, null]);
  });
});

describe("isSystemRelayInUniverse", () => {
  const now = 5_000_000;

  it("keeps a failed relay out until the cooldown elapses", () => {
    expect(isSystemRelayInUniverse("failed", now, now)).toBe(false);
    expect(
      isSystemRelayInUniverse(
        "failed",
        now - WRITE_HEALTH_COOLDOWN_SECONDS + 1,
        now,
      ),
    ).toBe(false);
    expect(
      isSystemRelayInUniverse(
        "failed",
        now - WRITE_HEALTH_COOLDOWN_SECONDS,
        now,
      ),
    ).toBe(true);
    expect(isSystemRelayInUniverse("failed", null, now)).toBe(true);
  });
});
