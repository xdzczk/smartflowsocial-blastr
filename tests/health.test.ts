import { describe, it, expect, vi, beforeEach } from "vitest";

import { checkReadiness } from "../src/health";
import type { Env } from "../src/types";

function mockEnv(overrides?: {
  dbThrows?: boolean;
  kvThrows?: boolean;
  rateLimitKvThrows?: boolean;
  noQueue?: boolean;
}): Env {
  const dbLiteral = overrides?.dbThrows
    ? { prepare: vi.fn().mockRejectedValue(new Error("D1 unavailable")) }
    : {
        prepare: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue({}) }),
      };
  const db = dbLiteral as unknown as Env["DB"];
  const kvLiteral = overrides?.kvThrows
    ? { get: vi.fn().mockRejectedValue(new Error("KV unavailable")) }
    : { get: vi.fn().mockResolvedValue(null) };
  const kv = kvLiteral as unknown as Env["PUBLISHED_NOTES"];
  const rateLimitKvLiteral = overrides?.rateLimitKvThrows
    ? { get: vi.fn().mockRejectedValue(new Error("Rate limit KV unavailable")) }
    : { get: vi.fn().mockResolvedValue(null) };
  const rateLimitKv = rateLimitKvLiteral as unknown as Env["BLASTR_RATE_LIMIT"];
  const queueLiteral = overrides?.noQueue ? undefined : {};
  const queue = queueLiteral as Env["BLASTR_PUBLISH_QUEUE"] | undefined;
  const envLiteral = {
    DB: db,
    PUBLISHED_NOTES: kv,
    BLASTR_RATE_LIMIT: rateLimitKv,
    BLASTR_PUBLISH_QUEUE: queue,
  };
  return envLiteral as Env;
}

describe("checkReadiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok when D1, KV and queue are available", async () => {
    const result = await checkReadiness(mockEnv());
    expect(result.ok).toBe(true);
    expect(result.checks).toEqual({
      ["db"]: true,
      ["kv"]: true,
      ["queue"]: true,
    });
  });

  it("returns not ok when D1 fails", async () => {
    const result = await checkReadiness(mockEnv({ dbThrows: true }));
    expect(result.ok).toBe(false);
    expect(result.checks["db"]).not.toBe(true);
    expect(result.checks["kv"]).toBe(true);
    expect(result.checks["queue"]).toBe(true);
  });

  it("returns not ok when PUBLISHED_NOTES KV fails", async () => {
    const result = await checkReadiness(mockEnv({ kvThrows: true }));
    expect(result.ok).toBe(false);
    expect(result.checks["db"]).toBe(true);
    expect(result.checks["kv"]).not.toBe(true);
    expect(result.checks["queue"]).toBe(true);
  });

  it("returns not ok when BLASTR_RATE_LIMIT KV fails", async () => {
    const result = await checkReadiness(mockEnv({ rateLimitKvThrows: true }));
    expect(result.ok).toBe(false);
    expect(result.checks["db"]).toBe(true);
    expect(result.checks["kv"]).not.toBe(true);
    expect(result.checks["queue"]).toBe(true);
  });

  it("returns not ok when queue binding is missing", async () => {
    const result = await checkReadiness(mockEnv({ noQueue: true }));
    expect(result.ok).toBe(false);
    expect(result.checks["queue"]).toBe(false);
  });

  it("stores non-Error rejection message in checks when DB throws non-Error", async () => {
    const env = mockEnv();
    (env.DB as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare = vi
      .fn()
      .mockReturnValue({
        first: vi.fn().mockRejectedValue("string error"),
      });
    const result = await checkReadiness(env);
    expect(result.ok).toBe(false);
    expect(result.checks["db"]).toBe("string error");
  });
});
