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
import { publishHandler } from "./transport/http/handlers";
import { processQueueMessage } from "./transport/queue";
import type { Env, PublishJobMessage } from "./types";

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
      const accept = request.headers.get("Accept");
      if (accept === "application/nostr+json") {
        return new Response(
          JSON.stringify({
            name: "Blastr",
            description: "SFS Broadcast Relay - write-focused managed relay",
            supported_nips: [1, 11, 15, 20],
          }),
          { headers: { "Content-Type": "application/nostr+json" } },
        );
      }
      return new Response(
        "Blastr relay. Use Nostr client with wss://... or POST /event",
        {
          status: 200,
        },
      );
    }

    if (url.pathname === "/event" && request.method === "POST") {
      const corsConfig = getCorsConfig(env);
      const preflight = handleCorsPreflight(request, corsConfig);
      if (preflight) return addCorsHeaders(request, preflight, corsConfig);
      const response = await publishHandler(request, env, logger);
      return addCorsHeaders(request, response, corsConfig);
    }

    return new Response("Not Found", { status: 404 });
  },

  async queue(
    batch: { messages: readonly { body: PublishJobMessage; ack(): void }[] },
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const logger = new ConsoleLogger();
    for (const msg of batch.messages) {
      try {
        await processQueueMessage(msg.body, env, logger);
      } catch (err) {
        logger.error("Fanout failed", { jobId: msg.body.jobId, error: err });
      }
      msg.ack();
    }
  },
};

export default handler;
