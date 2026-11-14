import type { Env } from "../types";

function validateNumericEnv(
  value: string | undefined,
  name: string,
  defaultValue: string,
  logger: { warn: (_: string) => void },
): void {
  if (!value) return;
  const num = parseInt(value, 10);
  if (Number.isNaN(num) || num <= 0) {
    logger.warn(
      `Invalid ${name} value: ${value}. Using default: ${defaultValue}`,
    );
  }
}

/**
 * Validates environment and bindings required for the Worker.
 * @throws Error if required bindings are missing
 */
export function validateEnvironment(
  env: Env,
  logger: { warn: (_: string) => void },
): void {
  // Runtime checks for bindings (Env type assumes they exist; at runtime they may be missing)
  const e = env as Partial<Env>;
  if (!e.PUBLISHED_NOTES) {
    throw new Error(
      "Missing required binding: PUBLISHED_NOTES KV namespace. Run: wrangler kv:namespace create PUBLISHED_NOTES",
    );
  }
  if (!e.BLASTR_RATE_LIMIT) {
    throw new Error(
      "Missing required binding: BLASTR_RATE_LIMIT KV namespace. Run: wrangler kv:namespace create BLASTR_RATE_LIMIT",
    );
  }
  if (!e.DB) {
    throw new Error(
      "Missing required binding: DB (D1 database). Configure [[d1_databases]] in wrangler.toml",
    );
  }
  if (!e.BLASTR_PUBLISH_QUEUE) {
    throw new Error(
      "Missing required binding: BLASTR_PUBLISH_QUEUE. Create queue with: wrangler queues create blastr-publish-jobs",
    );
  }
  if (!env.API_TOKEN?.trim()) {
    logger.warn(
      env.ENVIRONMENT === "production"
        ? "API_TOKEN is not set in production. Admin routes fail closed and reject every request."
        : "API_TOKEN is not set. Admin routes fail closed and reject every request.",
    );
  }
  validateNumericEnv(
    env.RATE_LIMIT_REQUESTS,
    "RATE_LIMIT_REQUESTS",
    "100",
    logger,
  );
  validateNumericEnv(
    env.RATE_LIMIT_WINDOW_MS,
    "RATE_LIMIT_WINDOW_MS",
    "60000",
    logger,
  );
  if (env.CORS_ENABLED === "true" && !env.CORS_ORIGINS) {
    logger.warn(
      "CORS_ENABLED is true but CORS_ORIGINS is not set. CORS will be disabled.",
    );
  }
}

/**
 * Allowed Nostr event kinds:
 * 0 = metadata, 1 = short note, 6 = repost (NIP-18), 30023 = long-form (NIP-23),
 * 4 = legacy DM (NIP-04), 1059 = gift wrap (NIP-59 / NIP-17 DMs),
 * 1068 / 1018 = polls / votes (NIP-88 draft).
 */
export const ALLOWED_KINDS = [0, 1, 4, 6, 1059, 1068, 1018, 30023] as const;

/** Max serialized JSON event size (gift-wrapped DMs can be larger than notes). */
export const MAX_EVENT_SIZE = 96 * 1024;

/** Rejection messages for Nostr OK responses. */
export const REJECTION_MESSAGES = {
  restricted: "restricted: paid SmartFlowSocial subscription required",
  pubkeyNotLinked: "pubkey not entitled / not linked",
  duplicate: "duplicate",
  noRelays: "no relays configured",
  invalidSignature: "invalid signature",
  disallowedKind: "disallowed event kind",
  eventTooLarge: "event too large",
  rateLimitExceeded: "rate limit exceeded",
} as const;
