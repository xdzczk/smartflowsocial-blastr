export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Build a single structured log object for aggregation (level, correlationId, message, ...meta). */
function structuredPayload(
  level: string,
  message: string,
  correlationId: string | null,
  meta?: Record<string, unknown>,
): string {
  const payload: Record<string, unknown> = {
    level,
    message,
    ...(correlationId && { correlationId }),
    ...meta,
  };
  const err = payload["error"];
  if (err && err instanceof Error) {
    payload["error"] = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return JSON.stringify(payload);
}

export class ConsoleLogger implements Logger {
  private correlationId: string | null = null;

  setCorrelationId(id: string): void {
    this.correlationId = id;
  }

  info(message: string, meta?: Record<string, unknown>): void {
    console.info(structuredPayload("info", message, this.correlationId, meta));
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(structuredPayload("warn", message, this.correlationId, meta));
  }

  error(message: string, meta?: Record<string, unknown>): void {
    console.error(
      structuredPayload("error", message, this.correlationId, meta),
    );
  }
}
