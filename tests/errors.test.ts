import { describe, it, expect } from "vitest";

import { BlastrError } from "../src/errors";

describe("BlastrError", () => {
  it("sets message, code, and default status 400", () => {
    const err = new BlastrError("bad", "bad_code");
    expect(err.message).toBe("bad");
    expect(err.code).toBe("bad_code");
    expect(err.status).toBe(400);
    expect(err.name).toBe("BlastrError");
  });

  it("uses options.status when provided", () => {
    const err = new BlastrError("forbidden", "not_entitled", { status: 403 });
    expect(err.status).toBe(403);
  });

  it("sets retryAfter when provided in options", () => {
    const err = new BlastrError("slow down", "rate_limit", {
      status: 429,
      retryAfter: 60,
    });
    expect(err.retryAfter).toBe(60);
    expect(err.status).toBe(429);
  });
});
