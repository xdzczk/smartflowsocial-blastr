# SFS Broadcast Relay — Design Assessment & Implementation Guide

This document assesses the pubkey-scoped, policy-driven relay design and maps it to the Blastr service (TypeScript implementation of the SFS broadcast relay).

---

## Verdict: The Design Is Right

The spec correctly identifies the core constraint:

> **Canonical rule:** Blastr behavior must be determined by the author pubkey's saved SFS policy, not by which client submitted the event.

That single rule gives you:

- **Paid gating** that works from any client (no cookies/API keys for relay posting).
- **Relay preferences** that apply everywhere (SFS app, Damus, Coracle, etc.).
- **Clean architecture:** one source of truth (pubkey → entitlement + policy).

Building this as a **managed publish infrastructure layer** for SmartFlowSocial (not “Blastr with a UI”) is the right product framing.

---

## Current State vs. Target

| Aspect                  | Previous (Rust)                                          | Current (Blastr / TypeScript)                                           |
| ----------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Policy**              | None — every event treated the same                      | Pubkey → entitlement + relay policy (blacklist/whitelist)               |
| **Relay universe**      | `api.nostr.watch/v1/online` + 8 fallbacks (“all online”) | Bounded **system relay universe** (curated/hybrid, health, allow/block) |
| **Gating**              | Open to all                                              | Paid SFS subscription per pubkey                                        |
| **Per-event relay set** | Same list for every event (split across queues)          | Resolved per pubkey from stored policy, **snapshotted on job**          |
| **Identity**            | N/A                                                      | `event.pubkey` only (no session)                                        |
| **NWC**                 | Special path: store in D1, no fanout                     | Spec doesn’t mention; decide if NWC stays or moves elsewhere            |
| **Ack**                 | OK after queue + KV write                                | OK = “accepted + queued”; delivery is async                             |
| **Diagnostics**         | Minimal                                                  | Jobs + per-relay attempts, stored for diagnostics                       |

The Blastr service is a re-platform with a new data model and new services (policy, relay catalog, entitlement).

---

## What to Keep From the Spec (Unchanged)

- **Identity = event.pubkey** for entitlement and policy.
- **Default:** blacklist mode, empty block list → full managed relay set.
- **Resolution:** `effectiveRelays = f(systemRelayUniverse, user policy)`; snapshot result on the job.
- **Ack:** OK = accepted and queued; do not wait for full fanout.
- **Bounded relay set:** “all available” = “all in SFS managed universe (enabled, healthy, not user-blocked).”
- **Rejection messages:** e.g. `restricted: paid SmartFlowSocial subscription required` or `pubkey not entitled / not linked`.
- **Edge cases:** snapshot at job creation; already-queued jobs proceed after subscription expiry; reject unsupported kinds/size/rate upfront.

---

## Gaps and Decisions to Make

### 1. NWC (Nostr Wallet Connect)

Current code has a special path: NWC request/response stored in D1 and not fanned out. The spec doesn’t define NWC.

- **Option A:** Keep NWC in this service (same ingress, different path): still identify by pubkey, optionally require entitlement for NWC too.
- **Option B:** Drop NWC from Blastr and handle it in another SFS service (cleaner separation; relay stays “broadcast only”).

Recommendation: Decide explicitly; if keeping NWC, document it in the product definition and data model.

### 2. Entitlement and Subscription Ownership

Spec says: _“If a user has multiple pubkeys/accounts under one SFS subscription, your entitlement model must support that.”_

You need a clear contract:

- Where do **subscription** and **linked pubkeys** live? (SFS main app DB vs. Blastr DB.)
- Does Blastr **own** `blastr_entitlements` and sync from subscription service, or **query** the subscription service on each request?

Recommendation: Blastr owns a **denormalized entitlement cache** (e.g. `blastr_entitlements`), updated when subscriptions or linked pubkeys change (events from SFS app or a small internal API). Ingress does a single lookup: `pubkey → eligible? rate_limit?` and does not join to full subscription tables.

### 3. Where Policy and Catalog Live

- **Relay policy (per-pubkey):** Stored in Blastr (or in SFS app DB with Blastr reading it). Same for **system relay universe** and health.
- **Relay catalog:** Likely Blastr-owned (e.g. `blastr_system_relays`) with optional sync from a seed list or external source.

