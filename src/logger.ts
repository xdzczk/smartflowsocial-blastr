export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export class ConsoleLogger implements Logger {
  private correlationId: string | null = null;

  setCorrelationId(id: string): void {
    this.correlationId = id;
  }

  private prefix(): string {
    return this.correlationId ? `[${this.correlationId}] ` : "";
  }

  info(message: string, meta?: Record<string, unknown>): void {
    const payload = meta ? ` ${JSON.stringify(meta)}` : "";
    console.info(this.prefix() + message + payload);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    const payload = meta ? ` ${JSON.stringify(meta)}` : "";
    console.warn(this.prefix() + message + payload);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    const payload = meta ? ` ${JSON.stringify(meta)}` : "";
    console.error(this.prefix() + message + payload);
  }
}
