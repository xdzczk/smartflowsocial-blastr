import type {
  ExecutionContext,
  IncomingRequestCfProperties,
} from "@cloudflare/workers-types";
import { describe, it, expect, vi, beforeEach } from "vitest";

/* eslint-disable @typescript-eslint/consistent-type-assertions -- test Request cast for Workers fetch signature */

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
vi.mock("../../src/services/rate-limit");

const EVENT_PATH_URL = "http://localhost/event";
const METHOD_POST = "POST";
const CONTENT_TYPE_JSON = "application/json";
const ERR_FETCH_UNDEFINED = "handler.fetch is undefined";

const validEvent = {
  id: "e".repeat(64),
  pubkey: "f".repeat(64),
  created_at: Math.floor(Date.now() / 1000),
  kind: 1,
  tags: [] as string[][],
  content: "test",
  sig: "g".repeat(128),
};

function envWithMocks(): Env {
  return {
    PUBLISHED_NOTES: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(void 0),
    },
    DB: {},
    BLASTR_PUBLISH_QUEUE: { send: vi.fn().mockResolvedValue(void 0) },
  } as unknown as Env;
}

describe("POST /event", () => {
  beforeEach(() => {
    vi.mocked(nostrAdapter.verifyEventSignature).mockReturnValue(true);
    vi.clearAllMocks();
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

  it("returns 200 and NIP-01 OK for valid EVENT body", async () => {
    const mod = await import("../../src/index");
    const handler = mod.default;
    const env = envWithMocks();
    const body = JSON.stringify(["EVENT", validEvent]);
    const request = new Request(EVENT_PATH_URL, {
      method: METHOD_POST,
      headers: { "Content-Type": CONTENT_TYPE_JSON },
      body,
    });
    const ctx = {} as ExecutionContext;
    if (!handler.fetch) throw new Error(ERR_FETCH_UNDEFINED);
    type Req = Request<unknown, IncomingRequestCfProperties<unknown>>;
    const req: Req = request as Req;
    const response = await handler.fetch(req, env, ctx);
    expect(response.status).toBe(200);
    const text = await response.text();
    const msg = JSON.parse(text) as unknown[];
    expect(msg[0]).toBe("OK");
    expect(msg[1]).toBe(validEvent.id);
    expect(msg[2]).toBe(true);
  });

  it("returns 400 for invalid JSON", async () => {
    const mod = await import("../../src/index");
    const handler = mod.default;
    const env = envWithMocks();
    const request = new Request(EVENT_PATH_URL, {
      method: METHOD_POST,
      headers: { "Content-Type": CONTENT_TYPE_JSON },
      body: "not json",
    });
    const ctx = {} as ExecutionContext;
    if (!handler.fetch) throw new Error(ERR_FETCH_UNDEFINED);
    type Req = Request<unknown, IncomingRequestCfProperties<unknown>>;
    const req: Req = request as Req;
    const response = await handler.fetch(req, env, ctx);
    expect(response.status).toBe(400);
  });

  it("returns 403 when not entitled", async () => {
    vi.mocked(db.getEntitlement).mockResolvedValue(null);
    const mod = await import("../../src/index");
    const handler = mod.default;
    const env = envWithMocks();
    const body = JSON.stringify(["EVENT", validEvent]);
    const request = new Request(EVENT_PATH_URL, {
      method: METHOD_POST,
      headers: { "Content-Type": CONTENT_TYPE_JSON },
      body,
    });
    const ctx = {} as ExecutionContext;
    if (!handler.fetch) throw new Error(ERR_FETCH_UNDEFINED);
    type Req = Request<unknown, IncomingRequestCfProperties<unknown>>;
    const req: Req = request as Req;
    const response = await handler.fetch(req, env, ctx);
    expect(response.status).toBe(403);
    const text = await response.text();
    const msg = JSON.parse(text) as unknown[];
    expect(msg[0]).toBe("OK");
    expect(msg[2]).toBe(false);
  });
});
/* eslint-enable @typescript-eslint/consistent-type-assertions */
