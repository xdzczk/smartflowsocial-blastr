import type { ExecutionContext, MessageBatch } from "@cloudflare/workers-types";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { Env, PublishJobMessage } from "../../src/types";

/* eslint-disable @typescript-eslint/consistent-type-assertions -- mock batch/ctx for queue handler */

const processQueueMessage = vi.fn();
vi.mock("../../src/transport/queue", () => ({ processQueueMessage }));

const message: PublishJobMessage = {
  jobId: "1",
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
  resolvedRelays: [],
  source: "external-client",
  receivedAt: Date.now(),
};

const env = {} as unknown as Env;

/**
 * Queue handler only acks on success; when processQueueMessage throws, message is not ack'd.
 */
describe("queue consumer ack behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not ack when processQueueMessage throws", async () => {
    processQueueMessage.mockRejectedValueOnce(new Error("fanout failed"));

    const ack = vi.fn();
    const batch: MessageBatch<PublishJobMessage> = {
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
    const ctx: ExecutionContext = {} as ExecutionContext;

    const mod = await import("../../src/index");
    const handler = mod.default;
    if (!handler.queue) throw new Error("handler.queue is undefined");

    await handler.queue(batch, env, ctx);

    expect(ack).not.toHaveBeenCalled();
  });

  it("acks when processQueueMessage completes", async () => {
    processQueueMessage.mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined -- vi.fn() type requires one argument

    const ack = vi.fn();
    const batch: MessageBatch<PublishJobMessage> = {
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
    const ctx: ExecutionContext = {} as ExecutionContext;

    const mod = await import("../../src/index");
    const handler = mod.default;
    if (!handler.queue) throw new Error("handler.queue is undefined");

    await handler.queue(batch, env, ctx);

    expect(ack).toHaveBeenCalledTimes(1);
  });
});
/* eslint-enable @typescript-eslint/consistent-type-assertions */
