import type { D1Database } from "@cloudflare/workers-types";
import { describe, it, expect, vi, beforeEach } from "vitest";

import * as db from "../../src/services/db";

function mockD1(overrides: {
  first?: unknown;
  all?: { results: unknown[] };
  run?: void;
} = {}): D1Database {
  const chain = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(overrides.first ?? null),
    all: vi.fn().mockResolvedValue(overrides.all ?? { results: [] }),
    run: vi.fn().mockResolvedValue(overrides.run ?? undefined),
  };
  return {
    prepare: vi.fn().mockReturnValue(chain),
  } as unknown as D1Database;
}

const TEST_PUBKEY = "pk";
const PLAN_TIER_DEFAULT = "default";
const STATUS_ACTIVE = "active";
const WSS_R = "wss://r.com";
const TEST_EVENT_E2 = "e2";
const IT_RETURNS_ROW_WHEN_FOUND = "returns row when found";
const IT_CALLS_PREPARE_AND_RUN = "calls prepare and run";

describe("db", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getEntitlement", () => {
    it(IT_RETURNS_ROW_WHEN_FOUND, async () => {
      const row = {
        pubkey: TEST_PUBKEY,
        plan_tier: PLAN_TIER_DEFAULT,
        status: STATUS_ACTIVE,
        rate_limit_profile: null,
        updated_at: Date.now(),
      };
      const d1 = mockD1({ first: row });
      expect(await db.getEntitlement(d1, TEST_PUBKEY)).toEqual(row);
    });

    it("returns null when not found", async () => {
      const d1 = mockD1({ first: null });
      expect(await db.getEntitlement(d1, TEST_PUBKEY)).toBeNull();
    });
  });

  describe("getUserPolicy", () => {
    it(IT_RETURNS_ROW_WHEN_FOUND, async () => {
      const row = {
        pubkey: TEST_PUBKEY,
        mode: "whitelist",
        enabled: 1,
        updated_at: 0,
      };
      const d1 = mockD1({ first: row });
      expect(await db.getUserPolicy(d1, TEST_PUBKEY)).toEqual(row);
    });
  });

  describe("getPolicyRelays", () => {
    it("returns results array", async () => {
      const results = [
        { pubkey: TEST_PUBKEY, relay_url: "wss://x.com", action: "allow", created_at: 0 },
      ];
      const d1 = mockD1({ all: { results } });
      expect(await db.getPolicyRelays(d1, TEST_PUBKEY)).toEqual(results);
    });
  });

  describe("getSystemRelays", () => {
    it("returns results from all()", async () => {
      const results = [
        {
          id: 1,
          relay_url: WSS_R,
          enabled: 1,
          health_status: null,
          score: 10,
          category: null,
          last_checked_at: null,
          notes: null,
        },
      ];
      const d1 = mockD1({ all: { results } });
      expect(await db.getSystemRelays(d1)).toEqual(results);
    });
  });

  describe("getJobById", () => {
    it(IT_RETURNS_ROW_WHEN_FOUND, async () => {
      const row = {
        id: 1,
        event_id: "e1",
        pubkey: TEST_PUBKEY,
        source: "external-client",
        received_at: 0,
        status: "queued",
        relay_count_target: 1,
        relay_count_success: 0,
        relay_count_failed: 0,
        resolved_relays: "[]",
      };
      const d1 = mockD1({ first: row });
      expect(await db.getJobById(d1, 1)).toEqual(row);
    });
  });

  describe("getJobByEventId", () => {
    it(IT_RETURNS_ROW_WHEN_FOUND, async () => {
      const row = { id: 2, event_id: TEST_EVENT_E2 };
      const d1 = mockD1({ first: row });
      expect(await db.getJobByEventId(d1, TEST_EVENT_E2)).toEqual(row);
    });
  });

  describe("upsertEntitlement", () => {
    it(IT_CALLS_PREPARE_AND_RUN, async () => {
      const d1 = mockD1();
      await db.upsertEntitlement(d1, {
        pubkey: TEST_PUBKEY,
        plan_tier: PLAN_TIER_DEFAULT,
        status: STATUS_ACTIVE,
      });
      expect(d1.prepare).toHaveBeenCalled();
    });
  });

  describe("upsertUserPolicy", () => {
    it(IT_CALLS_PREPARE_AND_RUN, async () => {
      const d1 = mockD1();
      await db.upsertUserPolicy(d1, {
        pubkey: TEST_PUBKEY,
        mode: "blacklist",
        enabled: 1,
      });
      expect(d1.prepare).toHaveBeenCalled();
    });
  });

  describe("addPolicyRelay", () => {
    it(IT_CALLS_PREPARE_AND_RUN, async () => {
      const d1 = mockD1();
      await db.addPolicyRelay(d1, {
        pubkey: TEST_PUBKEY,
        relay_url: WSS_R,
        action: "allow",
      });
      expect(d1.prepare).toHaveBeenCalled();
    });
  });

  describe("removePolicyRelay", () => {
    it(IT_CALLS_PREPARE_AND_RUN, async () => {
      const d1 = mockD1();
      await db.removePolicyRelay(d1, TEST_PUBKEY, WSS_R);
      expect(d1.prepare).toHaveBeenCalled();
    });
  });
});
