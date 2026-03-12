import type {
  ExecutionContext,
  IncomingRequestCfProperties,
} from "@cloudflare/workers-types";
import { describe, it, expect, vi } from "vitest";

import type { Env } from "../../src/types";

/* eslint-disable @typescript-eslint/consistent-type-assertions -- test Request cast for Workers fetch signature */

const CORS_ALLOWED_ORIGIN = "https://example.com";

function corsTestEnv(): Env {
  return {
    PUBLISHED_NOTES: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(void 0),
    },
    DB: {},
    BLASTR_PUBLISH_QUEUE: { send: vi.fn().mockResolvedValue(void 0) },
    CORS_ENABLED: "true",
    CORS_ORIGINS: CORS_ALLOWED_ORIGIN,
  } as unknown as Env;
}

/**
 * OPTIONS /event (CORS preflight) returns 204 with CORS headers when origin is allowed.
 */
describe("CORS OPTIONS /event", () => {
  it("returns 204 with CORS headers for allowed origin", async () => {
    const mod = await import("../../src/index");
    const handler = mod.default;
    const env = corsTestEnv();
    const request = new Request("http://localhost/event", {
      method: "OPTIONS",
      headers: { Origin: CORS_ALLOWED_ORIGIN },
    });
    const ctx = {} as ExecutionContext;
    if (!handler.fetch) throw new Error("handler.fetch is undefined");
    type Req = Request<unknown, IncomingRequestCfProperties<unknown>>;
    const req: Req = request as Req;
    const response = await handler.fetch(req, env, ctx);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      CORS_ALLOWED_ORIGIN,
    );
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "POST",
    );
  });

  it("returns 403 for disallowed origin when CORS enabled", async () => {
    const mod = await import("../../src/index");
    const handler = mod.default;
    const env = corsTestEnv();
    const request = new Request("http://localhost/event", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.com" },
    });
    const ctx = {} as ExecutionContext;
    if (!handler.fetch) throw new Error("handler.fetch is undefined");
    type Req = Request<unknown, IncomingRequestCfProperties<unknown>>;
    const req: Req = request as Req;
    const response = await handler.fetch(req, env, ctx);
    expect(response.status).toBe(403);
  });
});
/* eslint-enable @typescript-eslint/consistent-type-assertions */
