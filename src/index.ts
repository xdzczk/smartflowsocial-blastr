import type {
  ExecutionContext,
  ExportedHandler,
} from "@cloudflare/workers-types";

import { validateEnvironment } from "./config/env";
import { ConsoleLogger } from "./logger";
import {
  addCorsHeaders,
  getCorsConfig,
  handleCorsPreflight,
} from "./middleware/cors";
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

/** Return 401 if API_TOKEN is set and request does not provide it. */
function checkApiToken(request: Request, env: Env): Response | null {
  if (!env.API_TOKEN) return null;
  const authHeader = request.headers.get("Authorization");
  const auth =
    authHeader?.startsWith("Bearer ") === true
      ? authHeader.slice(7)
      : request.headers.get("X-API-TOKEN");
  if (auth !== env.API_TOKEN) {
    return new Response(
      JSON.stringify({ error: "Unauthorized", code: "unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }
  return null;
}

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

    if (url.pathname === "/" && request.method === "GET") {
      const accept = request.headers.get("Accept") ?? "";
      const wantsNostrJson =
        accept === MIME_NOSTR_JSON ||
        accept.includes(MIME_NOSTR_JSON) ||
        accept === "*/*";
      const nip11 = {
        name: "Blastr",
        description: "SFS Broadcast Relay - write-focused managed relay",
        supported_nips: [1, 11, 15, 20],
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

    // WebSocket upgrade (Nostr relay): path / or /ws (require API_TOKEN when set)
    const upgradeHeader = request.headers.get("Upgrade");
    if (
      (url.pathname === "/" || url.pathname === "/ws") &&
      upgradeHeader === "websocket"
    ) {
      const tokenFailure = checkApiToken(request, env);
      if (tokenFailure) return tokenFailure;
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.accept();
      handleWebSocketRelay(server, env, logger);
      return new Response(null, { status: 101, webSocket: client });
    }

    // /event: CORS preflight (OPTIONS) and POST (require API_TOKEN when set for POST)
    if (url.pathname === "/event") {
      const corsConfig = getCorsConfig(env);
      const preflight = handleCorsPreflight(request, corsConfig);
      if (preflight) return addCorsHeaders(request, preflight, corsConfig);
      if (request.method === "POST") {
        const tokenFailure = checkApiToken(request, env);
        if (tokenFailure) return tokenFailure;
        const response = await publishHandler(request, env, logger);
        return addCorsHeaders(request, response, corsConfig);
      }
    }

    // Admin: require API_TOKEN when set
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "admin") {
      const authFailure = requireAdminAuth(request, env);
      if (authFailure) return authFailure;

      if (
        segments[1] === "entitlements" &&
        segments[2] &&
        segments.length === 3
      ) {
        const pubkey = decodeURIComponent(segments[2]);
        if (request.method === "PUT")
          return putEntitlement(request, env, pubkey);
      }

      if (segments[1] === "users" && segments[2]) {
        const pubkey = decodeURIComponent(segments[2]);
        if (segments[3] === "policy" && segments.length === 4) {
          if (request.method === "GET") return getAdminUserPolicy(env, pubkey);
          if (request.method === "PUT")
            return putUserPolicy(request, env, pubkey);
        }
        if (segments[3] === "relays" && segments.length === 4) {
          if (request.method === "POST")
            return postPolicyRelay(request, env, pubkey);
          if (request.method === "DELETE") {
            const relayUrl = url.searchParams.get("relay_url");
            if (relayUrl) return deletePolicyRelay(env, pubkey, relayUrl);
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
    for (const msg of batch.messages) {
      try {
        await processQueueMessage(msg.body, env, logger);
        msg.ack();
      } catch (err) {
        logger.error("Fanout failed", { jobId: msg.body.jobId, error: err });
        // Do not ack: un-acked messages will be retried by the queue
      }
    }
  },
};

export default handler;
