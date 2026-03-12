import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { ConsoleLogger } from "../src/logger";

describe("ConsoleLogger", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prepends correlation id when set", () => {
    const log = new ConsoleLogger();
    log.setCorrelationId("abc-123");
    log.info("test");
    expect(console.info).toHaveBeenCalledWith("[abc-123] test");
  });

  it("logs without prefix when correlation id not set", () => {
    const log = new ConsoleLogger();
    log.warn("warn message");
    expect(console.warn).toHaveBeenCalledWith("warn message");
  });

  it("includes meta as JSON when provided", () => {
    const log = new ConsoleLogger();
    log.error("failed", { code: "ERR" });
    expect(console.error).toHaveBeenCalledWith('failed {"code":"ERR"}');
  });
});
