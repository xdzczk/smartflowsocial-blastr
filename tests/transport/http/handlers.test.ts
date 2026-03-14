import { describe, it, expect, vi, beforeEach } from "vitest";

import { BlastrError } from "../../../src/errors";
import {
  nip11Handler,
  publishHandler,
} from "../../../src/transport/http/handlers";
import * as pipeline from "../../../src/transport/pipeline";
import type { Env } from "../../../src/types";

vi.mock("../../../src/transport/pipeline");

function mockEnv(): Env {
  return {
    PUBLISHED_NOTES: { get: vi.fn(), put: vi.fn() },
    BLASTR_RATE_LIMIT: { get: vi.fn(), put: vi.fn() },
    DB: {},
    BLASTR_PUBLISH_QUEUE: { send: vi.fn() },
  } as unknown as Env;
}

describe("handlers", () => {
  describe("nip11Handler", () => {
    it("returns 200 with application/nostr+json and NIP-11 document", async () => {
      const res = nip11Handler();
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/nostr+json");
      const json = await res.json();
      expect(json).toHaveProperty("name", "Blastr");
      expect(json).toHaveProperty("supported_nips", [1, 11, 15, 20]);
    });
  });

  describe("publishHandler", () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setCorrelationId: vi.fn(),
      getCorrelationId: vi.fn().mockReturnValue(null),
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("uses body as eventPayload when not EVENT array and returns JSON error when no event id", async () => {
      vi.mocked(pipeline.runIngressPipeline).mockResolvedValue({
        ok: false,
        error: new BlastrError("invalid", "validation_error", { status: 400 }),
      });
      const req = new Request("http://localhost/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notAnEvent: true }),
      });
      const res = await publishHandler(req, mockEnv(), logger);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toHaveProperty("error", "invalid");
      expect(json).toHaveProperty("code", "validation_error");
    });
  });
});
