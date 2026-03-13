import type {
  ExecutionContext,
  IncomingRequestCfProperties,
} from "@cloudflare/workers-types";
import { describe, it, expect, vi, beforeEach } from "vitest";

import * as db from "../../src/services/db";
import * as rateLimit from "../../src/services/rate-limit";
import type { Env } from "../../src/types";

vi.mock("../../src/services/db", () => ({
  getEntitlement: vi.fn(),
  getUserPolicy: vi.fn(),
  getPolicyRelays: vi.fn(),
  getSystemRelays: vi.fn(),
  getJobById: vi.fn(),
  getJobByEventId: vi.fn(),
  upsertEntitlement: vi.fn(),
  upsertUserPolicy: vi.fn(),
  addPolicyRelay: vi.fn(),
  removePolicyRelay: vi.fn(),
}));

vi.mock("../../src/services/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  checkAdminRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

const API_TOKEN = "admin-secret";
const PUBKEY = "a".repeat(64);
const WSS_R_EXAMPLE = "wss://r.example.com";

function adminEnv(): Env {
  return {
    PUBLISHED_NOTES: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
    BLASTR_RATE_LIMIT: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
    DB: {},
    BLASTR_PUBLISH_QUEUE: { send: vi.fn() },
    API_TOKEN,
  } as unknown as Env;
}

const CONTENT_TYPE_JSON = "application/json";

async function parseResJson(res: Response): Promise<Record<string, unknown>> {
  // res.json() returns Promise<any>; assertion needed for type safety
  return (await res.json()) as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion -- res.json() returns any
}

async function adminFetch(
  path: string,
  env: Env,
  init: RequestInit = {},
  headersOverride?: Record<string, string>,
): Promise<Response> {
  const mod = (await import("../../src/index")) as {
    default: { fetch?: (req: Request, env: Env, ctx: ExecutionContext) => Promise<Response> };
  };
  const handler = mod.default;
  if (!handler.fetch) throw new Error("handler.fetch is undefined");
  const defaultHeaders: Record<string, string> = {
    "X-API-TOKEN": API_TOKEN,
    "Content-Type": CONTENT_TYPE_JSON,
    ...(init.headers as Record<string, string>),
  };
  const headers = headersOverride ?? defaultHeaders;
  const request = new Request(`http://localhost${path}`, {
    method: "GET",
    ...init,
    headers,
  });
  const ctx = {} as ExecutionContext; // eslint-disable-line @typescript-eslint/consistent-type-assertions -- test mock
  return handler.fetch(
    request as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    ctx,
  );
}

describe("Admin integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit.checkAdminRateLimit).mockResolvedValue({
      allowed: true,
    });
  });

  const ADMIN_ENTITLEMENTS_PREFIX = "/admin/entitlements/";
  const ADMIN_USERS_PREFIX = "/admin/users/";

  describe("Admin auth", () => {
    it("accepts Bearer token in Authorization header", async () => {
      const env = adminEnv();
      const res = await adminFetch(
        ADMIN_ENTITLEMENTS_PREFIX + PUBKEY,
        env,
        {
          method: "PUT",
          body: JSON.stringify({ plan_tier: "default", status: "active" }),
        },
        {
          Authorization: "Bearer " + API_TOKEN,
          "Content-Type": "application/json",
        },
      );
      expect(res.status).toBe(200);
    });
  });

  describe("Admin rate limit 429", () => {
    it("returns 429 and Retry-After when checkAdminRateLimit returns allowed: false with retryAfter", async () => {
      vi.mocked(rateLimit.checkAdminRateLimit).mockResolvedValue({
        allowed: false,
        retryAfter: 60,
      });
      const env = adminEnv();
      const res = await adminFetch(ADMIN_ENTITLEMENTS_PREFIX + PUBKEY, env, {
        method: "PUT",
        body: JSON.stringify({ plan_tier: "default", status: "active" }),
      });
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("60");
      const json = await parseResJson(res);
      expect(json["code"]).toBe("rate_limit_exceeded");
    });

    it("returns 429 without Retry-After when retryAfter is undefined", async () => {
      vi.mocked(rateLimit.checkAdminRateLimit).mockResolvedValue({
        allowed: false,
      });
      const env = adminEnv();
      const res = await adminFetch(ADMIN_ENTITLEMENTS_PREFIX + PUBKEY, env, {
        method: "PUT",
        body: JSON.stringify({ plan_tier: "default", status: "active" }),
      });
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBeNull();
    });
  });

  describe("PUT /admin/entitlements/:pubkey", () => {
    it("returns 200 with ok, pubkey, plan_tier, status on success", async () => {
      const env = adminEnv();
      const res = await adminFetch(ADMIN_ENTITLEMENTS_PREFIX + PUBKEY, env, {
        method: "PUT",
        body: JSON.stringify({ plan_tier: "default", status: "active" }),
      });
      expect(res.status).toBe(200);
      const json = await parseResJson(res);
      expect(json).toMatchObject({ ok: true, pubkey: PUBKEY, plan_tier: "default", status: "active" });
    });

    it("returns 400 on invalid JSON body", async () => {
      const env = adminEnv();
      const res = await adminFetch(ADMIN_ENTITLEMENTS_PREFIX + PUBKEY, env, {
        method: "PUT",
        body: "not json",
      });
      expect(res.status).toBe(400);
      const json = await parseResJson(res);
      expect(json["code"]).toBe("invalid_json");
    });

    it("accepts plan_tier and status grace; rate_limit_profile string and null", async () => {
      const env = adminEnv();
      const res = await adminFetch(ADMIN_ENTITLEMENTS_PREFIX + PUBKEY, env, {
        method: "PUT",
        body: JSON.stringify({
          plan_tier: "premium",
          status: "grace",
          rate_limit_profile: "high",
        }),
      });
      expect(res.status).toBe(200);
      const json = await parseResJson(res);
      expect(json).toMatchObject({
        ok: true,
        pubkey: PUBKEY,
        plan_tier: "premium",
        status: "grace",
      });
    });

    it("defaults status to active when value not in allowed list", async () => {
      const env = adminEnv();
      const res = await adminFetch(ADMIN_ENTITLEMENTS_PREFIX + PUBKEY, env, {
        method: "PUT",
        body: JSON.stringify({ plan_tier: "default", status: "invalid" }),
      });
      expect(res.status).toBe(200);
      const json = await parseResJson(res);
      expect(json["status"]).toBe("active");
    });
  });

  describe("PUT /admin/users/:pubkey/policy", () => {
    it("returns 200 with mode whitelist and enabled true", async () => {
      const env = adminEnv();
      const res = await adminFetch(ADMIN_USERS_PREFIX + PUBKEY + "/policy", env, {
        method: "PUT",
        body: JSON.stringify({ mode: "whitelist", enabled: true }),
      });
      expect(res.status).toBe(200);
      const json = await parseResJson(res);
      expect(json).toMatchObject({
        ok: true,
        pubkey: PUBKEY,
        mode: "whitelist",
        enabled: 1,
      });
    });

    it("returns 200 with mode blacklist and enabled false", async () => {
      const env = adminEnv();
      const res = await adminFetch(ADMIN_USERS_PREFIX + PUBKEY + "/policy", env, {
        method: "PUT",
        body: JSON.stringify({ mode: "blacklist", enabled: false }),
      });
      expect(res.status).toBe(200);
      const json = await parseResJson(res);
      expect(json).toMatchObject({
        ok: true,
        pubkey: PUBKEY,
        mode: "blacklist",
        enabled: 0,
      });
    });

    it("returns 400 on invalid JSON", async () => {
      const env = adminEnv();
      const res = await adminFetch(ADMIN_USERS_PREFIX + PUBKEY + "/policy", env, {
        method: "PUT",
        body: "{",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /admin/users/:pubkey/policy", () => {
    it("returns 200 with policy null and empty relays when getUserPolicy returns null", async () => {
      vi.mocked(db.getUserPolicy).mockResolvedValue(null);
      vi.mocked(db.getPolicyRelays).mockResolvedValue([]);
      const env = adminEnv();
      const res = await adminFetch(ADMIN_USERS_PREFIX + PUBKEY + "/policy", env);
      expect(res.status).toBe(200);
      const json = await parseResJson(res);
      expect(json["pubkey"]).toBe(PUBKEY);
      expect(json["policy"]).toBeNull();
      expect(json["relays"]).toEqual([]);
    });

    it("returns 200 with policy and relays when present", async () => {
      vi.mocked(db.getUserPolicy).mockResolvedValue({
        pubkey: PUBKEY,
        mode: "whitelist",
        enabled: 1,
        updated_at: Date.now(),
      });
      vi.mocked(db.getPolicyRelays).mockResolvedValue([
        {
          pubkey: PUBKEY,
          relay_url: WSS_R_EXAMPLE,
          action: "allow",
          created_at: Date.now(),
        },
      ]);
      const env = adminEnv();
      const res = await adminFetch(ADMIN_USERS_PREFIX + PUBKEY + "/policy", env);
      expect(res.status).toBe(200);
      const json = await parseResJson(res);
      expect(json["policy"]).toEqual({ mode: "whitelist", enabled: 1 });
      expect((json["relays"] as unknown[]).length).toBe(1);
      expect((json["relays"] as unknown[])[0]).toMatchObject({
        relay_url: WSS_R_EXAMPLE,
        action: "allow",
      });
    });
  });

  describe("POST /admin/users/:pubkey/relays", () => {
    it("returns 200 with relay_url and action allow", async () => {
      const env = adminEnv();
      const res = await adminFetch(ADMIN_USERS_PREFIX + PUBKEY + "/relays", env, {
        method: "POST",
        body: JSON.stringify({
          relay_url: WSS_R_EXAMPLE,
          action: "allow",
        }),
      });
      expect(res.status).toBe(200);
      const json = await parseResJson(res);
      expect(json).toMatchObject({
        ok: true,
        pubkey: PUBKEY,
        relay_url: WSS_R_EXAMPLE,
        action: "allow",
      });
    });

    it("returns 200 with action defaulting to block when not allow", async () => {
      const env = adminEnv();
      const res = await adminFetch(ADMIN_USERS_PREFIX + PUBKEY + "/relays", env, {
        method: "POST",
        body: JSON.stringify({ relay_url: WSS_R_EXAMPLE }),
      });
      expect(res.status).toBe(200);
      const json = await parseResJson(res);
      expect(json["action"]).toBe("block");
    });

    it("returns 400 on invalid JSON", async () => {
      const env = adminEnv();
      const res = await adminFetch(ADMIN_USERS_PREFIX + PUBKEY + "/relays", env, {
        method: "POST",
        body: "not json",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when relay_url is missing", async () => {
      const env = adminEnv();
      const res = await adminFetch(ADMIN_USERS_PREFIX + PUBKEY + "/relays", env, {
        method: "POST",
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const json = await parseResJson(res);
      expect(json["code"]).toBe("bad_request");
    });
  });

  describe("DELETE /admin/users/:pubkey/relays", () => {
    it("returns 200 when relay_url query param is provided", async () => {
      const env = adminEnv();
      const res = await adminFetch(
        ADMIN_USERS_PREFIX + PUBKEY + "/relays?relay_url=wss%3A%2F%2Fr.example.com",
        env,
        { method: "DELETE" },
      );
      expect(res.status).toBe(200);
      const json = await parseResJson(res);
      expect(json).toMatchObject({
        ok: true,
        pubkey: PUBKEY,
        relay_url: WSS_R_EXAMPLE,
      });
    });

    it("returns 404 when relay_url query param is missing", async () => {
      const env = adminEnv();
      const res = await adminFetch(ADMIN_USERS_PREFIX + PUBKEY + "/relays", env, {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("Admin path 404", () => {
    it("returns 404 for GET /admin/unknown", async () => {
      const env = adminEnv();
      const res = await adminFetch("/admin/unknown", env);
      expect(res.status).toBe(404);
    });

    it("returns 404 for GET /admin/entitlements (no pubkey segment)", async () => {
      const env = adminEnv();
      const res = await adminFetch("/admin/entitlements", env);
      expect(res.status).toBe(404);
    });
  });
});
