import type { ExecutionContext, MessageBatch } from "@cloudflare/workers-types";
import { describe, it, expect, vi, beforeEach } from "vitest";

import * as db from "../../src/services/db";
import * as jobs from "../../src/services/jobs";
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
    DB: {},
    BLASTR_PUBLISH_QUEUE: { send: vi.fn().mockResolvedValue(void 0) },
  } as unknown as Env;
}

describe("Queue consumer failure paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
