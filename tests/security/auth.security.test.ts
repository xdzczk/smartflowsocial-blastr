import type {
  ExecutionContext,
  IncomingRequestCfProperties,
} from "@cloudflare/workers-types";
import { describe, it, expect, vi, beforeEach } from "vitest";

/* eslint-disable @typescript-eslint/consistent-type-assertions -- test Request cast */

import * as nostrAdapter from "../../src/adapters/nostr";
import * as db from "../../src/services/db";
import * as dedupe from "../../src/services/dedupe";
import * as jobs from "../../src/services/jobs";
import * as rateLimit from "../../src/services/rate-limit";
import type { Env } from "../../src/types";

vi.mock("../../src/adapters/nostr", () => ({
  verifyEventSignature: vi.fn(),
}));
vi.mock("../../src/services/db");
vi.mock("../../src/services/dedupe");
vi.mock("../../src/services/jobs");
vi.mock("../../src/services/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  checkAdminRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

const validEvent = {
  id: "a".repeat(64),
  pubkey: "b".repeat(64),
  created_at: Math.floor(Date.now() / 1000),
  kind: 1,
  tags: [] as string[][],
  content: "test",
  sig: "c".repeat(128),
};

function envWithToken(apiToken: string): Env {
  return {
    PUBLISHED_NOTES: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(void 0),
    },
    DB: {},
    BLASTR_PUBLISH_QUEUE: { send: vi.fn().mockResolvedValue(void 0) },
    API_TOKEN: apiToken,
  } as unknown as Env;
}

const ERR_FETCH_UNDEFINED = "handler.fetch is undefined";
const API_TOKEN_SECRET = "secret";
const EVENT_URL = "http://localhost/event";

describe("Auth (API_TOKEN)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(nostrAdapter.verifyEventSignature).mockReturnValue(true);
    vi.mocked(db.getEntitlement).mockResolvedValue({
      pubkey: validEvent.pubkey,
      plan_tier: "default",
      status: "active",
      rate_limit_profile: null,
      updated_at: Date.now(),
    });
    vi.mocked(rateLimit.checkRateLimit).mockResolvedValue({ allowed: true });
    vi.mocked(dedupe.isPublished).mockResolvedValue(false);
    vi.mocked(db.getUserPolicy).mockResolvedValue(null);
    vi.mocked(db.getPolicyRelays).mockResolvedValue([]);
    vi.mocked(db.getSystemRelays).mockResolvedValue([
      {
        id: 1,
        relay_url: "wss://r.example.com",
        enabled: 1,
        health_status: "ok",
        score: 0,
        category: null,
        last_checked_at: null,
        notes: null,
      },
    ]);
    vi.mocked(jobs.createJob).mockResolvedValue(1);
  });

  it("POST /event returns 401 when API_TOKEN is set and no token provided", async () => {
    const mod = await import("../../src/index");
    const handler = mod.default;
    if (!handler.fetch) throw new Error(ERR_FETCH_UNDEFINED);
    const env = envWithToken(API_TOKEN_SECRET);
    const request = new Request(EVENT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["EVENT", validEvent]),
    });
    const ctx = {} as ExecutionContext;
    type Req = Request<unknown, IncomingRequestCfProperties<unknown>>;
    const req = request as Req;
    const response = await handler.fetch(req, env, ctx);
    expect(response.status).toBe(401);
    /* eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- response.json() is untyped */
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe("unauthorized");
  });

  it("POST /event returns 401 when API_TOKEN is set and wrong token provided", async () => {
    const mod = await import("../../src/index");
    const handler = mod.default;
    if (!handler.fetch) throw new Error(ERR_FETCH_UNDEFINED);
    const env = envWithToken(API_TOKEN_SECRET);
    const request = new Request(EVENT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-token",
      },
      body: JSON.stringify(["EVENT", validEvent]),
    });
    const ctx = {} as ExecutionContext;
    type Req = Request<unknown, IncomingRequestCfProperties<unknown>>;
    const req = request as Req;
    const response = await handler.fetch(req, env, ctx);
    expect(response.status).toBe(401);
  });

  it("POST /event returns 200 when API_TOKEN is set and correct Bearer token provided", async () => {
    const mod = await import("../../src/index");
    const handler = mod.default;
    if (!handler.fetch) throw new Error(ERR_FETCH_UNDEFINED);
    const env = envWithToken(API_TOKEN_SECRET);
    const request = new Request(EVENT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_TOKEN_SECRET}`,
      },
      body: JSON.stringify(["EVENT", validEvent]),
    });
    const ctx = {} as ExecutionContext;
    type Req = Request<unknown, IncomingRequestCfProperties<unknown>>;
    const req = request as Req;
    const response = await handler.fetch(req, env, ctx);
    expect(response.status).toBe(200);
  });

  it("WebSocket upgrade returns 401 when API_TOKEN is set and no token provided", async () => {
    const mod = await import("../../src/index");
    const handler = mod.default;
    if (!handler.fetch) throw new Error(ERR_FETCH_UNDEFINED);
    const env = envWithToken(API_TOKEN_SECRET);
    const request = new Request("http://localhost/ws", {
      method: "GET",
      headers: { Upgrade: "websocket" },
    });
    const ctx = {} as ExecutionContext;
    type Req = Request<unknown, IncomingRequestCfProperties<unknown>>;
    const response = await handler.fetch(request as Req, env, ctx);
    expect(response.status).toBe(401);
  });

  it("Admin PUT /admin/entitlements/:pubkey returns 401 when API_TOKEN set and no token", async () => {
    const mod = await import("../../src/index");
    const handler = mod.default;
    if (!handler.fetch) throw new Error(ERR_FETCH_UNDEFINED);
    const env = envWithToken(API_TOKEN_SECRET);
    const request = new Request("http://localhost/admin/entitlements/abc", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_tier: "default", status: "active" }),
    });
    const ctx = {} as ExecutionContext;
    type Req = Request<unknown, IncomingRequestCfProperties<unknown>>;
    const response = await handler.fetch(request as Req, env, ctx);
    expect(response.status).toBe(401);
  });

  it("Admin GET /admin/users/:pubkey/policy returns 200 when API_TOKEN set and correct token", async () => {
    vi.mocked(db.getUserPolicy).mockResolvedValue(null);
    vi.mocked(db.getPolicyRelays).mockResolvedValue([]);
    const mod = await import("../../src/index");
    const handler = mod.default;
    if (!handler.fetch) throw new Error(ERR_FETCH_UNDEFINED);
    const env = envWithToken(API_TOKEN_SECRET);
    const request = new Request("http://localhost/admin/users/abc/policy", {
      method: "GET",
      headers: { "X-API-TOKEN": API_TOKEN_SECRET },
    });
    const ctx = {} as ExecutionContext;
    type Req = Request<unknown, IncomingRequestCfProperties<unknown>>;
    const response = await handler.fetch(request as Req, env, ctx);
    expect(response.status).toBe(200);
  });
});
/* eslint-enable @typescript-eslint/consistent-type-assertions */
