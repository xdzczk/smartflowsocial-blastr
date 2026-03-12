import {
  upsertEntitlement,
  upsertUserPolicy,
  addPolicyRelay,
  getPolicyRelays,
  removePolicyRelay,
  getUserPolicy,
} from "../../services/db";
import type { Env } from "../../types";

const CONTENT_TYPE_JSON = "application/json";
const CODE_INVALID_JSON = "invalid_json";
const ERROR_INVALID_JSON = "Invalid JSON";

/** Return 401 response if API_TOKEN is set and request does not provide it. */
export function requireAdminAuth(request: Request, env: Env): Response | null {
  if (!env.API_TOKEN) return null;
  const authHeader = request.headers.get("Authorization");
  const auth =
    authHeader?.startsWith("Bearer ") === true
      ? authHeader.slice(7)
      : request.headers.get("X-API-TOKEN");
  if (auth !== env.API_TOKEN) {
    return new Response(
      JSON.stringify({ error: "Unauthorized", code: "unauthorized" }),
      { status: 401, headers: { "Content-Type": CONTENT_TYPE_JSON } },
    );
  }
  return null;
}

export async function putEntitlement(
  request: Request,
  env: Env,
  pubkey: string,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: ERROR_INVALID_JSON, code: CODE_INVALID_JSON }),
      { status: 400, headers: { "Content-Type": CONTENT_TYPE_JSON } },
    );
  }
  const o = body as Record<string, unknown>;
  const plan_tier =
    typeof o["plan_tier"] === "string" ? o["plan_tier"] : "default";
  const status = ["active", "grace", "expired", "suspended"].includes(
    o["status"] as string,
  )
    ? (o["status"] as "active" | "grace" | "expired" | "suspended")
    : "active";
  const rate_limit_profile =
    typeof o["rate_limit_profile"] === "string" ||
    o["rate_limit_profile"] === null
      ? o["rate_limit_profile"]
      : undefined;

  await upsertEntitlement(env.DB, {
    pubkey,
    plan_tier,
    status,
    rate_limit_profile: rate_limit_profile ?? null,
  });
  return new Response(JSON.stringify({ ok: true, pubkey, plan_tier, status }), {
    status: 200,
    headers: { "Content-Type": CONTENT_TYPE_JSON },
  });
}

export async function putUserPolicy(
  request: Request,
  env: Env,
  pubkey: string,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: ERROR_INVALID_JSON, code: CODE_INVALID_JSON }),
      { status: 400, headers: { "Content-Type": CONTENT_TYPE_JSON } },
    );
  }
  const o = body as Record<string, unknown>;
  const mode = o["mode"] === "whitelist" ? "whitelist" : "blacklist";
  const enabled = o["enabled"] === false ? 0 : 1;

  await upsertUserPolicy(env.DB, { pubkey, mode, enabled });
  return new Response(JSON.stringify({ ok: true, pubkey, mode, enabled }), {
    status: 200,
    headers: { "Content-Type": CONTENT_TYPE_JSON },
  });
}

export async function getAdminUserPolicy(
  env: Env,
  pubkey: string,
): Promise<Response> {
  const policy = await getUserPolicy(env.DB, pubkey);
  const relays = await getPolicyRelays(env.DB, pubkey);
  return new Response(
    JSON.stringify({
      pubkey,
      policy: policy ? { mode: policy.mode, enabled: policy.enabled } : null,
      relays: relays.map((r) => ({
        relay_url: r["relay_url"],
        action: r["action"],
      })),
    }),
    { status: 200, headers: { "Content-Type": CONTENT_TYPE_JSON } },
  );
}

export async function postPolicyRelay(
  request: Request,
  env: Env,
  pubkey: string,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: ERROR_INVALID_JSON, code: CODE_INVALID_JSON }),
      { status: 400, headers: { "Content-Type": CONTENT_TYPE_JSON } },
    );
  }
  const o = body as Record<string, unknown>;
  const relay_url = typeof o["relay_url"] === "string" ? o["relay_url"] : "";
  const action = o["action"] === "allow" ? "allow" : "block";
  if (!relay_url) {
    return new Response(
      JSON.stringify({ error: "relay_url required", code: "bad_request" }),
      { status: 400, headers: { "Content-Type": CONTENT_TYPE_JSON } },
    );
  }
  await addPolicyRelay(env.DB, { pubkey, relay_url, action });
  return new Response(JSON.stringify({ ok: true, pubkey, relay_url, action }), {
    status: 200,
    headers: { "Content-Type": CONTENT_TYPE_JSON },
  });
}

export async function deletePolicyRelay(
  env: Env,
  pubkey: string,
  relayUrl: string,
): Promise<Response> {
  await removePolicyRelay(env.DB, pubkey, relayUrl);
  return new Response(
    JSON.stringify({ ok: true, pubkey, relay_url: relayUrl }),
    { status: 200, headers: { "Content-Type": CONTENT_TYPE_JSON } },
  );
}
