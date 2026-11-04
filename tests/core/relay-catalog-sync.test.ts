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
    // eslint-disable-next-line unicorn/no-useless-undefined -- undefined is the missing-input case
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
