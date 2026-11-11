import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import * as db from "../../src/services/db";
import * as jobs from "../../src/services/jobs";
import { processQueueMessage } from "../../src/transport/queue";
import type { Env, PublishJobMessage } from "../../src/types";

vi.mock("../../src/services/db");
vi.mock("../../src/services/jobs");

type WsListener = (ev?: { data?: string }) => void;

interface MockWSInstance {
  open: WsListener | null;
  message: WsListener | null;
  error: WsListener | null;
  closeListener: WsListener | null;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  emitClose: () => void;
  readyState: number;
  closeCalls: number;
  lastCloseCode?: number;
  lastCloseReason?: string;
  _accept: boolean;
  _replyWithWrongId: boolean;
  _autoReply: boolean;
}

function createMockWebSocket(): {
  instances: MockWSInstance[];
  WebSocket: new (url: string) => InstanceType<typeof globalThis.WebSocket>;
} {
  const instances: MockWSInstance[] = [];
  class MockWS implements MockWSInstance {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    open: WsListener | null = null;
    message: WsListener | null = null;
    error: WsListener | null = null;
    closeListener: WsListener | null = null;
    readyState = MockWS.CONNECTING;
    closeCalls = 0;
    lastCloseCode?: number;
    lastCloseReason?: string;
    _accept = true;
    _replyWithWrongId = false;
    _autoReply = true;

    send = (data: string): void => {
      if (!this._autoReply) return;
      try {
        const arr = JSON.parse(data) as unknown[];
        if (
          arr[0] === "EVENT" &&
          arr[1] &&
          typeof arr[1] === "object" &&
          "id" in arr[1]
        ) {
          const eventId = this._replyWithWrongId
            ? "wrong-id"
            : String((arr[1] as { id: string }).id);
          setImmediate(() => {
            this.message?.({
              data: JSON.stringify(["OK", eventId, this._accept, ""]),
            });
          });
        }
      } catch {
        // ignore
      }
    };

    close = (code?: number, reason?: string): void => {
      this.closeCalls += 1;
      this.lastCloseCode = code;
      this.lastCloseReason = reason;
      this.readyState = MockWS.CLOSED;
    };

    emitClose = (): void => {
      this.closeListener?.();
    };

    addEventListener(ev: string, fn: WsListener): void {
      if (ev === "open") this.open = fn;
      if (ev === "message") this.message = fn;
      if (ev === "error") this.error = fn;
      if (ev === "close") this.closeListener = fn;
    }

    constructor() {
      instances.push(this);
    }
  }
  return {
    instances,
    WebSocket: MockWS as unknown as new (
      url: string,
    ) => InstanceType<typeof globalThis.WebSocket>,
  };
}

const baseMessage: PublishJobMessage = {
  jobId: "1",
  event: {
    id: "e".repeat(64),
    pubkey: "p".repeat(64),
    created_at: Math.floor(Date.now() / 1000),
    kind: 1,
    tags: [],
    content: "",
    sig: "s".repeat(128),
  },
  pubkey: "p".repeat(64),
  resolvedRelays: ["wss://relay.test"],
  source: "external-client",
  receivedAt: Date.now(),
};

function env(): Env {
  return {
    PUBLISHED_NOTES: { get: vi.fn(), put: vi.fn() },
    BLASTR_RATE_LIMIT: { get: vi.fn(), put: vi.fn() },
    DB: {},
    BLASTR_PUBLISH_QUEUE: { send: vi.fn() },
  } as unknown as Env;
}

