import type {
  ExecutionContext,
  IncomingRequestCfProperties,
} from "@cloudflare/workers-types";
import { describe, it, expect, vi } from "vitest";

import type { Env } from "../../src/types";

/**
 * Minimal integration-style test: fetch handler with GET /health returns 200.
 * Uses a minimal mock Env (bindings can be empty for health path).
 */
describe("GET /health", () => {
  it("returns 200 and ok status", async () => {
    const mod = await import("../../src/index");
    const handler = mod.default;
    const env = {
      PUBLISHED_NOTES: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(void 0),
      },
      DB: {},
      BLASTR_PUBLISH_QUEUE: { send: vi.fn().mockResolvedValue(void 0) },
    } as unknown as Env;
    const request = new Request("http://localhost/health", { method: "GET" });
    // ExecutionContext is not used by the health path
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- mock context
    const ctx = {} as ExecutionContext;
    if (!handler.fetch) throw new Error("handler.fetch is undefined");
    const req = request as Request<
      unknown,
      IncomingRequestCfProperties<unknown>
    >;
    const response = await handler.fetch(req, env, ctx);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toHaveProperty("status", "ok");
  });
});
