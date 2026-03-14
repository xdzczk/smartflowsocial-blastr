import type {
  ExecutionContext,
  IncomingRequestCfProperties,
} from "@cloudflare/workers-types";
import { describe, it, expect, vi } from "vitest";

import type { Env } from "../../src/types";

function minimalValidEnv(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    PUBLISHED_NOTES: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(void 0),
    },
    BLASTR_RATE_LIMIT: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(void 0),
    },
    DB: {
      prepare: vi
        .fn()
        .mockReturnValue({ first: vi.fn().mockResolvedValue({}) }),
    },
    BLASTR_PUBLISH_QUEUE: { send: vi.fn().mockResolvedValue(void 0) },
    ...overrides,
  } as unknown as Env;
}

async function fetchHandler(
  path: string,
  env: Env,
  method = "GET",
): Promise<Response> {
  const mod = await import("../../src/index");
  const handler = mod.default;
  const request = new Request(`http://localhost${path}`, { method });
  const ctx = {} as ExecutionContext; // eslint-disable-line @typescript-eslint/consistent-type-assertions -- test mock
  if (!handler.fetch) throw new Error("handler.fetch is undefined");
  return handler.fetch(
    request as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    ctx,
  );
}

/**
 * Minimal integration-style test: fetch handler with GET /health returns 200.
 * Uses a minimal mock Env (bindings can be empty for health path).
 */
describe("GET /health", () => {
  it("returns 200 and ok status", async () => {
    const env = minimalValidEnv();
    const response = await fetchHandler("/health", env);
    expect(response.status).toBe(200);
    const json = (await response.json()) as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion -- response.json() returns any
    expect(json).toHaveProperty("status", "ok");
  });
});

describe("Environment validation failure", () => {
  it("returns 500 with CONFIGURATION_ERROR when required binding is missing", async () => {
    const env = minimalValidEnv({ DB: undefined });
    const response = await fetchHandler("/health", env);
    expect(response.status).toBe(500);
    const json = (await response.json()) as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion -- response.json() returns any
    expect(json).toHaveProperty("code", "CONFIGURATION_ERROR");
    expect(json).toHaveProperty("details");
    expect(
      (json["details"] as Record<string, unknown>)["message"],
    ).toBeDefined();
    expect(
      String((json["details"] as Record<string, unknown>)["message"]),
    ).toContain("DB");
  });
});

describe("GET /ready", () => {
  it("returns 200 with status ok and checks when all dependencies are healthy", async () => {
    const env = minimalValidEnv();
    const response = await fetchHandler("/ready", env);
    expect(response.status).toBe(200);
    const json = (await response.json()) as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion -- response.json() returns any
    expect(json).toHaveProperty("status", "ok");
    expect(json).toHaveProperty("checks");
    expect(json["checks"]).toEqual({ db: true, kv: true, queue: true });
  });

  it("returns 503 with status degraded when checkReadiness fails (e.g. DB unreachable)", async () => {
    const env = minimalValidEnv({
      DB: {
        prepare: vi.fn().mockRejectedValue(new Error("D1 unavailable")),
      },
    });
    const response = await fetchHandler("/ready", env);
    expect(response.status).toBe(503);
    const json = (await response.json()) as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion -- response.json() returns any
    expect(json).toHaveProperty("status", "degraded");
    expect(json).toHaveProperty("checks");
    expect((json["checks"] as Record<string, unknown>)["db"]).not.toBe(true);
  });
});
