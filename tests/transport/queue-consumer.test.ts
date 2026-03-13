import type { ExecutionContext, MessageBatch } from "@cloudflare/workers-types";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { Env, PublishJobMessage } from "../../src/types";

/* eslint-disable @typescript-eslint/consistent-type-assertions -- mock ctx for queue handler */
const processQueueMessage = vi.fn();
vi.mock("../../src/transport/queue", () => ({ processQueueMessage }));

const MSG_ID = "msg-1";
const QUEUE_NAME = "blastr-publish-jobs";
const ERR_HANDLER_QUEUE = "handler.queue is undefined";

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
          id: MSG_ID,
          timestamp: new Date(),
          attempts: 0,
          retry: vi.fn(),
        },
      ],
      queue: QUEUE_NAME,
      retryAll: vi.fn(),
      ackAll: vi.fn(),
    };
    const ctx = {} as ExecutionContext;

    const mod = await import("../../src/index");
    const handler = mod.default;
    if (!handler.queue) throw new Error(ERR_HANDLER_QUEUE);

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
          id: MSG_ID,
          timestamp: new Date(),
          attempts: 0,
          retry: vi.fn(),
        },
      ],
      queue: QUEUE_NAME,
      retryAll: vi.fn(),
      ackAll: vi.fn(),
    };
    const ctx = {} as ExecutionContext;

    const mod = await import("../../src/index");
    const handler = mod.default;
    if (!handler.queue) throw new Error(ERR_HANDLER_QUEUE);

    await handler.queue(batch, env, ctx);

    expect(ack).toHaveBeenCalledTimes(1);
  });

  it("batch: only acks messages that complete successfully; failed message is not acked", async () => {
    processQueueMessage
      .mockRejectedValueOnce(new Error("first fails"))
      .mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined -- explicit for mock typing

    const ack1 = vi.fn();
    const ack2 = vi.fn();
    const batch: MessageBatch<PublishJobMessage> = {
      messages: [
        {
          body: message,
          ack: ack1,
          id: "msg-1",
          timestamp: new Date(),
          attempts: 0,
          retry: vi.fn(),
        },
        {
          body: { ...message, jobId: "2" },
          ack: ack2,
          id: "msg-2",
          timestamp: new Date(),
          attempts: 0,
          retry: vi.fn(),
        },
      ],
      queue: QUEUE_NAME,
      retryAll: vi.fn(),
      ackAll: vi.fn(),
    };
    const ctx = {} as ExecutionContext;

    const mod = await import("../../src/index");
    const handler = mod.default;
    if (!handler.queue) throw new Error(ERR_HANDLER_QUEUE);

    await handler.queue(batch, env, ctx);

    expect(ack1).not.toHaveBeenCalled();
    expect(ack2).toHaveBeenCalledTimes(1);
  });
});
/* eslint-enable @typescript-eslint/consistent-type-assertions */
