import { describe, it, expect, vi, beforeEach } from "vitest";

import { validateEnvironment } from "../../src/config/env";
import type { Env } from "../../src/types";

function minimalEnv(overrides: Partial<Record<keyof Env, unknown>> = {}): Env {
  const base = {
    PUBLISHED_NOTES: { get: vi.fn(), put: vi.fn() },
    BLASTR_RATE_LIMIT: { get: vi.fn(), put: vi.fn() },
    DB: {},
    BLASTR_PUBLISH_QUEUE: { send: vi.fn() },
  };
  return { ...base, ...overrides } as unknown as Env;
}

describe("validateEnvironment", () => {
  const logger = { warn: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when PUBLISHED_NOTES is missing", () => {
    const env = minimalEnv({ PUBLISHED_NOTES: undefined });
    expect(() => validateEnvironment(env, logger)).toThrow();
    try {
      validateEnvironment(env, logger);
    } catch (e) {
      expect(String(e)).toContain("PUBLISHED_NOTES");
    }
  });

  it("throws when BLASTR_RATE_LIMIT is missing", () => {
    const env = minimalEnv({ BLASTR_RATE_LIMIT: undefined });
    expect(() => validateEnvironment(env, logger)).toThrow();
    try {
      validateEnvironment(env, logger);
    } catch (e) {
      expect(String(e)).toContain("BLASTR_RATE_LIMIT");
    }
  });

  it("throws when DB is missing", () => {
    const env = minimalEnv({ DB: undefined });
    expect(() => validateEnvironment(env, logger)).toThrow();
    try {
      validateEnvironment(env, logger);
    } catch (e) {
      expect(String(e)).toContain("DB");
    }
  });

  it("throws when BLASTR_PUBLISH_QUEUE is missing", () => {
    const env = minimalEnv({ BLASTR_PUBLISH_QUEUE: undefined });
    expect(() => validateEnvironment(env, logger)).toThrow();
    try {
      validateEnvironment(env, logger);
    } catch (e) {
      expect(String(e)).toContain("BLASTR_PUBLISH_QUEUE");
    }
  });

  it("does not throw when all required bindings are present", () => {
    const env = minimalEnv();
    expect(() => validateEnvironment(env, logger)).not.toThrow();
  });

  it("calls logger.warn when API_TOKEN is not set", () => {
    const env = minimalEnv();
    validateEnvironment(env, logger);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("API_TOKEN"),
    );
  });

  it("does not warn about API_TOKEN when set", () => {
    const env = minimalEnv({ API_TOKEN: "secret" });
    validateEnvironment(env, logger);
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("API_TOKEN"),
    );
  });

  it("calls logger.warn for invalid RATE_LIMIT_REQUESTS", () => {
    const env = minimalEnv({ API_TOKEN: "x", RATE_LIMIT_REQUESTS: "x" });
    validateEnvironment(env, logger);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/RATE_LIMIT_REQUESTS|Invalid.*value/),
    );
  });

  it("calls logger.warn when CORS_ENABLED is true but CORS_ORIGINS is not set", () => {
    const env = minimalEnv({
      API_TOKEN: "x",
      CORS_ENABLED: "true",
      CORS_ORIGINS: undefined,
    });
    validateEnvironment(env, logger);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("CORS_ENABLED"),
    );
  });
});
