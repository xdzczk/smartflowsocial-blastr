import { describe, it, expect, vi } from "vitest";

import { checkAdminRateLimit } from "../../src/services/rate-limit";
import type { Env } from "../../src/types";

function mockEnv(
  get: (key: string) => Promise<unknown>,
  put: (key: string, value: string, opts?: { expirationTtl: number }) => Promise<void>,
): Env {
  const rateLimitKv = { get, put };
  const base: Record<string, unknown> = {
    PUBLISHED_NOTES: { get: vi.fn(), put: vi.fn() },
    BLASTR_RATE_LIMIT: rateLimitKv,
    DB: {},
    BLASTR_PUBLISH_QUEUE: { send: vi.fn() },
  };
  return base as unknown as Env;
}

describe("checkAdminRateLimit", () => {
  it("returns allowed when under limit", async () => {
    const put = vi.fn().mockResolvedValue(void 0);
    const env = mockEnv(vi.fn().mockResolvedValue(null), put);
    const req = new Request("http://localhost/admin/entitlements/x", {
      headers: { "CF-Connecting-IP": "1.2.3.4" },
    });
    const r = await checkAdminRateLimit(req, env);
    expect(r.allowed).toBe(true);
  });

  it("returns not allowed when count at or over limit", async () => {
    const now = Math.floor(Date.now() / 1000);
    const env = mockEnv(
      vi.fn().mockResolvedValue({ count: 60, windowStart: now - 30 }),
      vi.fn().mockResolvedValue(void 0),
    );
    const req = new Request("http://localhost/admin/users/x");
    const r = await checkAdminRateLimit(req, env);
    expect(r.allowed).toBe(false);
    expect(r.retryAfter).toBeDefined();
  });

  it("uses X-Forwarded-For when CF-Connecting-IP missing", async () => {
    const put = vi.fn().mockResolvedValue(void 0);
    const get = vi.fn().mockResolvedValue(null);
    const env = mockEnv(get, put);
    const req = new Request("http://localhost/admin/users/x", {
      headers: { "X-Forwarded-For": " 10.0.0.1 , 10.0.0.2" },
    });
    await checkAdminRateLimit(req, env);
    expect(put).toHaveBeenCalled();
  });

  it("treats invalid KV data (no count) as fresh and allows request", async () => {
    const put = vi.fn().mockResolvedValue(void 0);
    const get = vi.fn().mockResolvedValue({ wrong: "shape" });
    const env = mockEnv(get, put);
    const req = new Request("http://localhost/admin/entitlements/x");
    const r = await checkAdminRateLimit(req, env);
    expect(r.allowed).toBe(true);
  });
});
