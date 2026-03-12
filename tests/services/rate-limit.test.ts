import { describe, it, expect, vi, beforeEach } from "vitest";

import { checkRateLimit } from "../../src/services/rate-limit";
import type { Env } from "../../src/types";

function mockEnv(
  get: (key: string) => Promise<string | null>,
  put: (
    key: string,
    value: string,
    opts?: { expirationTtl: number },
  ) => Promise<void>,
): Env {
  const notes = { get, put };
  const db = {};
  const queue = {};
  return {
    PUBLISHED_NOTES: notes as Env["PUBLISHED_NOTES"],
    DB: db as Env["DB"],
    BLASTR_PUBLISH_QUEUE: queue as Env["BLASTR_PUBLISH_QUEUE"],
  };
}

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows first request", async () => {
    const put = vi.fn().mockResolvedValue(void 0);
    const env = mockEnv(vi.fn().mockResolvedValue(null), put);
    const r = await checkRateLimit("pubkey1", env, { requestsPerMinute: 10 });
    expect(r.allowed).toBe(true);
    expect(put).toHaveBeenCalled();
  });

  it("allows under limit", async () => {
    const put = vi.fn().mockResolvedValue(void 0);
    const now = Math.floor(Date.now() / 1000);
    const env = mockEnv(
      vi.fn().mockResolvedValue({ count: 5, windowStart: now - 30 }),
      put,
    );
    const r = await checkRateLimit("pk", env, { requestsPerMinute: 10 });
    expect(r.allowed).toBe(true);
  });

  it("rejects when over limit", async () => {
    const now = Math.floor(Date.now() / 1000);
    const env = mockEnv(
      vi.fn().mockResolvedValue({ count: 10, windowStart: now - 30 }),
      vi.fn().mockResolvedValue(void 0),
    );
    const r = await checkRateLimit("pk", env, { requestsPerMinute: 10 });
    expect(r.allowed).toBe(false);
    expect(r.retryAfter).toBeDefined();
  });
});
