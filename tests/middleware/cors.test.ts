import { describe, it, expect, vi } from "vitest";

import {
  getCorsConfig,
  handleCorsPreflight,
  addCorsHeaders,
} from "../../src/middleware/cors";
import type { Env } from "../../src/types";

const CORS_ORIGINS_TWO = "https://a.com, https://b.com";
const CORS_ORIGINS_X = "https://x.com";
const LOCALHOST_EVENT = "http://localhost/event";
const ORIGIN_A = "https://a.com";
const CORS_HEADER = "Access-Control-Allow-Origin";

function env(overrides: Partial<Env> = {}): Env {
  const base: Record<string, unknown> = {
    PUBLISHED_NOTES: { get: vi.fn(), put: vi.fn() },
    BLASTR_RATE_LIMIT: { get: vi.fn(), put: vi.fn() },
    DB: {},
    BLASTR_PUBLISH_QUEUE: { send: vi.fn() },
    ...overrides,
  };
  return base as unknown as Env;
}

describe("cors", () => {
  describe("getCorsConfig", () => {
    it("returns enabled false when CORS_ENABLED is not true", () => {
      const config = getCorsConfig(env());
      expect(config.enabled).toBe(false);
      expect(config.allowedOrigins.size).toBe(0);
    });

    it("returns enabled true and parses CORS_ORIGINS", () => {
      const config = getCorsConfig(
        env({ CORS_ENABLED: "true", CORS_ORIGINS: CORS_ORIGINS_TWO }),
      );
      expect(config.enabled).toBe(true);
      expect(config.allowedOrigins.has(ORIGIN_A)).toBe(true);
      expect(config.allowedOrigins.has("https://b.com")).toBe(true);
    });
  });

  describe("handleCorsPreflight", () => {
    it("returns null when method is not OPTIONS", () => {
      const config = getCorsConfig(
        env({ CORS_ENABLED: "true", CORS_ORIGINS: CORS_ORIGINS_X }),
      );
      const req = new Request(LOCALHOST_EVENT, { method: "GET" });
      expect(handleCorsPreflight(req, config)).toBeNull();
    });

    it("returns 403 when origin is not allowed", () => {
      const config = getCorsConfig(
        env({ CORS_ENABLED: "true", CORS_ORIGINS: CORS_ORIGINS_X }),
      );
      const req = new Request(LOCALHOST_EVENT, {
        method: "OPTIONS",
        headers: { Origin: "https://evil.com" },
      });
      const res = handleCorsPreflight(req, config);
      expect(res).not.toBeNull();
      expect(res?.status).toBe(403);
    });

    it("returns 403 when config enabled but no origins", () => {
      const config = getCorsConfig(env({ CORS_ENABLED: "true" }));
      const req = new Request(LOCALHOST_EVENT, {
        method: "OPTIONS",
        headers: { Origin: "https://any.com" },
      });
      const res = handleCorsPreflight(req, config);
      expect(res).not.toBeNull();
      expect(res?.status).toBe(403);
    });
  });

  describe("addCorsHeaders", () => {
    it("returns response unchanged when config enabled is false", () => {
      const config = getCorsConfig(env());
      const req = new Request(LOCALHOST_EVENT, {
        headers: { Origin: "https://x.com" },
      });
      const res = new Response("ok", { status: 200 });
      const out = addCorsHeaders(req, res, config);
      expect(out).toBe(res);
      expect(out.headers.has(CORS_HEADER)).toBe(false);
    });

    it("returns response unchanged when origin not allowed", () => {
      const config = getCorsConfig(
        env({ CORS_ENABLED: "true", CORS_ORIGINS: ORIGIN_A }),
      );
      const req = new Request(LOCALHOST_EVENT, {
        headers: { Origin: "https://other.com" },
      });
      const res = new Response("ok", { status: 200 });
      const out = addCorsHeaders(req, res, config);
      expect(out.headers.get(CORS_HEADER)).not.toBe("https://other.com");
    });

    it("adds CORS headers when enabled and origin allowed", () => {
      const config = getCorsConfig(
        env({ CORS_ENABLED: "true", CORS_ORIGINS: ORIGIN_A }),
      );
      const req = new Request(LOCALHOST_EVENT, {
        headers: { Origin: ORIGIN_A },
      });
      const res = new Response("ok", { status: 200 });
      const out = addCorsHeaders(req, res, config);
      expect(out.headers.get(CORS_HEADER)).toBe(ORIGIN_A);
      expect(out.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    });
  });
});
