/**
 * E2E happy path: Worker fetch with mocked bindings.
 * Verifies POST /event → 200, NIP-01 OK, and that a queue message is produced.
 */
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
import type { Env, PublishJobMessage } from "../../src/types";

vi.mock("../../src/adapters/nostr", () => ({
  verifyEventSignature: vi.fn(),
}));
vi.mock("../../src/services/db", () => ({
  getEntitlement: vi.fn(),
  getUserPolicy: vi.fn(),
  getPolicyRelays: vi.fn(),
  getSystemRelays: vi.fn(),
  getJobById: vi.fn(),
  getJobByEventId: vi.fn().mockResolvedValue(null),
  upsertEntitlement: vi.fn(),
  upsertUserPolicy: vi.fn(),
  addPolicyRelay: vi.fn(),
  removePolicyRelay: vi.fn(),
}));
vi.mock("../../src/services/dedupe");
vi.mock("../../src/services/jobs");
vi.mock("../../src/services/rate-limit");

const validEvent = {
  id: "e2e".repeat(21).slice(0, 64),
  pubkey: "f".repeat(64),
  created_at: Math.floor(Date.now() / 1000),
  kind: 1,
  tags: [] as string[][],
  content: "e2e test",
  sig: "g".repeat(128),
};

function envWithMocks(): Env {
  return {
    PUBLISHED_NOTES: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(void 0),
    },
    BLASTR_RATE_LIMIT: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(void 0),
    },
    DB: {},
    BLASTR_PUBLISH_QUEUE: { send: vi.fn().mockResolvedValue(void 0) },
  } as unknown as Env;
}

describe("E2E: POST /event happy path", () => {
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
    vi.mocked(jobs.ensureJob).mockResolvedValue({ jobId: 123, inserted: true });
  });

  it("returns 200, NIP-01 OK, and produces a queue message", async () => {
    const mod = await import("../../src/index");
    const handler = mod.default;
    if (!handler.fetch) throw new Error("handler.fetch is undefined");
    const env = envWithMocks();
    const request = new Request("http://localhost/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["EVENT", validEvent]),
    });
    const ctx = {} as ExecutionContext;
    type Req = Request<unknown, IncomingRequestCfProperties<unknown>>;
    const response = await handler.fetch(request as Req, env, ctx);

    expect(response.status).toBe(200);
    const text = await response.text();
    const msg = JSON.parse(text) as unknown[];
    expect(msg[0]).toBe("OK");
    expect(msg[1]).toBe(validEvent.id);
    expect(msg[2]).toBe(true);

    expect(env.BLASTR_PUBLISH_QUEUE.send).toHaveBeenCalledTimes(1);
    const sent = (env.BLASTR_PUBLISH_QUEUE.send as ReturnType<typeof vi.fn>)
      .mock.calls[0]?.[0] as PublishJobMessage | undefined;
    expect(sent).toBeDefined();
    if (!sent) return;
    expect(sent.event.id).toBe(validEvent.id);
    expect(sent.jobId).toBe("123");
    expect(sent.pubkey).toBe(validEvent.pubkey);
    expect(sent.resolvedRelays).toContain("wss://r.example.com");
  });
});
/* eslint-enable @typescript-eslint/consistent-type-assertions */
