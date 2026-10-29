import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import * as db from "../../src/services/db";
import * as jobs from "../../src/services/jobs";
import {
  classifyRelayError,
  processQueueMessage,
  __setRunWithConcurrencyForTesting,
  runWithConcurrency,
} from "../../src/transport/queue";
import type { Env, PublishJobMessage } from "../../src/types";

vi.mock("../../src/services/db");
vi.mock("../../src/services/jobs");

const WSS_R1 = "wss://r1.com";

const baseMessage: PublishJobMessage = {
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

function env(): Env {
  return {
    PUBLISHED_NOTES: { get: vi.fn(), put: vi.fn() },
    BLASTR_RATE_LIMIT: { get: vi.fn(), put: vi.fn() },
    DB: {},
    BLASTR_PUBLISH_QUEUE: { send: vi.fn() },
  } as unknown as Env;
}

describe("classifyRelayError", () => {
  it("returns transient when errorCode is undefined", () => {
    expect(classifyRelayError()).toBe("transient");
  });

  it.each([
    ["blocked", "permanent"],
    ["invalid", "permanent"],
    ["duplicate", "permanent"],
  ] as const)('returns %s for errorCode "%s"', (code, kind) => {
    expect(classifyRelayError(code)).toBe(kind);
  });

  it.each([
    ["timeout", "transient"],
    ["connection_error", "transient"],
    ["closed", "transient"],
  ] as const)('returns %s for errorCode "%s"', (code, kind) => {
    expect(classifyRelayError(code)).toBe(kind);
  });

  it("returns transient for unknown errorCode (default branch)", () => {
    expect(classifyRelayError("unknown")).toBe("transient");
    expect(classifyRelayError("")).toBe("transient");
  });
});

describe("processQueueMessage", () => {
  const logger = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    setCorrelationId: vi.fn(),
    getCorrelationId: vi.fn().mockReturnValue(null),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    __setRunWithConcurrencyForTesting(runWithConcurrency);
  });

  it("returns early without calling getJobById or updateJobStatus when jobId is invalid (NaN)", async () => {
    const body: PublishJobMessage = { ...baseMessage, jobId: "abc" };

    await processQueueMessage(body, env(), logger);

    expect(db.getJobById).not.toHaveBeenCalled();
    expect(jobs.updateJobStatus).not.toHaveBeenCalled();
    expect(jobs.createAttempt).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Invalid jobId in queue message",
      expect.objectContaining({ jobId: "abc" }),
    );
  });

  it("updates job status to success when all relays succeed", async () => {
    __setRunWithConcurrencyForTesting(
      async <T, R>(
        items: T[],
        _c: number,
        _fn: (item: T, i: number) => Promise<R>,
      ) =>
        Promise.resolve(
          items.map(() => ({
            success: true,
            attemptNumber: 1,
            latencyMs: 5,
          })) as unknown as R[],
        ),
    );
    vi.mocked(db.getJobById).mockResolvedValue({
      id: 1,
      event_id: baseMessage.event.id,
      pubkey: baseMessage.pubkey,
      source: baseMessage.source,
      received_at: Math.floor(baseMessage.receivedAt / 1000),
      status: "queued",
      relay_count_target: 1,
      relay_count_success: 0,
      relay_count_failed: 0,
      resolved_relays: JSON.stringify([WSS_R1]),
    });
    vi.mocked(jobs.updateJobStatus).mockResolvedValue();
    const callOrder: string[] = [];
    vi.mocked(jobs.createAttempt).mockImplementation(async () => {
      callOrder.push("attempt");
    });
    vi.mocked(db.recordSystemRelayWriteHealth).mockImplementation(async () => {
      callOrder.push("health");
    });

    const body: PublishJobMessage = {
      ...baseMessage,
      jobId: "1",
      resolvedRelays: [WSS_R1],
    };
    await processQueueMessage(body, env(), logger);

    expect(callOrder).toEqual(["attempt", "health"]);
    expect(db.recordSystemRelayWriteHealth).toHaveBeenCalledWith(
      expect.anything(),
      { relayUrl: WSS_R1, success: true },
    );
    expect(jobs.updateJobStatus).toHaveBeenLastCalledWith(
      expect.anything(),
      1,
      "success",
      { success: 1, failed: 0 },
    );
  });

  it("updates job status to failed when all relays fail", async () => {
    __setRunWithConcurrencyForTesting(
      async <T, R>(
        items: T[],
        _c: number,
        _fn: (item: T, i: number) => Promise<R>,
      ) =>
        Promise.resolve(
          items.map(() => ({
            success: false,
            errorCode: "timeout",
            attemptNumber: 1,
            latencyMs: 100,
          })) as unknown as R[],
        ),
    );
    vi.mocked(db.getJobById).mockResolvedValue({
      id: 1,
      event_id: baseMessage.event.id,
      pubkey: baseMessage.pubkey,
      source: baseMessage.source,
      received_at: Math.floor(baseMessage.receivedAt / 1000),
      status: "queued",
      relay_count_target: 1,
      relay_count_success: 0,
      relay_count_failed: 0,
      resolved_relays: JSON.stringify([WSS_R1]),
    });
    vi.mocked(jobs.updateJobStatus).mockResolvedValue();
    vi.mocked(jobs.createAttempt).mockResolvedValue();

    const bodyFailed: PublishJobMessage = {
      ...baseMessage,
      jobId: "1",
      resolvedRelays: [WSS_R1],
    };
    await processQueueMessage(bodyFailed, env(), logger);

    expect(jobs.updateJobStatus).toHaveBeenLastCalledWith(
      expect.anything(),
      1,
      "failed",
      { success: 0, failed: 1 },
    );
    expect(db.recordSystemRelayWriteHealth).toHaveBeenCalledWith(
      expect.anything(),
      { relayUrl: WSS_R1, success: false },
    );
  });

  it("updates job status to partial when some relays succeed", async () => {
    __setRunWithConcurrencyForTesting(
      async <T, R>(
        items: T[],
        _c: number,
        _fn: (item: T, i: number) => Promise<R>,
      ) =>
        Promise.resolve(
          items.map((_, i) =>
            i === 0
              ? { success: true, attemptNumber: 1, latencyMs: 5 }
              : {
                  success: false,
                  errorCode: "timeout",
                  attemptNumber: 1,
                  latencyMs: 10,
                },
          ) as unknown as R[],
        ),
    );
    vi.mocked(db.getJobById).mockResolvedValue({
      id: 1,
      event_id: baseMessage.event.id,
      pubkey: baseMessage.pubkey,
      source: baseMessage.source,
      received_at: Math.floor(baseMessage.receivedAt / 1000),
      status: "queued",
      relay_count_target: 2,
      relay_count_success: 0,
      relay_count_failed: 0,
      resolved_relays: JSON.stringify([WSS_R1, "wss://r2.com"]),
    });
    vi.mocked(jobs.updateJobStatus).mockResolvedValue();
    vi.mocked(jobs.createAttempt).mockResolvedValue();

    const bodyPartial: PublishJobMessage = {
      ...baseMessage,
      jobId: "1",
      resolvedRelays: [WSS_R1, "wss://r2.com"],
    };
    await processQueueMessage(bodyPartial, env(), logger);

    expect(jobs.updateJobStatus).toHaveBeenLastCalledWith(
      expect.anything(),
      1,
      "partial",
      { success: 1, failed: 1 },
    );
    expect(db.recordSystemRelayWriteHealth).toHaveBeenCalledTimes(2);
  });
});
