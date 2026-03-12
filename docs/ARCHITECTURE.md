# Blastr architecture

This document describes the high-level architecture, data flow, and main components of Blastr.

## Overview

Blastr is a **write-only** managed Nostr relay that:

1. Accepts Nostr events via WebSocket (Nostr relay protocol) or HTTP `POST /event`.
2. Authorizes and gates access by **pubkey** (entitlement + user relay policy).
3. Resolves the set of downstream relays per pubkey from a bounded **system relay universe**.
4. Enqueues a publish job with the event and the **snapshotted** relay list.
5. Consumes the queue and fans out the event to each relay, recording attempts.

Behavior is entirely determined by the **event author’s pubkey**, not by client or session.

---

## Components

### Worker entry (`src/index.ts`)

- **`fetch`** — Routes requests:
  - `GET /health` → health JSON
  - `GET /` → NIP-11 (if `Accept: application/nostr+json`) or plain text
  - WebSocket upgrade on `/` or `/ws` → Nostr WebSocket relay
  - `POST /event` → publish handler (ingress pipeline)
  - `/admin/*` → admin API (entitlements, user policy, policy relays)
- **`queue`** — Consumes messages from `blastr-publish-jobs`; for each message, runs fanout and acks or leaves for retry.

### Ingress pipeline (`src/transport/pipeline.ts`)

For each incoming event:

1. **Validate** — JSON, event shape, Nostr signature; reject disallowed kinds or oversized events.
2. **Entitlement** — Look up `event.pubkey` in `blastr_entitlements`; reject if not `active` or `grace`.
3. **Rate limit** — Per-pubkey (and optionally per-IP); reject if over limit.
4. **Dedupe** — Check KV (by event id); reject or treat as duplicate per policy.
5. **Resolve relays** — `policy.resolve(pubkey)` using system relay universe → ordered list of URLs.
6. **Reject if no relays** — e.g. whitelist with no allowed relays.
7. **Create job** — Insert into `blastr_publish_jobs` with status `queued` and the resolved relay list snapshot.
8. **Enqueue** — Send message to `blastr-publish-jobs` with job id, event, pubkey, resolved relays, source, timestamp.
9. **Dedupe write** — Optionally write event id to KV.
10. **Return OK** — Nostr `["OK", event_id, true, ""]`.

No outbound relay calls happen in the ingress path; only KV, D1, and queue send.

### Queue consumer (`src/transport/queue.ts`)

- Receives batch of `PublishJobMessage` (job id, event, pubkey, resolvedRelays, source, receivedAt).
- For each message: load job from D1 (if needed), open connections to each relay in `resolvedRelays`, send event, record each attempt in `blastr_publish_attempts`, update job status.
- Ack on success; do not ack on failure so the queue retries.

**Poison message handling:** `wrangler.toml` sets `max_retries` (and `visibility_timeout_ms`) for the queue consumer. When fanout throws, the message is not acked and Cloudflare Queues will retry. On each failure we log a **poison** event (JSON with `poison: true`, `jobId`, `eventId`, `error`, `timestamp`) so operators can find messages that repeatedly fail. After max retries, Cloudflare may drop the message or route to a dead-letter queue if configured. To inspect: filter logs for `poison: true`; fix data or relay issues and re-submit the event if needed.

### Core domain

- **`src/core/EventValidator.ts`** — Event shape and signature validation; allowed kinds and max size.
- **`src/core/relay-catalog.ts`** — System relay universe (from D1 `blastr_system_relays`).
- **`src/core/policy/resolve.ts`** — Given pubkey and catalog, applies user policy (blacklist/whitelist, allow/block) and returns the effective relay list.

### Services

- **`src/services/db.ts`** — D1: entitlements, user policies, policy relays, system relays, jobs, attempts.
- **`src/services/jobs.ts`** — Create publish job and enqueue.
- **`src/services/dedupe.ts`** — KV check/set by event id.
- **`src/services/rate-limit.ts`** — Per-pubkey (and optionally per-IP) rate limiting.

### Transport

- **HTTP** — Handlers for publish, NIP-11; admin CRUD for entitlements and policies; mappers for Nostr OK/error.
- **WebSocket** — `src/transport/ws/relay.ts` — Nostr relay protocol; submitted events go through the same ingress pipeline.
- **Queue** — Producer in jobs service; consumer in `src/transport/queue.ts`.

---

## Data flow summary

```
Client (Nostr) → Worker (fetch/ws)
  → validate → entitlement → rate limit → dedupe → resolve relays
  → create job (D1) → enqueue (Queues) → return OK

Queue → consumer
  → for each message: fanout to job.resolvedRelays → record attempts (D1) → ack
```

---

## Data model (D1)

- **blastr_entitlements** — pubkey, plan_tier, status (active | grace | expired | suspended), rate_limit_profile.
- **blastr_user_policies** — pubkey, mode (blacklist | whitelist), enabled.
- **blastr_policy_relays** — pubkey, relay_url, action (allow | block).
- **blastr_system_relays** — relay_url, enabled, health_status, score, category, last_checked_at.
- **blastr_publish_jobs** — job id, event_id, pubkey, source, received_at, status, relay list snapshot, counts.
- **blastr_publish_attempts** — job_id, relay_url, attempt_number, status, error_code, latency_ms.

KV is used for dedupe (event id) and optionally for rate-limit counters.

---

## Configuration and environment

- **Bindings:** `PUBLISHED_NOTES` (KV), `DB` (D1), `BLASTR_PUBLISH_QUEUE` (Queue). Required; validated at startup.
- **Optional:** `API_TOKEN` (protects `/event` and WebSocket and admin), `RATE_LIMIT_REQUESTS`, `RATE_LIMIT_WINDOW_MS`, `CORS_ENABLED`, `CORS_ORIGINS`, `ENVIRONMENT`.

See `src/config/env.ts` and `wrangler.toml`.

---

## Observability

**Metrics** are emitted as structured JSON log lines (prefix `[metric]`) so log pipelines can aggregate them. Each line has `@metric: true`, `name`, `type` (`counter` or `histogram`), and `value`; counters may include `reason` (e.g. for `events_rejected`).

- **Counters:** `events_accepted`, `events_rejected` (reason: not_entitled, rate_limit, duplicate, no_relays, validation_error), `fanout_success`, `fanout_failed`, `queue_message_acked`, `queue_message_retried`.
- **Histograms:** `ingress_latency_ms` (time to process POST /event), `fanout_latency_ms` (time to fan out one job to all relays).

Implementation: `src/observability/metrics.ts`. Optional: wire to Cloudflare Workers Analytics Engine when the binding is available.

**Correlation:** The same correlation id is set on the ingress request (e.g. `X-Correlation-ID`) and passed in the queue message payload; the queue consumer sets it on the logger so "ingress request" and "queue processing for job X" can be correlated in logs.

---

## Design decisions

- **Pubkey-scoped only** — No session or client identity; entitlement and policy are keyed by `event.pubkey`.
- **Snapshot relays on the job** — The consumer does not re-resolve policy; it uses the list stored with the job.
- **Bounded relay set** — “All relays” means “all in the system relay universe” (curated), not “any relay on the internet.”
- **Async fanout** — Ingress returns OK after enqueue; delivery is best-effort with retries and diagnostics in D1.

For product rationale and phasing, see [SFS_BROADCAST_RELAY_DESIGN.md](SFS_BROADCAST_RELAY_DESIGN.md).