describe("processQueueMessage with real WebSocket path", () => {
  const logger = {
    warn: vi.fn(),
    getCorrelationId: vi.fn().mockReturnValue(null),
    info: vi.fn(),
    error: vi.fn(),
    setCorrelationId: vi.fn(),
  };
  let OriginalWebSocket: typeof globalThis.WebSocket;
  let mock: ReturnType<typeof createMockWebSocket>;

  beforeEach(() => {
    vi.clearAllMocks();
    OriginalWebSocket = globalThis.WebSocket;
    mock = createMockWebSocket();
    (globalThis as unknown as { WebSocket: typeof mock.WebSocket }).WebSocket =
      mock.WebSocket;

    vi.mocked(db.getJobById).mockResolvedValue({
      id: 1,
      event_id: baseMessage.event.id,
      pubkey: baseMessage.pubkey,
      source: baseMessage.source,
      received_at: Math.floor(baseMessage.receivedAt / 1000),
      status: "queued",
      relay_count_target: 1,
      relay_count_success: 0,
      relay_count_failed: 0,
      resolved_relays: JSON.stringify(baseMessage.resolvedRelays),
    });
    vi.mocked(jobs.updateJobStatus).mockResolvedValue();
    vi.mocked(jobs.createAttempt).mockResolvedValue();
  });

  afterEach(() => {
    vi.useRealTimers();
    (
      globalThis as unknown as { WebSocket: typeof OriginalWebSocket }
    ).WebSocket = OriginalWebSocket;
  });

  it("sends event via WebSocket and completes successfully when mock responds OK", async () => {
    const done = processQueueMessage(baseMessage, env(), logger);

    await new Promise((r) => setImmediate(r));
    expect(mock.instances.length).toBeGreaterThanOrEqual(1);
    const ws = mock.instances[0];
    expect(ws).toBeDefined();
    ws?.open?.();

    await done;

    expect(jobs.updateJobStatus).toHaveBeenLastCalledWith(
      expect.anything(),
      1,
      "success",
      { success: 1, failed: 0 },
    );
    expect(ws?.closeCalls).toBe(1);
    expect(ws?.lastCloseCode).toBe(1000);
    expect(ws?.readyState).toBe(3);
  });

  it("records failed relay when WebSocket triggers error (connection_error)", async () => {
    const done = processQueueMessage(baseMessage, env(), logger);

    const triggerAll = (): void => {
      mock.instances.forEach((ws) => ws.error?.());
    };
    const interval = setInterval(triggerAll, 50);
    await new Promise((r) => setImmediate(r));
    triggerAll();

    await done;
    clearInterval(interval);

    expect(jobs.updateJobStatus).toHaveBeenLastCalledWith(
      expect.anything(),
      1,
      "failed",
      { success: 0, failed: 1 },
    );
  }, 15000);

  it("records failed relay when relay responds OK with accepted false", async () => {
    const done = processQueueMessage(baseMessage, env(), logger);

    const triggerOpenAllReject = (): void => {
      mock.instances.forEach((ws) => {
        ws._accept = false;
        ws.open?.();
      });
    };
    const interval = setInterval(triggerOpenAllReject, 50);
    await new Promise((r) => setImmediate(r));
    triggerOpenAllReject();

    await done;
    clearInterval(interval);

    expect(jobs.updateJobStatus).toHaveBeenLastCalledWith(
      expect.anything(),
      1,
      "failed",
      { success: 0, failed: 1 },
    );
  }, 15000);

  it("does not resolve from message when OK has wrong event id (parse branch)", async () => {
    const done = processQueueMessage(baseMessage, env(), logger);
    const triggerCloseAll = (): void => {
      mock.instances.forEach((ws) => {
        ws._replyWithWrongId = true;
        ws.open?.();
        ws.emitClose();
      });
    };
    const interval = setInterval(triggerCloseAll, 50);
    await new Promise((r) => setImmediate(r));
    triggerCloseAll();
    await done;
    clearInterval(interval);
    expect(jobs.updateJobStatus).toHaveBeenLastCalledWith(
      expect.anything(),
      1,
      "failed",
      { success: 0, failed: 1 },
    );
  }, 15000);

  it("records failed when WebSocket constructor throws (catch branch)", async () => {
    const OriginalWS = (
      globalThis as unknown as { WebSocket: typeof mock.WebSocket }
    ).WebSocket;
    (globalThis as unknown as { WebSocket: typeof OriginalWS }).WebSocket =
      class {
        constructor() {
          throw new Error("mock connection refused");
        }
      } as unknown as typeof globalThis.WebSocket;

    const done = processQueueMessage(baseMessage, env(), logger);
    await done;

    (globalThis as unknown as { WebSocket: typeof OriginalWS }).WebSocket =
      OriginalWS;

    expect(jobs.updateJobStatus).toHaveBeenLastCalledWith(
      expect.anything(),
      1,
      "failed",
      { success: 0, failed: 1 },
    );
  }, 15000);

  it("records failed relay when WebSocket triggers close without OK (closed)", async () => {
    const done = processQueueMessage(baseMessage, env(), logger);

    const triggerAll = (): void => {
      mock.instances.forEach((ws) => ws.emitClose());
    };
    const interval = setInterval(triggerAll, 50);
    await new Promise((r) => setImmediate(r));
    triggerAll();

    await done;
    clearInterval(interval);

    expect(jobs.updateJobStatus).toHaveBeenLastCalledWith(
      expect.anything(),
      1,
      "failed",
      { success: 0, failed: 1 },
    );
  }, 15000);

  it("closes the socket when the relay never answers", async () => {
    vi.useFakeTimers();
    const done = processQueueMessage(baseMessage, env(), logger);

    await vi.advanceTimersByTimeAsync(16_500);
    await done;

    expect(jobs.createAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "failed",
        errorCode: "timeout",
        attemptNumber: 3,
      }),
    );
    expect(mock.instances).toHaveLength(3);
    expect(
      mock.instances.every(
        (ws) => ws.closeCalls === 1 && ws.lastCloseCode === 1000,
      ),
    ).toBe(true);
    expect(jobs.updateJobStatus).toHaveBeenLastCalledWith(
      expect.anything(),
      1,
      "failed",
      { success: 0, failed: 1 },
    );
  });
});
