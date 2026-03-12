import { REJECTION_MESSAGES } from "../config/env";
import { validateEvent } from "../core/EventValidator";
import {
  resolveEffectiveRelays,
  toUserPolicyInput,
} from "../core/policy/resolve";
import { loadSystemRelayUniverse } from "../core/relay-catalog";
import { BlastrError, ErrorCodes } from "../errors";
import type { Logger } from "../logger";
import {
  getEntitlement,
  getJobByEventId,
  getPolicyRelays,
  getUserPolicy,
} from "../services/db";
import { isPublished, markPublished } from "../services/dedupe";
import { createJob } from "../services/jobs";
import { checkRateLimit } from "../services/rate-limit";
import type { Env, PublishJobMessage, PublishJobSource } from "../types";

export interface PipelineResultOk {
  ok: true;
  jobId: number;
  eventId: string;
}

export interface PipelineResultReject {
  ok: false;
  error: BlastrError;
}

export type PipelineResult = PipelineResultOk | PipelineResultReject;

export async function runIngressPipeline(
  env: Env,
  rawEvent: unknown,
  source: PublishJobSource,
  logger: Logger,
): Promise<PipelineResult> {
  const validation = validateEvent(rawEvent);
  if (!validation.ok) return { ok: false, error: validation.error };
  const event = validation.event;

  const entitlement = await getEntitlement(env.DB, event.pubkey);
  if (!entitlement) {
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

  const systemRelays = await loadSystemRelayUniverse(env.DB);
  const policyRow = await getUserPolicy(env.DB, event.pubkey);
  const relayRows = await getPolicyRelays(env.DB, event.pubkey);
  const userPolicy = toUserPolicyInput(policyRow, relayRows);
  const resolvedRelays = resolveEffectiveRelays(systemRelays, userPolicy);

  if (resolvedRelays.length === 0) {
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

  const existingJob = await getJobByEventId(env.DB, event.id);
  if (existingJob) {
    logger.info("Event already has job (idempotent)", {
      eventId: event.id,
      jobId: existingJob.id,
    });
    return { ok: true, jobId: existingJob.id, eventId: event.id };
  }

  const jobId = await createJob(env.DB, {
    eventId: event.id,
    pubkey: event.pubkey,
    source,
    resolvedRelays,
  });

  const message: PublishJobMessage = {
    jobId: String(jobId),
    event,
    pubkey: event.pubkey,
    resolvedRelays,
    source,
    receivedAt: Date.now(),
  };
  await env.BLASTR_PUBLISH_QUEUE.send(message);

  await markPublished(event.id, env.PUBLISHED_NOTES);

  logger.info("Event accepted and queued", {
    eventId: event.id,
    jobId,
    relayCount: resolvedRelays.length,
  });
  return { ok: true, jobId, eventId: event.id };
}
