/**
 * Consecutive failed fanout results before a system relay leaves the universe.
 * One recorded failure already includes the in-fanout websocket retries.
 * A later successful EVENT sets health back to ok.
 */
export const WRITE_HEALTH_FAILURE_THRESHOLD = 3;

/**
 * How long a failed relay stays out of the fanout.
 * Catalog sync does not clear `failed`, and failed relays are not published to,
 * so without this cooldown a relay would never return.
 */
export const WRITE_HEALTH_COOLDOWN_SECONDS = 24 * 60 * 60;

export const WRITE_HEALTH_OK = "ok";
export const WRITE_HEALTH_FAILED = "failed";

/**
 * Failed relays return after the cooldown. A missing check time is already due,
 * so a failed row cannot stay out forever. Any other non-usable status stays out.
 */
export function isFailedRelayDueForRetry(
  lastCheckedAt: number | null | undefined,
  nowSeconds: number,
  cooldownSeconds = WRITE_HEALTH_COOLDOWN_SECONDS,
): boolean {
  if (lastCheckedAt == null || !Number.isFinite(lastCheckedAt)) return true;
  return nowSeconds - lastCheckedAt >= cooldownSeconds;
}

/**
 * Health to store after one fanout result.
 * `newestFirst` includes the attempt row just written, newest id first.
 * Null means leave health_status as it is. last_checked_at still moves.
 */
export function healthStatusAfterAttempts(
  success: boolean,
  newestFirst: readonly string[],
): typeof WRITE_HEALTH_OK | typeof WRITE_HEALTH_FAILED | null {
  if (success) return WRITE_HEALTH_OK;
  const recent = newestFirst.slice(0, WRITE_HEALTH_FAILURE_THRESHOLD);
  const repeatedFailure =
    recent.length === WRITE_HEALTH_FAILURE_THRESHOLD &&
    recent.every((status) => status === WRITE_HEALTH_FAILED);
  return repeatedFailure ? WRITE_HEALTH_FAILED : null;
}
