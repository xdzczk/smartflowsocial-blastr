/**
 * Metric events emitted as structured JSON log lines.
 * Log pipelines can aggregate by name and tags (e.g. reason).
 * Optional: wire to Cloudflare Workers Analytics Engine when available.
 */

export type CounterName =
  | "events_accepted"
  | "events_rejected"
  | "fanout_success"
  | "fanout_failed"
  | "queue_message_acked"
  | "queue_message_retried";

export type RejectReason =
  | "not_entitled"
  | "rate_limit"
  | "duplicate"
  | "no_relays"
  | "validation_error";

const METRIC_LOG_PREFIX = "[metric]";

function emit(payload: Record<string, unknown>): void {
  const line = JSON.stringify({ ...payload, "@metric": true });
  console.info(`${METRIC_LOG_PREFIX} ${line}`);
}

/** Map BlastrError code to events_rejected reason. */
export function rejectReasonFromErrorCode(code: string): RejectReason {
  switch (code) {
    case "not_entitled":
      return "not_entitled";
    case "rate_limit_exceeded":
      return "rate_limit";
    case "duplicate":
      return "duplicate";
    case "no_relays_configured":
      return "no_relays";
    default:
      return "validation_error";
  }
}

export function recordEventsAccepted(): void {
  emit({ name: "events_accepted", type: "counter", value: 1 });
}

export function recordEventsRejected(reason: RejectReason): void {
  emit({ name: "events_rejected", type: "counter", value: 1, reason });
}

export function recordFanoutSuccess(): void {
  emit({ name: "fanout_success", type: "counter", value: 1 });
}

export function recordFanoutFailed(): void {
  emit({ name: "fanout_failed", type: "counter", value: 1 });
}

export function recordQueueMessageAcked(): void {
  emit({ name: "queue_message_acked", type: "counter", value: 1 });
}

export function recordQueueMessageRetried(): void {
  emit({ name: "queue_message_retried", type: "counter", value: 1 });
}

export function recordIngressLatencyMs(ms: number): void {
  emit({ name: "ingress_latency_ms", type: "histogram", value: ms });
}

export function recordFanoutLatencyMs(ms: number): void {
  emit({ name: "fanout_latency_ms", type: "histogram", value: ms });
}
