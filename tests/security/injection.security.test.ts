import type {
  ExecutionContext,
  IncomingRequestCfProperties,
} from "@cloudflare/workers-types";
import { describe, it, expect, vi, beforeEach } from "vitest";

import * as db from "../../src/services/db";
import type { Env } from "../../src/types";

vi.mock("../../src/services/db");

function envWithToken(): Env {
  return {
    PUBLISHED_NOTES: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(void 0),
    },
    DB: {},
    BLASTR_PUBLISH_QUEUE: { send: vi.fn().mockResolvedValue(void 0) },
    API_TOKEN: "secret",
  } as unknown as Env;
}

async function adminRequest(
  path: string,
  method: string,
  body?: string,
  env?: Env,
): Promise<Response> {
  const mod = await import("../../src/index");
  const handler = mod.default;
  if (!handler.fetch) throw new Error("handler.fetch is undefined");
  const e = env ?? envWithToken();
  const request = new Request(`http://localhost${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer secret",
    },
    body,
  });
  const ctxLiteral = {};
  const ctx = ctxLiteral as ExecutionContext;
  type Req = Request<unknown, IncomingRequestCfProperties<unknown>>;
  return handler.fetch(request as Req, e, ctx);
}

describe("Injection (admin payloads)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.upsertEntitlement).mockResolvedValue();
    vi.mocked(db.upsertUserPolicy).mockResolvedValue();
    vi.mocked(db.addPolicyRelay).mockResolvedValue();
    vi.mocked(db.removePolicyRelay).mockResolvedValue();
  });

  it("PUT /admin/entitlements/:pubkey with SQL-like pubkey in path does not execute SQL", async () => {
    const pubkey = "x'; DROP TABLE blastr_entitlements; --";
    const response = await adminRequest(
      `/admin/entitlements/${encodeURIComponent(pubkey)}`,
      "PUT",
      JSON.stringify({ plan_tier: "default", status: "active" }),
    );
    expect(response.status).toBe(200);
    expect(db.upsertEntitlement).toHaveBeenCalledTimes(1);
    const call = vi.mocked(db.upsertEntitlement).mock.calls[0];
    expect(call?.[1]?.pubkey).toBe(pubkey);
  });

  it("POST /admin/users/:pubkey/relays with script-like relay_url returns 200 and passes value as data", async () => {
    const pubkey = "a".repeat(64);
    const relayUrl = "wss://evil.com</script><script>alert(1)</script>";
    const response = await adminRequest(
      `/admin/users/${encodeURIComponent(pubkey)}/relays`,
      "POST",
      JSON.stringify({ relay_url: relayUrl, action: "block" }),
    );
    expect(response.status).toBe(200);
    expect(db.addPolicyRelay).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pubkey, relay_url: relayUrl, action: "block" }),
    );
  });

  it("POST /admin/users/:pubkey/relays with SQL-like relay_url passes value as data", async () => {
    const pubkey = "b".repeat(64);
    const relayUrl = "wss://x'; DELETE FROM blastr_policy_relays; --";
    const response = await adminRequest(
      `/admin/users/${encodeURIComponent(pubkey)}/relays`,
      "POST",
      JSON.stringify({ relay_url: relayUrl, action: "allow" }),
    );
    expect(response.status).toBe(200);
    expect(db.addPolicyRelay).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ relay_url: relayUrl }),
    );
  });

  it("PUT /admin/users/:pubkey/policy with invalid body returns 400", async () => {
    const response = await adminRequest(
      "/admin/users/" + "c".repeat(64) + "/policy",
      "PUT",
      "not json",
    );
    expect(response.status).toBe(400);
    expect(db.upsertUserPolicy).not.toHaveBeenCalled();
  });
});
