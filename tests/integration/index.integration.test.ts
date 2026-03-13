import type {
  ExecutionContext,
  IncomingRequestCfProperties,
} from "@cloudflare/workers-types";
import { describe, it, expect, vi } from "vitest";

import type { Env } from "../../src/types";

const MIME_NOSTR_JSON = "application/nostr+json";

function minimalValidEnv(): Env {
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
      prepare: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({}),
      }),
    },
    BLASTR_PUBLISH_QUEUE: { send: vi.fn().mockResolvedValue(void 0) },
  } as unknown as Env;
}

async function fetchWithHeaders(
  path: string,
  env: Env,
  headers: Record<string, string> = {},
): Promise<Response> {
  const mod = await import("../../src/index");
  const handler = mod.default;
  if (!handler.fetch) throw new Error("handler.fetch is undefined");
  const request = new Request(`http://localhost${path}`, {
    method: "GET",
    headers,
  });
  const ctx = {} as ExecutionContext; // eslint-disable-line @typescript-eslint/consistent-type-assertions -- test mock
  return handler.fetch(
    request as Request<unknown, IncomingRequestCfProperties<unknown>>,
    env,
    ctx,
  );
}

describe("GET / (NIP-11)", () => {
  it("returns NIP-11 JSON when Accept is application/nostr+json", async () => {
    const env = minimalValidEnv();
    const res = await fetchWithHeaders("/", env, {
      Accept: MIME_NOSTR_JSON,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(MIME_NOSTR_JSON);
    const json = (await res.json()) as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion -- res.json() returns any
    expect(json).toHaveProperty("name", "Blastr");
    expect(json).toHaveProperty("supported_nips", [1, 11, 15, 20]);
    expect(json).toHaveProperty("limitation");
    expect(json["limitation"]).toEqual({ write: true, read: false });
  });

  it("returns NIP-11 JSON when Accept is */*", async () => {
    const env = minimalValidEnv();
    const res = await fetchWithHeaders("/", env, { Accept: "*/*" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(MIME_NOSTR_JSON);
    const json = (await res.json()) as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion -- res.json() returns any
    expect(json["name"]).toBe("Blastr");
  });

  it("returns plain text when Accept does not request nostr+json", async () => {
    const env = minimalValidEnv();
    const res = await fetchWithHeaders("/", env, { Accept: "text/plain" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Blastr relay");
    expect(text).toContain("POST /event");
  });

  it("returns plain text when Accept header is missing", async () => {
    const env = minimalValidEnv();
    const res = await fetchWithHeaders("/", env, {});
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Blastr relay");
  });

  it("accepts X-Correlation-ID without error (correlation id path)", async () => {
    const env = minimalValidEnv();
    const res = await fetchWithHeaders("/", env, {
      Accept: MIME_NOSTR_JSON,
      "X-Correlation-ID": "test-correlation-123",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("name", "Blastr");
  });
});

describe("Index 404", () => {
  it("returns 404 for unknown path", async () => {
    const env = minimalValidEnv();
    const res = await fetchWithHeaders("/unknown", env, {});
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
  });
});
