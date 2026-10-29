import type {
  ExecutionContext,
  ScheduledController,
} from "@cloudflare/workers-types";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../../src/types";

function minimalEnv(overrides: Partial<Env> = {}): {
  env: Env;
  prepare: ReturnType<typeof vi.fn>;
} {
  const prepare = vi.fn();
  const base = {
    PUBLISHED_NOTES: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(void 0),
    },
    BLASTR_RATE_LIMIT: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(void 0),
    },
    DB: { prepare },
    BLASTR_PUBLISH_QUEUE: { send: vi.fn().mockResolvedValue(void 0) },
  };
  return {
    env: {
      ...base,
      ...overrides,
      DB: overrides.DB ?? base.DB,
    } as unknown as Env,
    prepare: overrides.DB ? vi.fn() : prepare,
  };
}

const controller = {
  cron: "*/15 * * * *",
  scheduledTime: 0,
  noRetry: vi.fn(),
} as ScheduledController;

async function runScheduled(env: Env): Promise<void> {
  const mod = await import("../../src/index");
  const handler = mod.default;
  if (!handler.scheduled) throw new Error("handler.scheduled is undefined");
  const ctx = {} as ExecutionContext;
  await handler.scheduled(controller, env, ctx);
}

describe("scheduled relay catalog sync", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not touch D1 when NostrMash is unset or the catalog is empty or down", async () => {
    const unset = minimalEnv();
    const fetchUnset = vi.fn();
    vi.stubGlobal("fetch", fetchUnset);
    await runScheduled(unset.env);
    expect(fetchUnset).not.toHaveBeenCalled();
    expect(unset.prepare).not.toHaveBeenCalled();

    const down = minimalEnv({ NOSTRMASH_API_BASE: "https://catalog.example" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );
    await runScheduled(down.env);
    expect(down.prepare).not.toHaveBeenCalled();

    const empty = minimalEnv({ NOSTRMASH_API_BASE: "https://catalog.example" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              generated_at: "2026-10-29T12:00:00Z",
              freshness_seconds: 3600,
              relays: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    await runScheduled(empty.env);
    expect(empty.prepare).not.toHaveBeenCalled();
  });

  it("retries the cron when D1 fails after a real catalog", async () => {
    const prepare = vi.fn(() => {
      throw new Error("d1 down");
    });
    const { env } = minimalEnv({
      NOSTRMASH_API_BASE: "https://catalog.example",
      DB: { prepare } as unknown as Env["DB"],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              generated_at: "2026-10-29T12:00:00Z",
              freshness_seconds: 3600,
              relays: [
                {
                  relay_url: "wss://relay.example",
                  distinct_users: 3,
                  score: 0.5,
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    await expect(runScheduled(env)).rejects.toThrow("d1 down");
  });
});
