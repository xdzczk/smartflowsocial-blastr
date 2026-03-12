# Blastr — SFS Broadcast Relay

A **write-focused managed Nostr relay** for SmartFlowSocial. It accepts signed events over the Nostr relay protocol (WebSocket or POST), checks **pubkey-scoped entitlement** (paid subscription), applies the pubkey’s **relay policy** (blacklist/whitelist), and fans out to a bounded **system relay universe**.

Behavior is determined by the **event author’s pubkey**, not by the client or session. Relay preferences set in SmartFlowSocial apply when the same user posts from any client (e.g. `wss://blastr.smartflow.social`).

See **[docs/SFS_BROADCAST_RELAY_DESIGN.md](docs/SFS_BROADCAST_RELAY_DESIGN.md)** for product and architecture details.

## Stack

- **TypeScript** on **Cloudflare Workers** (fetch + queue)
- **D1** for jobs, policy, entitlements, system relays
- **KV** for dedupe and rate limiting
- **Queues** for async fanout to downstream relays

## Development

```sh
# install dependencies
pnpm install

# typecheck, lint, format
pnpm validate

# run tests
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:coverage

# local dev
pnpm start          # wrangler dev

# deploy
pnpm deploy         # wrangler deploy
```

## Setup

### D1

Create a D1 database and run migrations:

```sh
wrangler d1 create blastr-db
# Add the database_id to wrangler.toml under [[d1_databases]]

wrangler d1 execute blastr-db --remote --file=./migrations/0002_blastr_tables.sql
wrangler d1 execute blastr-db --remote --file=./migrations/0003_seed_system_relays.sql
```

For local dev, use `--local` instead of `--remote`.

### KV

Used for event dedupe and (optionally) rate-limit counters:

```sh
wrangler kv:namespace create PUBLISHED_NOTES
wrangler kv:namespace create PUBLISHED_NOTES --preview
```

Add the IDs to `wrangler.toml` under `kv_namespaces`.

### Queue

Single queue for publish jobs:

```sh
wrangler queues create blastr-publish-jobs
```

Configure the producer and consumer in `wrangler.toml` (see existing `[[queues.producers]]` and `[[queues.consumers]]`).

## Endpoints

- **GET /** — NIP-11 relay info (if `Accept: application/nostr+json`) or plain text.
- **POST /event** — Submit a Nostr event (body: event object or `["EVENT", event]`). Returns Nostr `["OK", event_id, accepted, message]`.
- **GET /health** — Health check (returns `{ "status": "ok" }`).

## Configuration

- **Entitlements** — Populate `blastr_entitlements` (e.g. from your subscription service). Only pubkeys with `status` in `active` or `grace` can publish.
- **System relays** — Managed in `blastr_system_relays`. Seed data is in `migrations/0003_seed_system_relays.sql`.
- **User policy** — Per-pubkey mode and allow/block list in `blastr_user_policies` and `blastr_policy_relays`. Default is blacklist with no blocked relays.

## CI/CD

- **CI** (`.github/workflows/ci.yml`) — On push/PR: validate, unit tests, integration tests, coverage.
- **Deploy** — Configure `CF_API_TOKEN` and (optionally) routes in `wrangler.toml`, then `pnpm deploy` or your own workflow.