Keep **relay resolution logic** in one place (shared library or service) so SFS app “preview” and the relay ingress use the same algorithm.

### 4. Multi-Tenancy and Abuse

Spec calls out per-pubkey and per-IP rate limits, max event size, allowed kinds, dedupe by event id. For Workers:

- **Per-IP:** Use Worker `request.cf` or headers; consider Cloudflare rate limiting at the zone.
- **Per-pubkey:** KV or Durable Object or external Redis; prefer KV or Redis for fast checks.
- **Dedupe:** Keep something like current KV keyed by `event_id` (or DB) so the same event isn’t queued twice.

Decide where **quota** is enforced: only at ingress (recommended) or also in the fanout worker.

### 5. Fanout Worker and Queues

Spec: “Do not do slow relay probing inline.” So:

- **Ingress:** Resolve relay set from policy + catalog (catalog can be cached in KV/memory), create job with **resolved relay list** and event payload, enqueue, return OK.
- **Consumer:** Load job, open outbound WebSockets to each relay in the job’s list, send event, record attempts (and optionally update relay health from outcome).

Current Rust code uses 10 queues and splits the **global** relay list by range. In the new model, each **job** carries its own relay list; you can still use multiple queues for throughput, but the unit of work is “one event + its target relays,” not “one slice of a global list.”

---

## Suggested TypeScript Layout

```text
packages/
  relay-ingress/          # Worker: WebSocket + POST /event
  fanout-worker/          # Queue consumer: job → outbound relays
  policy/                 # Shared: resolve(pubkey, universe) → relay list
  relay-catalog/          # Shared: system relay list, health (maybe same Worker as ingress or separate)
  types/                  # Shared Nostr + job types
```

Or a single Worker with:

- HTTP/WebSocket routes for Nostr EVENT.
- Queue producer for accepted events (payload = event + resolved relay list + pubkey + timestamp).
- Separate Queue consumer (same or another Worker) that only does fanout and writes to `blastr_publish_attempts` / updates job status.

**Stack:**

- **Runtime:** Cloudflare Workers (TS).
- **Router:** Hono or similar.
- **Queues:** Cloudflare Queues (one queue type: publish jobs).
- **Hot path (entitlement, policy, relay list):** KV or Redis-compatible (e.g. Upstash) for cache; DB for durable data.
- **DB:** Postgres (e.g. Neon, Turso, or existing SFS DB) with Prisma/Drizzle for `blastr_*` tables.
- **Nostr:** Use `nostr` or `nostr-tools` for event parsing and verification.

Avoid Durable Objects in v1 unless you need stateful connection coordination.

---

## Data Model (From Spec) — Summary

- **nostr_pubkeys** — link to SFS user, label, active.
- **blastr_entitlements** — pubkey, plan_tier, status, rate_limit_profile (denormalized from subscription).
- **blastr_user_policies** — pubkey, mode (blacklist/whitelist), enabled.
- **blastr_policy_relays** — pubkey, relay_url, action (allow/block).
- **blastr_system_relays** — relay_url, enabled, health_status, score, category, last_checked_at.
- **blastr_publish_jobs** — event_id, pubkey, source, received_at, status, relay_count_target, relay_count_success/failed, **resolved_relays snapshot** (JSON or separate table).
- **blastr_publish_attempts** — job_id, relay_url, attempt_number (1-based retry attempt for that relay: 1 = first try, 2 = first retry, …), status, error_code, latency_ms.
- **blastr_rate_counters** — per pubkey (and optionally per IP); use KV/Redis for real-time, optionally DB for analytics.

---

## Ingress Fast Path (Concrete)

1. Parse body / WebSocket message → Nostr `EVENT`.
2. Validate: JSON, event shape, **signature**.
3. **Reject** if kind not in allow list or size > max.
4. **Entitlement:** lookup `pubkey` → reject with “paid SmartFlowSocial subscription required” or “pubkey not linked” if not eligible.
5. **Rate limit:** check per-pubkey (and optionally per-IP); reject if over.
6. **Dedupe:** if event id already in KV (or DB), return OK with “duplicate” or reject; your choice.
7. **Resolve relay set:** `policy.resolve(pubkey)` using system relay universe (from cache) → list of URLs.
8. If list empty (e.g. whitelist with no allowed relays), reject or accept with “no relays” and no fanout; spec doesn’t define; recommend reject.
9. **Enqueue job:** `{ event, pubkey, resolvedRelays, receivedAt, source }`.
10. **Persist job** in DB (status = queued) and optionally write event id to KV for dedupe.
11. Return **OK** (accepted + queued).

