import type { D1Database, KVNamespace, Queue } from "@cloudflare/workers-types";

export interface Env {
  PUBLISHED_NOTES: KVNamespace;
  DB: D1Database;
  BLASTR_PUBLISH_QUEUE: Queue<PublishJobMessage>;
  API_TOKEN?: string;
  RATE_LIMIT_REQUESTS?: string;
  RATE_LIMIT_WINDOW_MS?: string;
  CORS_ENABLED?: string;
  CORS_ORIGINS?: string;
  ENVIRONMENT?: string;
}

export interface CacheMetadata {
  createdAt: number;
}

/** Message sent to the publish queue (event + job id or full payload). */
export interface PublishJobMessage {
  jobId: string;
  event: SerializedNostrEvent;
  pubkey: string;
  resolvedRelays: string[];
  source: "sfs-app" | "external-client" | "api";
  receivedAt: number;
}

/** Nostr event as serializable object (for queue payload). */
export interface SerializedNostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export type PublishJobStatus =
  | "queued"
  | "processing"
  | "partial"
  | "success"
  | "failed";

export type PublishJobSource = "sfs-app" | "external-client" | "api";

export type UserPolicyMode = "blacklist" | "whitelist";

export type PolicyRelayAction = "allow" | "block";

export type EntitlementStatus = "active" | "grace" | "expired" | "suspended";
