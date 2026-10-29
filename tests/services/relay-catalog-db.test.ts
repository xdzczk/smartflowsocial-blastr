import type { D1Database } from "@cloudflare/workers-types";
import { describe, it, expect, vi } from "vitest";

import { WRITE_HEALTH_FAILURE_THRESHOLD } from "../../src/core/relay-write-health";
import {
  applySystemRelayMembership,
  listSystemRelayMembership,
  recordSystemRelayWriteHealth,
} from "../../src/services/db";

const INSERT_SQL =
  "INSERT INTO blastr_system_relays (relay_url, enabled, health_status, score, operator_hold) VALUES (?, 1, 'unknown', ?, 0)";
const UPDATE_SQL =
  "UPDATE blastr_system_relays SET enabled = ?, score = ? WHERE relay_url = ?";
const LIST_SQL =
  "SELECT relay_url, enabled, health_status, score, operator_hold, last_checked_at FROM blastr_system_relays";
const RECENT_SQL =
  "SELECT status FROM blastr_publish_attempts WHERE relay_url = ? ORDER BY id DESC LIMIT ?";
const MARK_SQL =
  "UPDATE blastr_system_relays SET last_checked_at = ?, health_status = ? WHERE relay_url = ?";
const TOUCH_SQL =
  "UPDATE blastr_system_relays SET last_checked_at = ? WHERE relay_url = ?";

const VERBATIM = "wss://Relay.Example.com/Path";
const PURPLE = "wss://purplepag.es";
const CHECKED_AT = 1_761_739_200;

function scriptedDb(allResults: unknown[] = []) {
  const statements: { sql: string; binds: unknown[] }[] = [];
  const batch = vi.fn(async () => []);
  const database = {
    prepare: vi.fn((sql: string) => {
      const entry = { sql, binds: [] as unknown[] };
      statements.push(entry);
      const chain = {
        bind: vi.fn((...args: unknown[]) => {
          entry.binds = args;
          return chain;
        }),
        all: vi.fn(async () => ({ results: allResults })),
        run: vi.fn(async () => ({ meta: {} })),
      };
      return chain;
    }),
    batch,
  };
  return {
    database: database as unknown as D1Database,
    statements,
    batch,
  };
}

describe("listSystemRelayMembership", () => {
  it("reads disabled rows and operator_hold", async () => {
    const { database, statements } = scriptedDb([
      {
        relay_url: PURPLE,
        enabled: 0,
        health_status: "unknown",
        score: 0,
        operator_hold: 0,
        last_checked_at: null,
      },
    ]);
    const rows = await listSystemRelayMembership(database);
    expect(statements[0]?.sql).toBe(LIST_SQL);
    expect(statements[0]?.sql).not.toContain("enabled = 1");
    expect(rows).toEqual([
      {
        relay_url: PURPLE,
        enabled: 0,
        health_status: "unknown",
        score: 0,
        operator_hold: 0,
        last_checked_at: null,
      },
    ]);
  });
});

describe("applySystemRelayMembership", () => {
  it("inserts unknown health and updates enabled and score only", async () => {
    const { database, statements, batch } = scriptedDb();
    await applySystemRelayMembership(database, {
      insert: [{ relay_url: VERBATIM, score: 42 }],
      update: [{ relay_url: PURPLE, enabled: 0, score: 0 }],
    });

    expect(statements.map((statement) => statement.sql)).toEqual([
      INSERT_SQL,
      UPDATE_SQL,
    ]);
    expect(INSERT_SQL).not.toContain("last_checked_at");
    expect(UPDATE_SQL).not.toContain("health_status");
    expect(UPDATE_SQL).not.toContain("last_checked_at");
    expect(statements[0]?.binds).toEqual([VERBATIM, 42]);
    expect(statements[1]?.binds).toEqual([0, 0, PURPLE]);
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("does not touch D1 when the diff is empty", async () => {
    const { database, statements, batch } = scriptedDb();
    await applySystemRelayMembership(database, { insert: [], update: [] });
    expect(statements).toEqual([]);
    expect(batch).not.toHaveBeenCalled();
  });
});

describe("recordSystemRelayWriteHealth", () => {
  it("sets ok from a successful publish without reading attempts", async () => {
    const { database, statements } = scriptedDb();
    await recordSystemRelayWriteHealth(
      database,
      { relayUrl: VERBATIM, success: true },
      CHECKED_AT,
    );
    expect(statements).toEqual([
      { sql: MARK_SQL, binds: [CHECKED_AT, "ok", VERBATIM] },
    ]);
  });

  it("moves last_checked_at and leaves health until three consecutive failures", async () => {
    const below = scriptedDb([{ status: "failed" }, { status: "failed" }]);
    await recordSystemRelayWriteHealth(
      below.database,
      { relayUrl: VERBATIM, success: false },
      CHECKED_AT,
    );
    expect(below.statements).toEqual([
      {
        sql: RECENT_SQL,
        binds: [VERBATIM, WRITE_HEALTH_FAILURE_THRESHOLD],
      },
      { sql: TOUCH_SQL, binds: [CHECKED_AT, VERBATIM] },
    ]);
    expect(TOUCH_SQL).not.toContain("health_status");

    const streak = scriptedDb([
      { status: "failed" },
      { status: "failed" },
      { status: "failed" },
    ]);
    await recordSystemRelayWriteHealth(
      streak.database,
      { relayUrl: VERBATIM, success: false },
      CHECKED_AT,
    );
    expect(streak.statements[1]).toEqual({
      sql: MARK_SQL,
      binds: [CHECKED_AT, "failed", VERBATIM],
    });
  });
});
