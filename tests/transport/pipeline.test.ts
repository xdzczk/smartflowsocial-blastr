import { describe, it, expect, vi, beforeEach } from "vitest";

import * as nostrAdapter from "../../src/adapters/nostr";
import { ConsoleLogger } from "../../src/logger";
import * as db from "../../src/services/db";
import * as dedupe from "../../src/services/dedupe";
import * as jobs from "../../src/services/jobs";
import * as rateLimit from "../../src/services/rate-limit";
import { runIngressPipeline } from "../../src/transport/pipeline";
import type { Env } from "../../src/types";

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

const SOURCE_EXTERNAL_CLIENT = "external-client" as const;

const validEvent = {
  id: "a".repeat(64),
  pubkey: "b".repeat(64),
  created_at: Math.floor(Date.now() / 1000),
  kind: 1,
  tags: [] as string[][],
  content: "hello",
  sig: "c".repeat(128),
};

function mockEnv(overrides?: { queueSendRejects?: boolean }): Env {
  const send = overrides?.queueSendRejects
    ? vi.fn().mockRejectedValue(new Error("queue send failed"))
    : vi.fn().mockResolvedValue(void 0);
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
    BLASTR_PUBLISH_QUEUE: { send },
  } as unknown as Env;
}

describe("runIngressPipeline", () => {
  const logger = new ConsoleLogger();

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
        relay_url: "wss://relay.example.com",
        enabled: 1,
        health_status: "ok",
        score: 0,
        category: null,
        last_checked_at: null,
        notes: null,
      },
    ]);
    vi.mocked(jobs.ensureJob).mockResolvedValue({ jobId: 1, inserted: true });
  });

  it("returns NOT_ENTITLED when getEntitlement returns null", async () => {
    vi.mocked(db.getEntitlement).mockResolvedValue(null);
    const env = mockEnv();
    const result = await runIngressPipeline(
      env,
      validEvent,
      SOURCE_EXTERNAL_CLIENT,
      logger,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_entitled");
    }
    expect(env.BLASTR_PUBLISH_QUEUE.send).not.toHaveBeenCalled();
  });

  it("returns RATE_LIMIT_EXCEEDED when checkRateLimit disallows", async () => {
    vi.mocked(rateLimit.checkRateLimit).mockResolvedValue({
      allowed: false,
      retryAfter: 30,
    });
    const env = mockEnv();
    const result = await runIngressPipeline(
      env,
      validEvent,
      SOURCE_EXTERNAL_CLIENT,
      logger,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("rate_limit_exceeded");
    }
    expect(env.BLASTR_PUBLISH_QUEUE.send).not.toHaveBeenCalled();
  });

  it("returns duplicate when isPublished returns true", async () => {
    vi.mocked(dedupe.isPublished).mockResolvedValue(true);
    const env = mockEnv();
    const result = await runIngressPipeline(
      env,
      validEvent,
      SOURCE_EXTERNAL_CLIENT,
      logger,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("duplicate");
    }
    expect(env.BLASTR_PUBLISH_QUEUE.send).not.toHaveBeenCalled();
  });

  it("returns no_relays_configured when resolvedRelays is empty", async () => {
    vi.mocked(db.getSystemRelays).mockResolvedValue([]);
    const env = mockEnv();
    const result = await runIngressPipeline(
      env,
      validEvent,
      SOURCE_EXTERNAL_CLIENT,
      logger,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("no_relays_configured");
    }
    expect(env.BLASTR_PUBLISH_QUEUE.send).not.toHaveBeenCalled();
  });

  it("accepts event and calls queue.send and markPublished on success", async () => {
    const env = mockEnv();
    const result = await runIngressPipeline(
      env,
      validEvent,
      SOURCE_EXTERNAL_CLIENT,
      logger,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.jobId).toBe(1);
      expect(result.eventId).toBe(validEvent.id);
    }
    expect(env.BLASTR_PUBLISH_QUEUE.send).toHaveBeenCalledTimes(1);
    expect(dedupe.markPublished).toHaveBeenCalledWith(
      validEvent.id,
      env.PUBLISHED_NOTES,
    );
  });

  it("does not call markPublished when queue.send rejects", async () => {
    const env = mockEnv({ queueSendRejects: true });
    await expect(
      runIngressPipeline(env, validEvent, SOURCE_EXTERNAL_CLIENT, logger),
    ).rejects.toThrow("queue send failed");
    expect(env.BLASTR_PUBLISH_QUEUE.send).toHaveBeenCalledTimes(1);
    expect(dedupe.markPublished).not.toHaveBeenCalled();
  });

  it("returns existing job id when event already has a job (idempotent)", async () => {
    vi.mocked(jobs.ensureJob).mockResolvedValue({ jobId: 42, inserted: false });
    const env = mockEnv();
    const result = await runIngressPipeline(
      env,
      validEvent,
      SOURCE_EXTERNAL_CLIENT,
      logger,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.jobId).toBe(42);
      expect(result.eventId).toBe(validEvent.id);
    }
    expect(env.BLASTR_PUBLISH_QUEUE.send).not.toHaveBeenCalled();
    expect(dedupe.markPublished).not.toHaveBeenCalled();
  });
});
