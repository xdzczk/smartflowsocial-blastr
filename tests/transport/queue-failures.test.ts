import type { ExecutionContext, MessageBatch } from "@cloudflare/workers-types";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import * as db from "../../src/services/db";
import * as jobs from "../../src/services/jobs";
import {
  __setRunWithConcurrencyForTesting,
  runWithConcurrency,
} from "../../src/transport/queue";
import type { Env, PublishJobMessage } from "../../src/types";

vi.mock("../../src/services/db");
vi.mock("../../src/services/jobs");

const message: PublishJobMessage = {
  jobId: "999",
  event: {
    id: "a".repeat(64),
    pubkey: "b".repeat(64),
    created_at: Math.floor(Date.now() / 1000),
    kind: 1,
    tags: [],
    content: "",
    sig: "c".repeat(128),
  },
  pubkey: "b".repeat(64),
  resolvedRelays: ["wss://r.example.com"],
  source: "external-client",
  receivedAt: Date.now(),
};

function env(): Env {
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

describe("Queue consumer failure paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    __setRunWithConcurrencyForTesting(runWithConcurrency);
  });

  it("does not ack when getJobById returns null", async () => {
    vi.mocked(db.getJobById).mockResolvedValue(null);

    const ack = vi.fn();
    const batchLiteral = {
      messages: [
        {
          body: message,
          ack,
          id: "msg-1",
          timestamp: new Date(),
          attempts: 0,
          retry: vi.fn(),
        },
      ],
      queue: "blastr-publish-jobs",
      retryAll: vi.fn(),
      ackAll: vi.fn(),
    };
    const batch = batchLiteral as MessageBatch<PublishJobMessage>;
    const ctxLiteral = {};
    const ctx = ctxLiteral as ExecutionContext;

    const mod = await import("../../src/index");
    const handler = mod.default;
    if (!handler.queue) throw new Error("handler.queue is undefined");

    await handler.queue(batch, env(), ctx);

    expect(db.getJobById).toHaveBeenCalledWith(expect.anything(), 999);
    expect(ack).not.toHaveBeenCalled();
    expect(jobs.updateJobStatus).not.toHaveBeenCalled();
  });

  it("records attempt_number as retry attempt (1-based try), not relay index", async () => {
    const fakeResult = {
      success: true as const,
      attemptNumber: 2,
      latencyMs: 10,
    };
    __setRunWithConcurrencyForTesting(
      async <T, R>(items: T[], _c: number, _fn: (item: T, i: number) => Promise<R>) =>
        Promise.resolve(items.map(() => fakeResult) as unknown as R[]),
    );
    vi.mocked(db.getJobById).mockResolvedValue({
      id: 999,
      event_id: message.event.id,
      pubkey: message.pubkey,
      source: message.source,
      received_at: Math.floor(message.receivedAt / 1000),
      status: "queued",
      relay_count_target: 1,
      relay_count_success: 0,
      relay_count_failed: 0,
      resolved_relays: JSON.stringify(message.resolvedRelays),
    });

    const ack = vi.fn();
    const batchLiteral = {
      messages: [
        {
          body: message,
          ack,
          id: "msg-1",
          timestamp: new Date(),
          attempts: 0,
          retry: vi.fn(),
        },
      ],
      queue: "blastr-publish-jobs",
      retryAll: vi.fn(),
      ackAll: vi.fn(),
    };
    const batch = batchLiteral as MessageBatch<PublishJobMessage>;
    const ctxLiteral = {};
    const ctx = ctxLiteral as ExecutionContext;

    const mod = await import("../../src/index");
    const handler = mod.default;
    if (!handler.queue) throw new Error("handler.queue is undefined");

    await handler.queue(batch, env(), ctx);

    expect(jobs.createAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: 999,
        relayUrl: "wss://r.example.com",
        attemptNumber: 2,
        status: "ok",
      }),
    );
    expect(ack).toHaveBeenCalledTimes(1);
  });
});
