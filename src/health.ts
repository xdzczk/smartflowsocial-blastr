import type { Env } from "./types";

export interface ReadinessResult {
  ok: boolean;
  checks: Record<string, boolean | string>;
}

/**
 * Check that required bindings (D1, KV) are reachable.
 * Use for GET /ready (readiness). Queue binding existence is checked via env only.
 */
export async function checkReadiness(env: Env): Promise<ReadinessResult> {
  const checks: Record<string, boolean | string> = {};

  try {
    await env.DB.prepare("SELECT 1").first();
    checks["db"] = true;
  } catch (e) {
    checks["db"] = e instanceof Error ? e.message : String(e);
  }

  let kvOk = true;
  try {
    await env.PUBLISHED_NOTES.get("health:ping");
  } catch (e) {
    kvOk = false;
    checks["kv"] = e instanceof Error ? e.message : String(e);
  }
  if (kvOk) {
    try {
      await env.BLASTR_RATE_LIMIT.get("health:ping");
      checks["kv"] = true;
    } catch (e) {
      checks["kv"] = e instanceof Error ? e.message : String(e);
    }
  }

  checks["queue"] = Boolean(env.BLASTR_PUBLISH_QUEUE);

  const ok =
    checks["db"] === true && checks["kv"] === true && checks["queue"] === true;
  return { ok, checks };
}
