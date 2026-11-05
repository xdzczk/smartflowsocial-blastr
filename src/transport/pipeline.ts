import { REJECTION_MESSAGES } from "../config/env";
import { validateEvent } from "../core/EventValidator";
import {
  resolveEffectiveRelays,
  toUserPolicyInput,
} from "../core/policy/resolve";
import { loadSystemRelayUniverse } from "../core/relay-catalog";
import { BlastrError, ErrorCodes } from "../errors";
import type { Logger } from "../logger";
import { getEntitlement, getPolicyRelays, getUserPolicy } from "../services/db";
import { isPublished, markPublished } from "../services/dedupe";
import { ensureJob } from "../services/jobs";
import { checkRateLimit } from "../services/rate-limit";
import type {
  Env,
  PublishJobMessage,
  PublishJobSource,
  SerializedNostrEvent,
} from "../types";

export interface PipelineResultOk {
  ok: true;
  jobId: number;
  eventId: string;
  /** Set when deferEnqueue: true; caller must run runEnqueue(env, logger, this) via ctx.waitUntil. */
  enqueuePayload?: EnqueuePayload;
}

export interface PipelineResultReject {
  ok: false;
  error: BlastrError;
}

export type PipelineResult = PipelineResultOk | PipelineResultReject;

/** Payload to enqueue after sending OK to client (used with ctx.waitUntil to avoid runtime "hung" timeout). */
export interface EnqueuePayload {
  event: SerializedNostrEvent;
  resolvedRelays: string[];
  source: PublishJobSource;
}

export async function runIngressPipeline(
  env: Env,
  rawEvent: unknown,
  source: PublishJobSource,
  logger: Logger,
  options?: { deferEnqueue?: boolean },
): Promise<PipelineResult> {
  const deferEnqueue = options?.deferEnqueue === true;
  const validation = validateEvent(rawEvent);
  if (!validation.ok) {
    logger.warn("Ingress rejected: validation failed", {
      message: validation.error.message,
    });
    return { ok: false, error: validation.error };
  }
  const event = validation.event;

  const entitlement = await getEntitlement(env.DB, event.pubkey);
  if (!entitlement) {
    logger.warn("Ingress rejected: pubkey not entitled", {
      eventId: event.id,
      pubkeyPrefix: event.pubkey.slice(0, 16),
    });
    return {
      ok: false,
      error: new BlastrError(
        REJECTION_MESSAGES.restricted,
        ErrorCodes.NOT_ENTITLED,
        {
          status: 403,
        },
      ),
    };
  }

  const rateLimit = await checkRateLimit(event.pubkey, env, {
    rateLimitProfile: entitlement.rate_limit_profile,
  });
  if (!rateLimit.allowed) {
    logger.warn("Ingress rejected: rate limit exceeded", {
      eventId: event.id,
      pubkeyPrefix: event.pubkey.slice(0, 16),
    });
    return {
      ok: false,
      error: new BlastrError(
        REJECTION_MESSAGES.rateLimitExceeded,
        ErrorCodes.RATE_LIMIT_EXCEEDED,
        {
          status: 429,
          retryAfter: rateLimit.retryAfter,
        },
      ),
    };
  }

  const published = await isPublished(event.id, env.PUBLISHED_NOTES);
  if (published) {
    logger.info("Ingress rejected: duplicate event", { eventId: event.id });
    return {
      ok: false,
      error: new BlastrError(
        REJECTION_MESSAGES.duplicate,
        ErrorCodes.DUPLICATE_EVENT,
        {
          status: 409,
        },
      ),
    };
  }

  const [systemRelays, policyRow, relayRows] = await Promise.all([
    loadSystemRelayUniverse(env.DB),
    getUserPolicy(env.DB, event.pubkey),
    getPolicyRelays(env.DB, event.pubkey),
  ]);
  const userPolicy = toUserPolicyInput(policyRow, relayRows);
  const resolvedRelays = resolveEffectiveRelays(systemRelays, userPolicy);

  if (resolvedRelays.length === 0) {
    logger.warn("Ingress rejected: no relays configured", {
      eventId: event.id,
      pubkeyPrefix: event.pubkey.slice(0, 16),
    });
    return {
      ok: false,
      error: new BlastrError(
        REJECTION_MESSAGES.noRelays,
        ErrorCodes.NO_RELAYS_CONFIGURED,
        {
          status: 400,
        },
      ),
    };
  }

  if (deferEnqueue) {
    return {
      ok: true,
      jobId: 0,
      eventId: event.id,
      enqueuePayload: { event, resolvedRelays, source },
    };
  }

  const { jobId, inserted } = await ensureJob(env.DB, {
    eventId: event.id,
    pubkey: event.pubkey,
    source,
    resolvedRelays,
  });

  if (!inserted) {
    logger.info("Event already has job (idempotent)", {
      eventId: event.id,
      jobId,
    });
    return { ok: true, jobId, eventId: event.id };
  }

  const correlationId = logger.getCorrelationId() ?? undefined;
  const message: PublishJobMessage = {
    jobId: String(jobId),
    event,
    pubkey: event.pubkey,
    resolvedRelays,
    source,
    receivedAt: Date.now(),
    ...(correlationId && { correlationId }),
  };
  await env.BLASTR_PUBLISH_QUEUE.send(message);

  // Don't block the response on KV write; respond to client immediately to avoid runtime "hung" timeout
  void (async () => {
    try {
      await markPublished(event.id, env.PUBLISHED_NOTES);
    } catch {
      /* best-effort dedupe; queue consumer will still process */
    }
  })();

  logger.info("Event accepted and queued", {
    eventId: event.id,
    jobId,
    relayCount: resolvedRelays.length,
  });
  return { ok: true, jobId, eventId: event.id };
}

/**
 * Run ensureJob, queue.send, markPublished. Use with ctx.waitUntil() after sending OK to client
 * so the runtime keeps the request alive and we avoid "hung" timeout.
 */
export async function runEnqueue(
  env: Env,
  logger: Logger,
  payload: EnqueuePayload,
): Promise<void> {
  const { event, resolvedRelays, source } = payload;
  const correlationId = logger.getCorrelationId() ?? undefined;
  const { jobId, inserted } = await ensureJob(env.DB, {
    eventId: event.id,
    pubkey: event.pubkey,
    source,
    resolvedRelays,
  });
  if (!inserted) {
    logger.info("Event already has job (idempotent)", {
      eventId: event.id,
      jobId,
    });
    return;
  }
  const message: PublishJobMessage = {
    jobId: String(jobId),
    event,
    pubkey: event.pubkey,
    resolvedRelays,
    source,
    receivedAt: Date.now(),
    ...(correlationId && { correlationId }),
  };
  await env.BLASTR_PUBLISH_QUEUE.send(message);
  await markPublished(event.id, env.PUBLISHED_NOTES);
  logger.info("Event accepted and queued", {
    eventId: event.id,
    jobId,
    relayCount: resolvedRelays.length,
  });
}
