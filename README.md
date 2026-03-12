# Blastr

**A write-focused managed Nostr relay for SmartFlowSocial.** Blastr accepts signed Nostr events (WebSocket or HTTP), enforces **pubkey-scoped entitlement** (paid subscription), applies per-pubkey **relay policy** (blacklist/whitelist), and fans out to a bounded **system relay universe**—all keyed by the event author’s pubkey, so behavior is consistent from any client (SFS app, Damus, Coracle, etc.).

---

## Table of contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Project structure](#project-structure)
- [API reference](#api-reference)
- [Configuration](#configuration)
- [Setup (D1, KV, Queues)](#setup-d1-kv-queues)
- [Development](#development)
- [Testing](#testing)
- [CI/CD](#cicd)
- [Documentation](#documentation)
- [License](#license)

---

## Features

- **Pubkey-scoped behavior** — Entitlement and relay policy are determined by the **event author’s pubkey**, not by client or session. Relay preferences set in SmartFlowSocial apply when the same user posts from any Nostr client.
- **Entitlement gating** — Only pubkeys in `blastr_entitlements` with status `active` or `grace` can publish; others receive a clear rejection (e.g. “paid SmartFlowSocial subscription required”).
- **User relay policy** — Per-pubkey blacklist/whitelist with allow/block lists; default is blacklist with an empty block list (full managed relay set).
- **Bounded relay universe** — Curated system relays in `blastr_system_relays`; effective relay set is resolved from policy and **snapshotted on the job** for reliable fanout.
- **Async fanout** — Ingress validates, checks entitlement, rate limit, dedupe, resolves relays, creates a job, enqueues, and returns OK. A queue consumer sends the event to the job’s relay list and records attempts.
- **NIP-11 & NIP-20** — Relay info and write-only limitation exposed; compatible with standard Nostr clients.
- **Admin API** — Manage entitlements, user policies, and policy relays (protected by `API_TOKEN`).
- **Diagnostics** — Publish jobs and per-relay attempts stored in D1 for observability.

---

## Architecture

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                     Blastr Worker                        │
                    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
  Nostr clients     │  │  WebSocket  │  │ POST/event  │  │ GET /, /health  │  │
  (SFS, Damus…) ───►│  │   relay     │  │   handler   │  │ NIP-11, health  │  │
                    │  └──────┬──────┘  └──────┬──────┘  └─────────────────┘  │
                    │         │                │                               │
                    │         └────────┬───────┘                               │
                    │                  ▼                                       │
                    │  ┌───────────────────────────────────────────────────┐   │
                    │  │  Ingress pipeline                                 │   │
                    │  │  validate → entitlement → rate limit → dedupe →   │   │
                    │  │  resolve relays → create job → enqueue → OK       │   │
                    │  └─────────────────────────────┬─────────────────────┘   │
                    │                                │                          │
                    │                                ▼                          │
                    │  ┌───────────────────────────────────────────────────┐   │
                    │  │  Cloudflare Queues (blastr-publish-jobs)           │   │
                    │  └─────────────────────────────┬─────────────────────┘   │
                    └───────────────────────────────┼─────────────────────────┘
                                                    │
                                                    ▼
                    ┌─────────────────────────────────────────────────────────┐
                    │  Queue consumer: load job → fanout to job’s relay list   │
                    │  → record attempts in D1 (blastr_publish_attempts)       │
                    └─────────────────────────────┬────────────────────────────┘
                                                    │
                                                    ▼
                    ┌─────────────────────────────────────────────────────────┐
                    │  Downstream Nostr relays (system relay universe)         │
                    └─────────────────────────────────────────────────────────┘
```

**Data stores:** D1 (entitlements, policies, system relays, jobs, attempts), KV (dedupe by event id, optional rate-limit counters).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/SFS_BROADCAST_RELAY_DESIGN.md](docs/SFS_BROADCAST_RELAY_DESIGN.md) for detailed design.

---

## Tech stack

| Layer       | Technology                                                                  |
| ----------- | --------------------------------------------------------------------------- |
| Runtime     | Cloudflare Workers (Node compat)                                            |
| Language    | TypeScript (strict, ES2022)                                                 |
| Database    | Cloudflare D1 (SQLite)                                                      |
| Cache / KV  | Cloudflare KV (dedupe, optional rate-limit)                                 |
| Queue       | Cloudflare Queues                                                           |
| Nostr       | [nostr-tools](https://github.com/nostr-dev-kit/ndk) (parsing, verification) |
| Tests       | Vitest (unit, integration, coverage)                                        |
| Lint/format | ESLint (flat config), Prettier                                              |
| Git hooks   | Husky + lint-staged                                                         |

---

## Quick start

**Prerequisites:** Node.js ≥20, [pnpm](https://pnpm.io/) 10.x.

```bash
# Clone and install
git clone <repo-url>
cd vibe-blastr-master
pnpm install

# Validate (format, lint, typecheck)
pnpm validate

# Run tests
pnpm test

# Local development (requires D1/KV/Queue bindings in wrangler.toml or .dev.vars)
pnpm start
```

Then open the worker URL (e.g. `http://localhost:8787`). Use `GET /` with `Accept: application/nostr+json` for NIP-11, `POST /event` to submit events (with entitlement and policy configured), and `GET /health` for health checks.

---

## Project structure

| Path                                     | Purpose                                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                           | Worker entry: `fetch` (HTTP/WebSocket routing) and `queue` (publish-job consumer).                        |
| `src/config/`                            | Environment validation (`env.ts`).                                                                        |
| `src/core/`                              | Domain logic: event validation, relay catalog, policy resolution.                                         |
| `src/adapters/`                          | Nostr adapter (event parsing/verification via nostr-tools).                                               |
| `src/services/`                          | D1 (entitlements, policies, jobs, relays), jobs, dedupe (KV), rate-limit.                                 |
| `src/transport/`                         | HTTP handlers (publish, NIP-11), admin API, pipeline (ingress), queue producer/consumer, WebSocket relay. |
| `src/middleware/`                        | CORS (preflight and headers).                                                                             |
| `src/errors.ts`, `types.ts`, `logger.ts` | Shared error codes, types, logging.                                                                       |
| `tests/`                                 | Unit, integration, and optional security tests (mirrors `src/` layout).                                   |
| `migrations/`                            | D1 SQL migrations (blastr tables, seed system relays).                                                    |
| `docs/`                                  | Design and architecture documentation.                                                                    |

---

## API reference

### Public endpoints

| Method              | Path         | Description                                                                                                          |
| ------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `GET`               | `/`          | NIP-11 relay info when `Accept: application/nostr+json`; otherwise plain text.                                       |
| `GET`               | `/health`    | Health check. Returns `{ "status": "ok", "timestamp": "…" }`.                                                        |
| `POST`              | `/event`     | Submit a Nostr event. Body: event object or `["EVENT", event]`. Returns Nostr `["OK", event_id, accepted, message]`. |
| `GET` / `WebSocket` | `/` or `/ws` | Nostr WebSocket relay (event submission).                                                                            |

When `API_TOKEN` is set, `/event` and WebSocket upgrade require `Authorization: Bearer <token>` or `X-API-TOKEN: <token>`.

### Admin API (requires `API_TOKEN`)

| Method   | Path                                         | Description                                                                                |
| -------- | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `PUT`    | `/admin/entitlements/<pubkey>`               | Create or update entitlement (body: `plan_tier`, `status`, optional `rate_limit_profile`). |
| `GET`    | `/admin/users/<pubkey>/policy`               | Get user relay policy.                                                                     |
| `PUT`    | `/admin/users/<pubkey>/policy`               | Set user policy (body: `mode`, `enabled`, etc.).                                           |
| `POST`   | `/admin/users/<pubkey>/relays`               | Add a relay to policy (body: `relay_url`, `action`).                                       |
| `DELETE` | `/admin/users/<pubkey>/relays?relay_url=...` | Remove a relay from policy.                                                                |

See [docs/API.md](docs/API.md) for request/response details.

---

## Configuration

- **Entitlements** — Populate `blastr_entitlements` (e.g. from your subscription service). Only pubkeys with `status` in `active` or `grace` can publish.
- **System relays** — Managed in `blastr_system_relays`. Seed data: `migrations/0003_seed_system_relays.sql`.
- **User policy** — Per-pubkey mode and allow/block list in `blastr_user_policies` and `blastr_policy_relays`. Default: blacklist with no blocked relays.
- **Environment** — Optional: `API_TOKEN`, `RATE_LIMIT_REQUESTS`, `RATE_LIMIT_WINDOW_MS`, `CORS_ENABLED`, `CORS_ORIGINS`, `ENVIRONMENT`. See `src/config/env.ts` and `wrangler.toml`.

---

## Setup (D1, KV, Queues)

### D1

```bash
wrangler d1 create blastr-db
# Add the database_id to wrangler.toml under [[d1_databases]]

wrangler d1 execute blastr-db --remote --file=./migrations/0002_blastr_tables.sql
wrangler d1 execute blastr-db --remote --file=./migrations/0003_seed_system_relays.sql
```

For local dev, use `--local` instead of `--remote`.

### KV

Used for event dedupe and (optionally) rate-limit counters:

```bash
wrangler kv:namespace create PUBLISHED_NOTES
wrangler kv:namespace create PUBLISHED_NOTES --preview
```

Add the IDs to `wrangler.toml` under `kv_namespaces`.

### Queue

```bash
wrangler queues create blastr-publish-jobs
```

Configure producer and consumer in `wrangler.toml` (see existing `[[queues.producers]]` and `[[queues.consumers]]`).

---

## Development

| Command             | Description                               |
| ------------------- | ----------------------------------------- |
| `pnpm start`        | Start local dev server (`wrangler dev`).  |
| `pnpm validate`     | Format check + lint + typecheck.          |
| `pnpm typecheck`    | `tsc --noEmit`.                           |
| `pnpm lint`         | ESLint with cache.                        |
| `pnpm lint:fix`     | ESLint with auto-fix.                     |
| `pnpm format`       | Prettier write.                           |
| `pnpm format:check` | Prettier check.                           |
| `pnpm deploy`       | Deploy to Cloudflare (`wrangler deploy`). |

Staging: `wrangler deploy --env staging` (uses `env.staging` in `wrangler.toml`).

---

## Testing

| Command                 | Description                                 |
| ----------------------- | ------------------------------------------- |
| `pnpm test`             | Run all tests.                              |
| `pnpm test:unit`        | Unit tests (core, services, utils, logger). |
| `pnpm test:integration` | Integration tests (transport, integration). |
| `pnpm test:security`    | Security tests.                             |
| `pnpm test:watch`       | Vitest watch mode.                          |
| `pnpm test:coverage`    | Vitest with coverage report.                |

Coverage thresholds are enforced in `vitest.config.ts`.

---

## CI/CD

- **CI** (`.github/workflows/ci.yml`) — On push/PR: validate, unit tests, integration tests, coverage. Uses Node 20 and pnpm 10.27.0 with frozen lockfile.
- **Deploy** — Set `CF_API_TOKEN` (and optionally routes in `wrangler.toml`), then `pnpm deploy` or your own workflow. Staging: `pnpm deploy --env staging`.

---

## Documentation

| Document                                                                 | Description                                         |
| ------------------------------------------------------------------------ | --------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                             | High-level architecture and data flow.              |
| [docs/API.md](docs/API.md)                                               | API reference (public and admin).                   |
| [docs/SFS_BROADCAST_RELAY_DESIGN.md](docs/SFS_BROADCAST_RELAY_DESIGN.md) | Product and design assessment, data model, phasing. |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to run checks, write tests, and submit changes.

---

## License

See [LICENSE](LICENSE) for license terms.
