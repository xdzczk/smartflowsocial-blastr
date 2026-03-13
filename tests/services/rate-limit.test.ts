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
  const rateLimitKv = { get, put };
  const db = {};
  const queue = {};
  const publishedNotes = { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(void 0) };
  return {
    PUBLISHED_NOTES: publishedNotes as unknown as Env["PUBLISHED_NOTES"],
    BLASTR_RATE_LIMIT: rateLimitKv as unknown as Env["BLASTR_RATE_LIMIT"],
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

  it("treats non-object KV value as no prior count", async () => {
    const put = vi.fn().mockResolvedValue(void 0);
    const env = mockEnv(vi.fn().mockResolvedValue("invalid"), put);
    const r = await checkRateLimit("pk", env);
    expect(r.allowed).toBe(true);
  });

  it("ignores stale window (data.windowStart < windowStart) and allows request", async () => {
    const now = Math.floor(Date.now() / 1000);
    const put = vi.fn().mockResolvedValue(void 0);
    const env = mockEnv(
      vi.fn().mockResolvedValue({
        count: 5,
        windowStart: now - 120,
      }),
      put,
    );
    const r = await checkRateLimit("pk", env, { requestsPerMinute: 10 });
    expect(r.allowed).toBe(true);
  });

  it("uses premium profile limits when rateLimitProfile is premium", async () => {
    const put = vi.fn().mockResolvedValue(void 0);
    const env = mockEnv(vi.fn().mockResolvedValue(null), put);
    const r = await checkRateLimit("pk", env, {
      rateLimitProfile: "premium",
      requestsPerMinute: 300,
    });
    expect(r.allowed).toBe(true);
  });

  it("uses RATE_LIMIT_WINDOW_MS and RATE_LIMIT_REQUESTS from env when valid", async () => {
    const put = vi.fn().mockResolvedValue(void 0);
    const env = mockEnv(vi.fn().mockResolvedValue(null), put);
    const envWithOverride: Env = {
      ...env,
      RATE_LIMIT_WINDOW_MS: "120000",
      RATE_LIMIT_REQUESTS: "50",
    };
    const r = await checkRateLimit("pk", envWithOverride);
    expect(r.allowed).toBe(true);
  });
});
