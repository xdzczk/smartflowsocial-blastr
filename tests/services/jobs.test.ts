import type { D1Database } from "@cloudflare/workers-types";
import { describe, it, expect, vi, beforeEach } from "vitest";

import * as db from "../../src/services/db";
import * as jobs from "../../src/services/jobs";

vi.mock("../../src/services/db", () => ({
  getJobByEventId: vi.fn(),
}));

function mockD1(overrides: {
  first?: unknown;
  all?: { results: unknown[]; meta?: { last_row_id?: number } };
  runMeta?: { last_row_id: number };
} = {}): D1Database {
  const chain = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(overrides.first ?? null),
    all: vi.fn().mockResolvedValue(
      overrides.all ?? { results: [], meta: { last_row_id: 1 } },
    ),
    run: vi.fn().mockResolvedValue({
      meta: overrides.runMeta ?? { last_row_id: 1 },
    }),
  };
  return {
    prepare: vi.fn().mockReturnValue(chain),
  } as unknown as D1Database;
}

describe("jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const EVENT_E1 = "e1";
  const TEST_PUBKEY = "pk";
  const SOURCE_EXTERNAL = "external-client";
  const WSS_R = "wss://r.com";

  describe("ensureJob", () => {
    it("returns inserted true when INSERT returns a row", async () => {
      const d1 = mockD1({ all: { results: [{ id: 42 }], meta: {} } });
      vi.mocked(db.getJobByEventId).mockResolvedValue(null);
      const result = await jobs.ensureJob(d1, {
        eventId: EVENT_E1,
        pubkey: TEST_PUBKEY,
        source: SOURCE_EXTERNAL,
        resolvedRelays: [WSS_R],
      });
      expect(result).toEqual({ jobId: 42, inserted: true });
    });

    it("returns inserted false when ON CONFLICT and getJobByEventId returns existing", async () => {
      const d1 = mockD1({ all: { results: [] } });
      vi.mocked(db.getJobByEventId).mockResolvedValue({
        id: 99,
        event_id: EVENT_E1,
        pubkey: TEST_PUBKEY,
        source: SOURCE_EXTERNAL,
        received_at: 0,
        status: "queued",
        relay_count_target: 1,
        relay_count_success: 0,
        relay_count_failed: 0,
        resolved_relays: "[]",
      });
      const result = await jobs.ensureJob(d1, {
        eventId: EVENT_E1,
        pubkey: TEST_PUBKEY,
        source: SOURCE_EXTERNAL,
        resolvedRelays: [],
      });
      expect(result).toEqual({ jobId: 99, inserted: false });
    });

    it("throws when ON CONFLICT and getJobByEventId returns null", async () => {
      const d1 = mockD1({ all: { results: [] } });
      vi.mocked(db.getJobByEventId).mockResolvedValue(null);
      await expect(
        jobs.ensureJob(d1, {
          eventId: EVENT_E1,
          pubkey: TEST_PUBKEY,
          source: SOURCE_EXTERNAL,
          resolvedRelays: [],
        }),
      ).rejects.toThrow("ensureJob");
    });
  });

  describe("createJob", () => {
    it("returns last_row_id from run result", async () => {
      const d1 = mockD1({ runMeta: { last_row_id: 123 } });
      const id = await jobs.createJob(d1, {
        eventId: EVENT_E1,
        pubkey: TEST_PUBKEY,
        source: "sfs-app",
        resolvedRelays: [WSS_R],
      });
      expect(id).toBe(123);
    });
  });

  describe("updateJobStatus", () => {
    it("calls prepare with status and counts", async () => {
      const d1 = mockD1();
      await jobs.updateJobStatus(d1, 1, "success", {
        success: 2,
        failed: 0,
      });
      expect(d1.prepare).toHaveBeenCalled();
    });
  });

  describe("createAttempt", () => {
    it("calls prepare with params", async () => {
      const d1 = mockD1();
      await jobs.createAttempt(d1, {
        jobId: 1,
        relayUrl: WSS_R,
        attemptNumber: 1,
        status: "ok",
        errorCode: null,
        latencyMs: 10,
      });
      expect(d1.prepare).toHaveBeenCalled();
    });
  });
});
