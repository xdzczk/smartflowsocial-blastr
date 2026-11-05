import type { D1Database } from "@cloudflare/workers-types";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  isUsableSystemRelayHealth,
  loadSystemRelayUniverse,
} from "../../src/core/relay-catalog";
import * as db from "../../src/services/db";
import type { SystemRelayRow } from "../../src/services/db";

vi.mock("../../src/services/db");

function relay(health: string | null): SystemRelayRow {
  return {
    id: 1,
    relay_url: `wss://relay.example/${String(health)}`,
    enabled: 1,
    health_status: health,
    score: 1,
    category: null,
    last_checked_at: null,
    notes: null,
  };
}

describe("isUsableSystemRelayHealth", () => {
  it("keeps ok, unknown, null, and blank health", () => {
    expect(isUsableSystemRelayHealth("ok")).toBe(true);
    expect(isUsableSystemRelayHealth("unknown")).toBe(true);
    expect(isUsableSystemRelayHealth(null)).toBe(true);
    // eslint-disable-next-line unicorn/no-useless-undefined -- undefined is the missing-input case
    expect(isUsableSystemRelayHealth(undefined)).toBe(true);
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
    vi.mocked(db.getSystemRelays).mockResolvedValue([
      relay("ok"),
      relay("unknown"),
      relay(null),
      relay(""),
      relay("failed"),
      relay("unhealthy"),
    ]);
    const rows = await loadSystemRelayUniverse({} as D1Database);
    expect(rows.map((row) => row.health_status)).toEqual([
      "ok",
      "unknown",
      null,
      "",
    ]);
  });
});
