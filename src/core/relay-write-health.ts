/**
 * Consecutive failed fanout results before a system relay leaves the universe.
 * One recorded failure already includes the in-fanout websocket retries.
 * A later successful EVENT sets health back to ok.
 */
export const WRITE_HEALTH_FAILURE_THRESHOLD = 3;

export const WRITE_HEALTH_OK = "ok";
export const WRITE_HEALTH_FAILED = "failed";

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
