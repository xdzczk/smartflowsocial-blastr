import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  clampCatalogLimit,
  diffFromMembership,
  parseRelayCatalog,
  planCatalogMembership,
  syncSystemRelayCatalog,
} from "../../src/core/relay-catalog-sync";
import * as db from "../../src/services/db";
import type { SystemRelayMembership } from "../../src/services/db";
import type { Env } from "../../src/types";

vi.mock("../../src/services/db");

const PURPLE = "wss://purplepag.es";
const DAMUS = "wss://relay.damus.io";
const PINNED = "wss://pinned.example";
const HELD_OFF = "wss://operator-off.example";
const VERBATIM = "wss://Relay.Example.com/Path";
const LEFT = "wss://left.example";
const API_BASE = "https://catalog.example";

function row(
  relayUrl: string,
  overrides: Partial<SystemRelayMembership> = {},
): SystemRelayMembership {
  return {
    relay_url: relayUrl,
    enabled: 1,
    health_status: "unknown",
    score: 0,
    operator_hold: 0,
    last_checked_at: null,
    ...overrides,
  };
}

function testEnv(overrides: Partial<Env> = {}): Env {
  const base = {
    PUBLISHED_NOTES: {},
    BLASTR_RATE_LIMIT: {},
    DB: {},
    BLASTR_PUBLISH_QUEUE: {},
    NOSTRMASH_API_BASE: API_BASE,
  };
  return { ...base, ...overrides } as unknown as Env;
}

function testLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

function catalogBody(
  relays: {
    relay_url: string;
    distinct_users: number;
    score?: number;
  }[],
): Record<string, unknown> {
  return {
    generated_at: "2026-10-29T12:00:00Z",
    freshness_seconds: 3600,
    relays: relays.map((relay) => ({
      score: 0.5,
      last_probe_at: "2026-10-29T11:00:00Z",
      last_probe_status: "ok",
      avg_connect_latency_ms: 12.5,
      avg_eose_latency_ms: 40.25,
      ...relay,
    })),
  };
}

function jsonFetch(body: unknown, status = 200) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

const seedRows = (): SystemRelayMembership[] => [
  row(PURPLE),
  row(DAMUS, { health_status: "ok", score: 10, last_checked_at: 111 }),
  row(PINNED, {
    health_status: "failed",
    score: 3,
    operator_hold: 1,
    last_checked_at: 222,
  }),
  row(HELD_OFF, {
    enabled: 0,
    health_status: "ok",
    score: 4,
    operator_hold: 1,
    last_checked_at: 333,
  }),
  row(LEFT, {
    enabled: 0,
    health_status: "failed",
    score: 1,
    last_checked_at: 444,
  }),
];

const catalogRelays = [
  { relay_url: DAMUS, distinct_users: 5000, score: 0.982 },
  { relay_url: VERBATIM, distinct_users: 42, score: 99.9 },
  { relay_url: HELD_OFF, distinct_users: 7, score: 0.1 },
  { relay_url: LEFT, distinct_users: 8, score: 1.2 },
];

describe("clampCatalogLimit", () => {
  it("defaults to 50 and clamps numeric values to 1..100", () => {
    expect(clampCatalogLimit(undefined)).toBe(50);
    expect(clampCatalogLimit("")).toBe(50);
    expect(clampCatalogLimit("  ")).toBe(50);
    expect(clampCatalogLimit("abc")).toBe(50);
    expect(clampCatalogLimit("50abc")).toBe(50);
    expect(clampCatalogLimit("999999999999999999999")).toBe(50);
    expect(clampCatalogLimit("-4")).toBe(1);
    expect(clampCatalogLimit("0")).toBe(1);
    expect(clampCatalogLimit("1")).toBe(1);
    expect(clampCatalogLimit(" 40 ")).toBe(40);
    expect(clampCatalogLimit("100")).toBe(100);
    expect(clampCatalogLimit("101")).toBe(100);
  });
});

