import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { ConsoleLogger } from "../src/logger";

/** Get first call's first argument from a vi.fn() spy (returns unknown to avoid unsafe any). */
function getFirstCallArg(spy: ReturnType<typeof vi.fn>): unknown {
  return spy.mock.calls[0]?.[0];
}

/** Parse JSON string to unknown to avoid unsafe any from JSON.parse. */
function parseJsonSafe(s: string): unknown {
  return JSON.parse(s) as unknown;
}

describe("ConsoleLogger", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("outputs structured JSON with level, message, correlationId when set", () => {
    const log = new ConsoleLogger();
    log.setCorrelationId("abc-123");
    log.info("test");
    const out = getFirstCallArg(console.info as ReturnType<typeof vi.fn>);
    expect(out).toBeDefined();
    const parsed = parseJsonSafe(out as string);
    expect(parsed).toMatchObject({
      level: "info",
      message: "test",
      correlationId: "abc-123",
    });
  });

  it("outputs structured JSON without correlationId when not set", () => {
    const log = new ConsoleLogger();
    log.warn("warn message");
    const out = getFirstCallArg(console.warn as ReturnType<typeof vi.fn>);
    expect(out).toBeDefined();
    const parsed = parseJsonSafe(out as string);
    expect(parsed).toMatchObject({ level: "warn", message: "warn message" });
    expect(parsed).not.toHaveProperty("correlationId");
  });

  it("includes meta in structured JSON", () => {
    const log = new ConsoleLogger();
    log.error("failed", { code: "ERR" });
    const out = getFirstCallArg(console.error as ReturnType<typeof vi.fn>);
    expect(out).toBeDefined();
    const parsed = parseJsonSafe(out as string);
    expect(parsed).toMatchObject({
      level: "error",
      message: "failed",
      code: "ERR",
    });
  });
});
