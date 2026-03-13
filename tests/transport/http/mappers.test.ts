import { describe, it, expect } from "vitest";

import { BlastrError } from "../../../src/errors";
import {
  toNostrOk,
  mapErrorToNostrMessage,
  mapErrorToResponse,
  createResponseHeaders,
} from "../../../src/transport/http/mappers";

describe("mappers", () => {
  describe("toNostrOk", () => {
    it("returns OK message JSON string", () => {
      expect(toNostrOk("ev1", true, "")).toBe(
        JSON.stringify(["OK", "ev1", true, ""]),
      );
      expect(toNostrOk("ev2", false, "rejected")).toBe(
        JSON.stringify(["OK", "ev2", false, "rejected"]),
      );
    });
  });

  describe("mapErrorToNostrMessage", () => {
    it("returns OK with accepted false and error message", () => {
      const err = new BlastrError("not entitled", "not_entitled", {
        status: 403,
      });
      expect(mapErrorToNostrMessage("ev1", err)).toBe(
        JSON.stringify(["OK", "ev1", false, "not entitled"]),
      );
    });
  });

  describe("mapErrorToResponse", () => {
    it("returns BlastrError response with error code and status", () => {
      const err = new BlastrError("forbidden", "not_entitled", {
        status: 403,
      });
      const out = mapErrorToResponse(err);
      expect(out).toEqual({
        response: { error: "forbidden", code: "not_entitled" },
        status: 403,
      });
    });

    it("returns internal_error 500 for non-BlastrError", () => {
      const out = mapErrorToResponse(new Error("boom"));
      expect(out).toEqual({
        response: { error: "boom", code: "internal_error" },
        status: 500,
      });
    });

    it("handles non-Error throwables", () => {
      const out = mapErrorToResponse("string error");
      expect(out.response["code"]).toBe("internal_error");
      expect(out.response["error"]).toBe("string error");
      expect(out.status).toBe(500);
    });
  });

  describe("createResponseHeaders", () => {
    it("sets X-Request-ID and X-Response-Time", () => {
      const start = Date.now();
      const h = createResponseHeaders("corr-1", start);
      expect(h.get("X-Request-ID")).toBe("corr-1");
      expect(h.get("X-Response-Time")).toBeDefined();
    });

    it("merges extra headers when provided", () => {
      const h = createResponseHeaders("c", 0, {
        "Content-Type": "application/json",
      });
      expect(h.get("X-Request-ID")).toBe("c");
      expect(h.get("Content-Type")).toBe("application/json");
    });
  });
});
