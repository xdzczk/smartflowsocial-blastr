import type {
  ExecutionContext,
  ExportedHandler,
} from "@cloudflare/workers-types";

import { validateEnvironment } from "./config/env";
import { checkReadiness } from "./health";
import { ConsoleLogger } from "./logger";
import {
  addCorsHeaders,
  getCorsConfig,
  handleCorsPreflight,
} from "./middleware/cors";
import { auditLog } from "./observability/audit";
import {
  recordQueueMessageAcked,
  recordQueueMessageRetried,
} from "./observability/metrics";
import { checkAdminRateLimit } from "./services/rate-limit";
import {
  requireAdminAuth,
  putEntitlement,
  putUserPolicy,
  getAdminUserPolicy,
  postPolicyRelay,
  deletePolicyRelay,
} from "./transport/http/admin";
import { publishHandler } from "./transport/http/handlers";
import { processQueueMessage } from "./transport/queue";
import { handleWebSocketRelay } from "./transport/ws/relay";
import type { Env, PublishJobMessage } from "./types";

const MIME_NOSTR_JSON = "application/nostr+json";

function extractCorrelationId(request: Request): string {
  const headerId =
    request.headers.get("X-Correlation-ID") ??
    request.headers.get("X-Request-ID") ??
    request.headers.get("Correlation-ID") ??
    null;
  if (headerId) return headerId;
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const handler: ExportedHandler<Env, PublishJobMessage> = {
  /* eslint-disable sonarjs/cognitive-complexity -- route dispatch is inherently branching */
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const logger = new ConsoleLogger();
    const correlationId = extractCorrelationId(request);
    logger.setCorrelationId(correlationId);

    try {
      validateEnvironment(env, logger);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Environment validation failed: ${message}`, { error });
      return new Response(
        JSON.stringify({
          error: "Server configuration error",
          code: "CONFIGURATION_ERROR",
          details: { message },
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return new Response(
        JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.pathname === "/ready" && request.method === "GET") {
      const readiness = await checkReadiness(env);
      const status = readiness.ok ? 200 : 503;
      return new Response(
        JSON.stringify({
          status: readiness.ok ? "ok" : "degraded",
          checks: readiness.checks,
          timestamp: new Date().toISOString(),
        }),
        {
          status,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // WebSocket upgrade (Nostr relay): path / or /ws (no token; entitlement in pipeline)
    // Must be checked before GET / so Upgrade: websocket gets 101, not 200 + body
    const upgradeHeader = request.headers.get("Upgrade");
    if (
      (url.pathname === "/" || url.pathname === "/ws") &&
      upgradeHeader === "websocket"
    ) {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.accept();
      handleWebSocketRelay(server, env, logger, _ctx);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/" && request.method === "GET") {
      const accept = request.headers.get("Accept") ?? "";
      const wantsNostrJson =
        accept === MIME_NOSTR_JSON ||
        accept.includes(MIME_NOSTR_JSON) ||
        accept === "*/*";
      const nip11 = {
        name: "Blastr",
        description: "SFS Broadcast Relay - write-focused managed relay",
        supported_nips: [1, 11, 15, 18, 20, 23],
        limitation: { write: true, read: false },
      };
      if (wantsNostrJson) {
        return new Response(JSON.stringify(nip11), {
          headers: { "Content-Type": MIME_NOSTR_JSON },
        });
      }
      return new Response(
        "Blastr relay. Use Nostr client with wss://... or POST /event",
        { status: 200 },
      );
    }

    // /event: CORS preflight (OPTIONS) and POST (no token; entitlement in pipeline)
    if (url.pathname === "/event") {
      const corsConfig = getCorsConfig(env);
      const preflight = handleCorsPreflight(request, corsConfig);
      if (preflight) return addCorsHeaders(request, preflight, corsConfig);
      if (request.method === "POST") {
        const response = await publishHandler(request, env, logger);
        return addCorsHeaders(request, response, corsConfig);
      }
    }

    // Admin: require API_TOKEN when set, rate limit, then dispatch
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "admin") {
      const authFailure = requireAdminAuth(request, env);
      if (authFailure) return authFailure;

      const adminRate = await checkAdminRateLimit(request, env);
      /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive when mock returns undefined */
      if (adminRate && !adminRate.allowed) {
        return new Response(
          JSON.stringify({
            error: "Too Many Requests",
            code: "rate_limit_exceeded",
            retry_after: adminRate.retryAfter,
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              ...(adminRate.retryAfter != null && {
                "Retry-After": String(adminRate.retryAfter),
              }),
            },
          },
        );
      }

      if (
        segments[1] === "entitlements" &&
        segments[2] &&
        segments.length === 3
      ) {
        const pubkey = decodeURIComponent(segments[2]);
        if (request.method === "PUT") {
          const res = await putEntitlement(request, env, pubkey);
          if (res.status === 200)
            auditLog(request, "entitlement.upsert", { pubkey });
          return res;
        }
      }

      if (segments[1] === "users" && segments[2]) {
        const pubkey = decodeURIComponent(segments[2]);
        if (segments[3] === "policy" && segments.length === 4) {
          if (request.method === "GET") return getAdminUserPolicy(env, pubkey);
          if (request.method === "PUT") {
            const res = await putUserPolicy(request, env, pubkey);
            if (res.status === 200)
              auditLog(request, "user_policy.upsert", { pubkey });
            return res;
          }
        }
        if (segments[3] === "relays" && segments.length === 4) {
          if (request.method === "POST") {
            const res = await postPolicyRelay(request, env, pubkey);
            if (res.status === 200) {
              const body = await res.clone().json();
              const relayUrl =
                body && typeof body === "object" && "relay_url" in body
                  ? String((body as { relay_url: unknown }).relay_url)
                  : undefined;
              auditLog(request, "policy_relay.add", {
                pubkey,
                relay_url: relayUrl,
              });
            }
            return res;
          }
          if (request.method === "DELETE") {
            const relayUrl = url.searchParams.get("relay_url");
            if (relayUrl) {
              const res = await deletePolicyRelay(env, pubkey, relayUrl);
              if (res.status === 200)
                auditLog(request, "policy_relay.remove", {
                  pubkey,
                  relay_url: relayUrl,
                });
              return res;
            }
          }
        }
      }
    }

    return new Response("Not Found", { status: 404 });
  },
  /* eslint-enable sonarjs/cognitive-complexity */

  async queue(
    batch: { messages: readonly { body: PublishJobMessage; ack(): void }[] },
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const logger = new ConsoleLogger();
    logger.info("Queue batch received", {
      messageCount: batch.messages.length,
      jobIds: batch.messages.map((m) => m.body.jobId),
    });
    for (const msg of batch.messages) {
      const correlationId = msg.body.correlationId ?? `job-${msg.body.jobId}`;
      logger.setCorrelationId(correlationId);
      try {
        await processQueueMessage(msg.body, env, logger);
        recordQueueMessageAcked();
        msg.ack();
      } catch (err) {
        recordQueueMessageRetried();
        logger.error("Fanout failed", { jobId: msg.body.jobId, error: err });
        // Poison event: after max retries Cloudflare Queues may drop or DLQ; log for operators
        logger.info("Poison message", {
          poison: true,
          jobId: msg.body.jobId,
          eventId: msg.body.event.id,
          error: err instanceof Error ? err.message : String(err),
        });
        // Do not ack: un-acked messages will be retried by the queue
      }
    }
  },
};

export default handler;
