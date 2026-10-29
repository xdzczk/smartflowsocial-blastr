import { describe, it, expect } from "vitest";

import { planCatalogMembership } from "../../src/core/relay-catalog-sync";
import {
  WRITE_HEALTH_FAILED,
  WRITE_HEALTH_OK,
  healthStatusAfterAttempts,
} from "../../src/core/relay-write-health";
import type { SystemRelayMembership } from "../../src/services/db";

const DAMUS = "wss://relay.damus.io";

function row(
  overrides: Partial<SystemRelayMembership> = {},
): SystemRelayMembership {
  return {
    relay_url: DAMUS,
    enabled: 1,
    health_status: "unknown",
    score: 5,
    operator_hold: 0,
    last_checked_at: null,
    ...overrides,
  };
}

describe("healthStatusAfterAttempts", () => {
  it("sets ok on success, including after failed attempts", () => {
    expect(healthStatusAfterAttempts(true, [])).toBe(WRITE_HEALTH_OK);
    expect(
      healthStatusAfterAttempts(true, [
        WRITE_HEALTH_FAILED,
        WRITE_HEALTH_FAILED,
        WRITE_HEALTH_FAILED,
      ]),
    ).toBe(WRITE_HEALTH_OK);
  });

  it("sets failed only after three consecutive failed publishes", () => {
    expect(healthStatusAfterAttempts(false, [WRITE_HEALTH_FAILED])).toBeNull();
    expect(
      healthStatusAfterAttempts(false, [
        WRITE_HEALTH_FAILED,
        WRITE_HEALTH_FAILED,
      ]),
    ).toBeNull();
    expect(
      healthStatusAfterAttempts(false, [
        WRITE_HEALTH_FAILED,
        WRITE_HEALTH_FAILED,
        WRITE_HEALTH_OK,
      ]),
    ).toBeNull();
    expect(
      healthStatusAfterAttempts(false, [
        WRITE_HEALTH_FAILED,
        WRITE_HEALTH_FAILED,
        WRITE_HEALTH_FAILED,
        WRITE_HEALTH_OK,
      ]),
    ).toBe(WRITE_HEALTH_FAILED);
  });

  it("is not cleared by the next catalog sync", () => {
    const current = [
      row({
        health_status: WRITE_HEALTH_FAILED,
        last_checked_at: 123,
        score: 5,
      }),
    ];
    const next = planCatalogMembership(current, [
      { relay_url: DAMUS, distinct_users: 80 },
    ]);
    expect(next).toEqual([
      row({
        health_status: WRITE_HEALTH_FAILED,
        last_checked_at: 123,
        score: 80,
      }),
    ]);
  });
});
