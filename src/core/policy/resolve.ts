import type {
  PolicyRelayRow,
  SystemRelayRow,
  UserPolicyRow,
} from "../../services/db";
import type { PolicyRelayAction, UserPolicyMode } from "../../types";

export interface UserPolicyInput {
  mode: UserPolicyMode;
  enabled: boolean;
  relays: { relayUrl: string; action: PolicyRelayAction }[];
}

const DEFAULT_POLICY: UserPolicyInput = {
  mode: "blacklist",
  enabled: true,
  relays: [],
};

/**
 * Default policy when no row exists: blacklist mode, empty block list.
 */
export function getDefaultPolicy(): UserPolicyInput {
  return { ...DEFAULT_POLICY };
}

/**
 * Build UserPolicyInput from DB rows (user policy + policy relays).
 */
export function toUserPolicyInput(
  policyRow: UserPolicyRow | null,
  relayRows: PolicyRelayRow[],
): UserPolicyInput {
  if (!policyRow) return getDefaultPolicy();
  return {
    mode: policyRow.mode,
    enabled: policyRow.enabled !== 0,
    relays: relayRows.map((r) => ({ relayUrl: r.relay_url, action: r.action })),
  };
}

/**
 * Resolve effective relay list from system universe and user policy.
 * - Filter system relays by enabled and optional health threshold.
 * - Blacklist: systemRelays minus user blocked URLs.
 * - Whitelist: intersection of systemRelays and user allowed URLs.
 * - Sort by score descending, then by URL.
 */
export function resolveEffectiveRelays(
  systemRelays: SystemRelayRow[],
  userPolicy: UserPolicyInput,
): string[] {
  const enabledSystem = systemRelays
    .filter((r) => r.enabled !== 0)
    .map((r) => r.relay_url);

  if (!userPolicy.enabled) return enabledSystem;

  const blocked = new Set(
    userPolicy.relays
      .filter((r) => r.action === "block")
      .map((r) => r.relayUrl),
  );
  const allowed = new Set(
    userPolicy.relays
      .filter((r) => r.action === "allow")
      .map((r) => r.relayUrl),
  );

  let result: string[];
  if (userPolicy.mode === "blacklist") {
    result = enabledSystem.filter((url) => !blocked.has(url));
  } else {
    result = enabledSystem.filter((url) => allowed.has(url));
  }

  const byScore = new Map(systemRelays.map((r) => [r.relay_url, r.score]));
  result.sort((a, b) => {
    const scoreA = byScore.get(a) ?? 0;
    const scoreB = byScore.get(b) ?? 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.localeCompare(b);
  });
  return result;
}