describe("parseRelayCatalog", () => {
  it("reads distinct_users and ignores the float score", () => {
    const parsed = parseRelayCatalog(
      catalogBody([{ relay_url: DAMUS, distinct_users: 5000, score: 0.982 }]),
    );
    expect(parsed?.relays).toEqual([
      { relay_url: DAMUS, distinct_users: 5000 },
    ]);
  });

  it("keeps relay_url verbatim, including case, path, and trailing space", () => {
    const spaced = "wss://relay.example.com ";
    const parsed = parseRelayCatalog(
      catalogBody([
        { relay_url: VERBATIM, distinct_users: 4 },
        { relay_url: spaced, distinct_users: 1 },
      ]),
    );
    expect(parsed?.relays.map((relay) => relay.relay_url)).toEqual([
      VERBATIM,
      spaced,
    ]);
  });

  it("accepts an empty relays array and null probe fields", () => {
    expect(
      parseRelayCatalog({
        generated_at: "2026-10-29T12:00:00Z",
        freshness_seconds: 0,
        relays: [],
      })?.relays,
    ).toEqual([]);

    const parsed = parseRelayCatalog({
      generated_at: "2026-10-29T12:00:00Z",
      freshness_seconds: 3600,
      relays: [
        {
          relay_url: DAMUS,
          distinct_users: 0,
          score: 0.2,
          last_probe_at: null,
          last_probe_status: "",
          avg_connect_latency_ms: null,
          avg_eose_latency_ms: null,
        },
      ],
    });
    expect(parsed?.relays).toEqual([{ relay_url: DAMUS, distinct_users: 0 }]);
  });

  it("rejects a body that would require truncating a float into score", () => {
    expect(
      parseRelayCatalog(
        catalogBody([{ relay_url: DAMUS, distinct_users: 1.5, score: 10 }]),
      ),
    ).toBeNull();
    expect(
      parseRelayCatalog({
        generated_at: "2026-10-29T12:00:00Z",
        freshness_seconds: 3600,
        relays: [{ relay_url: DAMUS, score: 10 }],
      }),
    ).toBeNull();
  });

  it.each([
    ["not an object", null],
    ["missing generated_at", { freshness_seconds: 1, relays: [] }],
    [
      "blank generated_at",
      { generated_at: "", freshness_seconds: 1, relays: [] },
    ],
    [
      "freshness not an integer",
      { generated_at: "t", freshness_seconds: 1.5, relays: [] },
    ],
    [
      "relays not an array",
      { generated_at: "t", freshness_seconds: 1, relays: {} },
    ],
    ["empty relay url", catalogBody([{ relay_url: "", distinct_users: 1 }])],
    [
      "negative distinct_users",
      catalogBody([{ relay_url: DAMUS, distinct_users: -1 }]),
    ],
  ])("returns null for %s", (_name, body) => {
    expect(parseRelayCatalog(body)).toBeNull();
  });

  it("keeps the first distinct_users when a URL is repeated", () => {
    const parsed = parseRelayCatalog(
      catalogBody([
        { relay_url: DAMUS, distinct_users: 9 },
        { relay_url: DAMUS, distinct_users: 1 },
      ]),
    );
    expect(parsed?.relays).toEqual([{ relay_url: DAMUS, distinct_users: 9 }]);
  });
});

describe("planCatalogMembership", () => {
  it("leaves rows unchanged when the catalog is empty", () => {
    const current = seedRows();
    expect(planCatalogMembership(current, [])).toEqual(current);
    expect(current[0]?.enabled).toBe(1);
  });

  it("preserves operator hold, disables unheld seed rows, and keeps write health", () => {
    const current = seedRows();
    const next = planCatalogMembership(current, catalogRelays);

    expect(next).toEqual([
      row(DAMUS, { health_status: "ok", score: 5000, last_checked_at: 111 }),
      row(VERBATIM, { score: 42 }),
      row(HELD_OFF, {
        enabled: 0,
        health_status: "ok",
        score: 7,
        operator_hold: 1,
        last_checked_at: 333,
      }),
      row(LEFT, {
        enabled: 1,
        health_status: "failed",
        score: 8,
        last_checked_at: 444,
      }),
      row(PURPLE, { enabled: 0 }),
      row(PINNED, {
        health_status: "failed",
        score: 3,
        operator_hold: 1,
        last_checked_at: 222,
      }),
    ]);
  });

  it("treats a different-cased URL as a different relay", () => {
    const current = [
      row("wss://Relay.Example.com", { score: 1, health_status: "ok" }),
    ];
    const next = planCatalogMembership(current, [
      { relay_url: "wss://relay.example.com", distinct_users: 9 },
    ]);
    expect(next).toEqual([
      row("wss://relay.example.com", { score: 9 }),
      row("wss://Relay.Example.com", {
        enabled: 0,
        score: 1,
        health_status: "ok",
      }),
    ]);
  });

  it("keeps the first distinct_users for a duplicated catalog URL", () => {
    const next = planCatalogMembership(
      [],
      [
        { relay_url: DAMUS, distinct_users: 9 },
        { relay_url: DAMUS, distinct_users: 1 },
      ],
    );
    expect(next).toEqual([row(DAMUS, { score: 9 })]);
  });
});

