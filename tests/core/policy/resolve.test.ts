import { describe, it, expect } from "vitest";

import {
  getDefaultPolicy,
  resolveEffectiveRelays,
  toUserPolicyInput,
} from "../../../src/core/policy/resolve";
import type {
  PolicyRelayRow,
  SystemRelayRow,
  UserPolicyRow,
} from "../../../src/services/db";

const WSS_PREFIX = "wss://";
const WSS_A = `${WSS_PREFIX}a.com`;
const WSS_B = `${WSS_PREFIX}b.com`;
const WSS_C = `${WSS_PREFIX}c.com`;
const WSS_D = `${WSS_PREFIX}d.com`;

describe("resolveEffectiveRelays", () => {
  const systemRelays: SystemRelayRow[] = [
    {
      id: 1,
      relay_url: WSS_A,
      enabled: 1,
      health_status: null,
      score: 10,
      category: null,
      last_checked_at: null,
      notes: null,
    },
    {
      id: 2,
      relay_url: WSS_B,
      enabled: 1,
      health_status: null,
      score: 5,
      category: null,
      last_checked_at: null,
      notes: null,
    },
    {
      id: 3,
      relay_url: WSS_C,
      enabled: 1,
      health_status: null,
      score: 0,
      category: null,
      last_checked_at: null,
      notes: null,
    },
    {
      id: 4,
      relay_url: WSS_D,
      enabled: 0,
      health_status: null,
      score: 0,
      category: null,
      last_checked_at: null,
      notes: null,
    },
  ];

  it("returns all enabled system relays when default policy (blacklist, empty)", () => {
    const policy = getDefaultPolicy();
    const result = resolveEffectiveRelays(systemRelays, policy);
    expect(result).toHaveLength(3);
    expect(result).toContain(WSS_A);
    expect(result).toContain(WSS_B);
    expect(result).toContain(WSS_C);
    expect(result).not.toContain(WSS_D);
  });

  it("blacklist mode: excludes blocked relays", () => {
    const policy = {
      mode: "blacklist" as const,
      enabled: true,
      relays: [{ relayUrl: WSS_B, action: "block" as const }],
    };
    const result = resolveEffectiveRelays(systemRelays, policy);
    expect(result).toHaveLength(2);
    expect(result).toContain(WSS_A);
    expect(result).toContain(WSS_C);
    expect(result).not.toContain(WSS_B);
  });

  it("whitelist mode: only allowed relays", () => {
    const policy = {
      mode: "whitelist" as const,
      enabled: true,
      relays: [
        { relayUrl: WSS_A, action: "allow" as const },
        { relayUrl: WSS_C, action: "allow" as const },
      ],
    };
    const result = resolveEffectiveRelays(systemRelays, policy);
    expect(result).toHaveLength(2);
    expect(result).toContain(WSS_A);
    expect(result).toContain(WSS_C);
    expect(result).not.toContain(WSS_B);
  });

  it("sorts by score descending then by url", () => {
    const policy = getDefaultPolicy();
    const result = resolveEffectiveRelays(systemRelays, policy);
    expect(result[0]).toBe(WSS_A);
    expect(result[1]).toBe(WSS_B);
    expect(result[2]).toBe(WSS_C);
  });

  it("sorts by url when scores are equal (localeCompare branch)", () => {
    const sameScoreRelays: SystemRelayRow[] = [
      {
        id: 1,
        relay_url: "wss://z.com",
        enabled: 1,
        health_status: null,
        score: 5,
        category: null,
        last_checked_at: null,
        notes: null,
      },
      {
        id: 2,
        relay_url: "wss://a.com",
        enabled: 1,
        health_status: null,
        score: 5,
        category: null,
        last_checked_at: null,
        notes: null,
      },
    ];
    const policy = getDefaultPolicy();
    const result = resolveEffectiveRelays(sameScoreRelays, policy);
    expect(result[0]).toBe("wss://a.com");
    expect(result[1]).toBe("wss://z.com");
  });

  it("returns all enabled system relays when policy enabled is false", () => {
    const policy = { ...getDefaultPolicy(), enabled: false };
    const result = resolveEffectiveRelays(systemRelays, policy);
    expect(result).toHaveLength(3);
    expect(result).toContain(WSS_A);
  });
});

describe("toUserPolicyInput", () => {
  it("returns default policy when policyRow is null", () => {
    const out = toUserPolicyInput(null, []);
    expect(out.mode).toBe("blacklist");
    expect(out.enabled).toBe(true);
    expect(out.relays).toHaveLength(0);
  });

  it("maps policy row and relay rows", () => {
    const policyRow: UserPolicyRow = {
      pubkey: "pk",
      mode: "whitelist",
      enabled: 1,
      updated_at: 0,
    };
    const relayRows: PolicyRelayRow[] = [
      {
        pubkey: "pk",
        relay_url: "wss://x.com",
        action: "allow",
        created_at: 0,
      },
    ];
    const out = toUserPolicyInput(policyRow, relayRows);
    expect(out.mode).toBe("whitelist");
    expect(out.enabled).toBe(true);
    expect(out.relays).toHaveLength(1);
    expect(out.relays[0]).toEqual({
      relayUrl: "wss://x.com",
      action: "allow",
    });
  });

  it("maps enabled false when policy row enabled is 0", () => {
    const policyRow: UserPolicyRow = {
      pubkey: "pk",
      mode: "blacklist",
      enabled: 0,
      updated_at: 0,
    };
    const out = toUserPolicyInput(policyRow, []);
    expect(out.enabled).toBe(false);
  });
});