No outbound relay calls in this path; only KV/DB/cache and queue send.

---

## Relay Resolution Algorithm (From Spec)

- Load user policy (blacklist vs whitelist, allow/block list).
- If no policy: default **blacklist**, empty block list.
- Filter **system relay universe** by: enabled, health above threshold.
- Apply user mode: **blacklist** → subtract blocked; **whitelist** → intersect with allowed.
- Optionally cap by plan (max relay count).
- Sort by health/priority; return ordered list.
- **Snapshot this list on the job**; do not re-resolve in the fanout worker for that job.

---

## Phasing (From Spec, Slightly Tightened)

**Phase 1 — Blastr service, paid relay**

- TS Worker: WebSocket + POST `/event`, Nostr EVENT only.
- Entitlement lookup (by pubkey); reject if not paid/linked.
- Policy + relay catalog (in-memory or KV cache); resolve relay set per pubkey; snapshot on job.
- Single publish queue; consumer fans out to job’s relay list, records attempts.
- Basic diagnostics: job + attempts in DB.
- Allowed kinds: e.g. 0, 1; reject rest.
- Rate limit and max event size; dedupe by event id.

**Phase 2**

- Relay health scoring and retries.
- Per-plan caps and throughput.
- UI: publish diagnostics, per-pubkey analytics.

**Phase 3**

- Optional API parity; premium/priority; custom relay import rules.

---

## One Strong Opinion (From Spec)

Do **not** make “all available relays” mean “any relay ever discovered.” It must mean “all relays in the **SFS managed active relay universe**” (bounded, curated, with health and allow/block). That keeps the product defensible and avoids becoming a generic spam fanout.

---

## Summary

- **Design is sound;** the pubkey-scoped, policy-driven model is the right abstraction for “works from other clients” and paid gating.
- **Current codebase** is a good reference for “event in → queue → fanout,” but policy, entitlement, and relay universe are new; the Blastr service is built as the SFS broadcast relay with a new data model.
- **Decide:** NWC in or out; entitlement sync vs. live subscription API; exact placement of policy/catalog (Blastr vs. SFS app).
- **Implement:** Ingress = validate → entitlement → rate limit → resolve relays → enqueue job with snapshot → OK. Fanout = consume job → send to job’s relays → record attempts. Keep resolution logic shared and relay set bounded.

This gives you a clear blueprint to implement the SFS Broadcast Relay in TypeScript on Cloudflare Workers without drifting from the spec.

---

## Aligning with vibe-\* codebases

For consistent structure and quality with **vibe-http-nostr-publisher** and **vibe-cdn-master**:

- **Structure:** Use `src/core/` (EventValidator, policy/resolve, relay-catalog), `src/transport/` (http/handlers, http/mappers, pipeline, queue), `src/services/` (db, jobs, rate-limit, dedupe), `src/config/env.ts`, top-level `errors.ts`, `types.ts`, `logger.ts`, and `src/middleware/cors.ts`. Tests mirror under `tests/core/`, `tests/transport/`, `tests/services/`, `tests/security/`, `tests/integration/`.
- **Tooling:** pnpm (packageManager 10.27.0), Node >=20; TypeScript strict with noUncheckedIndexedAccess, noImplicitOverride; ESLint flat config with tier1/tier2 rules, import/order, no-secrets; Prettier; Vitest with coverage thresholds; husky + lint-staged; scripts: validate (format:check + lint + typecheck), precheck, test:unit, test:integration.
- **Patterns:** Explicit `Env` interface and `validateEnvironment(env, logger)`; dedicated error type with `code` (and optional `retryAfter`); logger with correlation ID; feature boundaries (transport only calls core/services; no route-to-route imports).
- **CI:** GitHub Actions: lint + typecheck, then unit and integration tests (pnpm 10, Node 20, frozen lockfile). Optional: separate security and coverage jobs.
