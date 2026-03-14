import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  rejectReasonFromErrorCode,
  recordEventsAccepted,
  recordEventsRejected,
  recordFanoutSuccess,
  recordFanoutFailed,
  recordQueueMessageAcked,
  recordQueueMessageRetried,
  recordIngressLatencyMs,
  recordFanoutLatencyMs,
} from "../../src/observability/metrics";

describe("metrics", () => {
  let consoleSpy: { mockRestore: () => void; mock: { calls: unknown[][] } };

  beforeEach(() => {
    consoleSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => {}) as unknown as {
      mockRestore: () => void;
      mock: { calls: unknown[][] };
    };
  });

  afterEach(() => {
    (consoleSpy as { mockRestore: () => void }).mockRestore();
  });

  describe("rejectReasonFromErrorCode", () => {
    it.each([
      ["not_entitled", "not_entitled"],
      ["rate_limit_exceeded", "rate_limit"],
      ["duplicate", "duplicate"],
      ["no_relays_configured", "no_relays"],
    ] as const)('maps "%s" to "%s"', (code, reason) => {
      expect(rejectReasonFromErrorCode(code)).toBe(reason);
    });

    it("returns validation_error for unknown code", () => {
      expect(rejectReasonFromErrorCode("unknown")).toBe("validation_error");
      expect(rejectReasonFromErrorCode("")).toBe("validation_error");
    });
  });

  describe("record events", () => {
    it("recordEventsAccepted emits metric", () => {
      recordEventsAccepted();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[metric]"),
      );
      const firstCall = consoleSpy.mock.calls[0];
      expect(firstCall).toBeDefined();
      expect(firstCall?.[0]).toContain("events_accepted");
    });

    it("recordEventsRejected emits with reason", () => {
      recordEventsRejected("rate_limit");
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/events_rejected.*rate_limit/),
      );
    });

    it("recordFanoutSuccess emits", () => {
      recordFanoutSuccess();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("fanout_success"),
      );
    });

    it("recordFanoutFailed emits", () => {
      recordFanoutFailed();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("fanout_failed"),
      );
    });

    it("recordQueueMessageAcked emits", () => {
      recordQueueMessageAcked();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("queue_message_acked"),
      );
    });

    it("recordQueueMessageRetried emits", () => {
      recordQueueMessageRetried();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("queue_message_retried"),
      );
    });

    it("recordIngressLatencyMs emits histogram", () => {
      recordIngressLatencyMs(42);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/ingress_latency_ms.*42/),
      );
    });

    it("recordFanoutLatencyMs emits histogram", () => {
      recordFanoutLatencyMs(100);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/fanout_latency_ms.*100/),
      );
    });
  });
});
