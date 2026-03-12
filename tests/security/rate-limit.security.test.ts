import type {
  ExecutionContext,
  IncomingRequestCfProperties,
} from "@cloudflare/workers-types";
import { describe, it, expect, vi, beforeEach } from "vitest";

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

describe("Rate limit enforcement", () => {
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

  it("POST /event returns 429 when rate limit check returns not allowed", async () => {
    vi.mocked(rateLimit.checkRateLimit).mockResolvedValue({
      allowed: false,
      retryAfter: 30,
    });
    const mod = await import("../../src/index");
    const handler = mod.default;
    if (!handler.fetch) throw new Error("handler.fetch is undefined");
    const env = envWithMocks();
    const request = new Request("http://localhost/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["EVENT", validEvent]),
    });
    const ctxLiteral = {};
    const ctx = ctxLiteral as ExecutionContext;
    type Req = Request<unknown, IncomingRequestCfProperties<unknown>>;
    const response = await handler.fetch(request as Req, env, ctx);
    expect(response.status).toBe(429);
    const text = await response.text();
    const parsed = JSON.parse(text) as unknown[];
    expect(parsed[0]).toBe("OK");
    expect(parsed[2]).toBe(false);
    expect(db.getEntitlement).toHaveBeenCalled();
    expect(rateLimit.checkRateLimit).toHaveBeenCalled();
    expect(env.BLASTR_PUBLISH_QUEUE.send).not.toHaveBeenCalled();
  });
});
