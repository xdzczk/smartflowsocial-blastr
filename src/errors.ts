export class BlastrError extends Error {
  code: string;
  status: number;
  retryAfter?: number;

  constructor(
    message: string,
    code: string,
    options?: { status?: number; retryAfter?: number },
  ) {
    super(message);
    this.name = "BlastrError";
    this.code = code;
    this.status = options?.status ?? 400;
    this.retryAfter = options?.retryAfter;
    Object.setPrototypeOf(this, BlastrError.prototype);
  }
}

export const ErrorCodes = {
  INVALID_SIGNATURE: "invalid_signature",
  DISALLOWED_KIND: "disallowed_kind",
  EVENT_TOO_LARGE: "event_too_large",
  NOT_ENTITLED: "not_entitled",
  RATE_LIMIT_EXCEEDED: "rate_limit_exceeded",
  DUPLICATE_EVENT: "duplicate",
  NO_RELAYS_CONFIGURED: "no_relays_configured",
  CONFIGURATION_ERROR: "configuration_error",
} as const;