describe("diffFromMembership", () => {
  it("emits enabled and score only, so a health change is not a write", () => {
    const current = [
      row(DAMUS, { health_status: "ok", score: 5, last_checked_at: 9 }),
    ];
    const healthOnly = [
      row(DAMUS, {
        health_status: "failed",
        score: 5,
        last_checked_at: 50,
      }),
    ];
    expect(diffFromMembership(current, healthOnly)).toEqual({
      insert: [],
      update: [],
    });

    const changed = planCatalogMembership(current, [
      { relay_url: DAMUS, distinct_users: 80 },
    ]);
    expect(diffFromMembership(current, changed)).toEqual({
      insert: [],
      update: [{ relay_url: DAMUS, enabled: 1, score: 80 }],
    });
    expect(JSON.stringify(diffFromMembership(current, changed))).not.toContain(
      "health_status",
    );
    expect(JSON.stringify(diffFromMembership(current, changed))).not.toContain(
      "last_checked_at",
    );
  });
});

describe("syncSystemRelayCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not wipe rows when the fetch fails, the body is invalid, or relays is empty", async () => {
    const logger = testLogger();
    const cases = [
      jsonFetch({ error: "not_available" }, 503),
      vi.fn(async () => {
        throw new Error("network down");
      }),
      vi.fn(async () => new Response("not-json", { status: 200 })),
      jsonFetch({ generated_at: "t", freshness_seconds: 1, relays: {} }),
      jsonFetch(catalogBody([])),
    ];

    for (const fetchImpl of cases) {
      vi.mocked(db.listSystemRelayMembership).mockRejectedValue(
        new Error("D1 should not be read"),
      );
      const result = await syncSystemRelayCatalog(testEnv(), logger, fetchImpl);
      expect(result.applied).toBe(false);
      expect(db.listSystemRelayMembership).not.toHaveBeenCalled();
      expect(db.applySystemRelayMembership).not.toHaveBeenCalled();
    }

    const skipped = await syncSystemRelayCatalog(
      testEnv({ NOSTRMASH_API_BASE: "  " }),
      logger,
      vi.fn(),
    );
    expect(skipped).toEqual({ applied: false, reason: "missing_base_url" });
    expect(db.listSystemRelayMembership).not.toHaveBeenCalled();
  });

  it("requests Blastr's clamped catalog limit", async () => {
    const logger = testLogger();
    const fetchImpl = jsonFetch(catalogBody([]));
    await syncSystemRelayCatalog(
      testEnv({ BLASTR_RELAY_CATALOG_LIMIT: "1000" }),
      logger,
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      `${API_BASE}/api/v1/relays/catalog?limit=100`,
      expect.objectContaining({
        method: "GET",
        headers: { Accept: "application/json" },
      }),
    );

    const defaultFetch = jsonFetch(catalogBody([]));
    await syncSystemRelayCatalog(
      testEnv({ NOSTRMASH_API_BASE: `${API_BASE}/` }),
      logger,
      defaultFetch,
    );
    expect(defaultFetch).toHaveBeenCalledWith(
      `${API_BASE}/api/v1/relays/catalog?limit=50`,
      expect.anything(),
    );
  });

  it("stores distinct_users as score, keeps URLs verbatim, and preserves operator hold", async () => {
    const current = seedRows();
    vi.mocked(db.listSystemRelayMembership).mockResolvedValue(current);
    vi.mocked(db.applySystemRelayMembership).mockResolvedValue();
    const logger = testLogger();

    const result = await syncSystemRelayCatalog(
      testEnv(),
      logger,
      jsonFetch(catalogBody(catalogRelays)),
    );

    expect(result).toEqual({ applied: true, inserted: 1, updated: 4 });
    expect(db.applySystemRelayMembership).toHaveBeenCalledWith(
      expect.anything(),
      {
        insert: [{ relay_url: VERBATIM, score: 42 }],
        update: [
          { relay_url: DAMUS, enabled: 1, score: 5000 },
          { relay_url: HELD_OFF, enabled: 0, score: 7 },
          { relay_url: LEFT, enabled: 1, score: 8 },
          { relay_url: PURPLE, enabled: 0, score: 0 },
        ],
      },
    );
  });

  it("does not write when the next catalog leaves membership and score unchanged", async () => {
    const current = [
      row(DAMUS, { health_status: "failed", score: 80, last_checked_at: 123 }),
    ];
    vi.mocked(db.listSystemRelayMembership).mockResolvedValue(current);
    const logger = testLogger();

    const result = await syncSystemRelayCatalog(
      testEnv(),
      logger,
      jsonFetch(
        catalogBody([{ relay_url: DAMUS, distinct_users: 80, score: 0.1 }]),
      ),
    );

    expect(result).toEqual({ applied: true, inserted: 0, updated: 0 });
    expect(db.applySystemRelayMembership).not.toHaveBeenCalled();
    expect(current[0]).toMatchObject({
      health_status: "failed",
      last_checked_at: 123,
      score: 80,
    });
  });
});
