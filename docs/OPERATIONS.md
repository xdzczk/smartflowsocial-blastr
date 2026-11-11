# Operations

## Production deploy checklist

Before the first deploy (or when setting up a new environment):

1. **Cloudflare resources** — In the same account you deploy from: create the queue (`wrangler queues create blastr-publish-jobs`), create KV namespaces (PUBLISHED_NOTES, BLASTR_RATE_LIMIT) and optionally preview namespaces for local, create D1 and run migrations. Add all IDs to `wrangler.toml`.
2. **Secrets / env** — Set `API_TOKEN` to protect the admin API. If using CORS, set `CORS_ENABLED` and `CORS_ORIGINS`.
3. **Deploy** — Run `pnpm deploy` (or `wrangler deploy --env=staging` for staging). Ensure CI is green before production deploys.
4. **Verify** — Hit `GET /health` and `GET /ready`; confirm readiness checks pass. Add at least one entitlement via the admin API and test `POST /event` with a signed event.

See the [First-time setup](../README.md#first-time-setup-before-first-deploy) and [Setup (D1, KV, Queues)](../README.md#setup-d1-kv-queues) sections in the main README for commands.

---

## Idempotency

- **One job per event:** Enforced by `UNIQUE(event_id)` on `blastr_publish_jobs` (migration `0004_blastr_publish_jobs_event_id_unique`).
- **Exactly one queue send per event:** Only the request that actually inserts the row calls the queue and marks the event in KV; duplicate submissions receive the same job id without re-queuing.
- Concurrent POSTs for the same event all get 200 with the same `jobId`.

## SLOs (targets)

- **Ingress latency:** p95 of time from POST /event request start to response &lt; 500 ms (excluding downstream relay calls; only validation, entitlement, rate limit, dedupe, job create, enqueue).
- **Fanout success rate:** For entitled events that reach the queue, &gt; 99% of jobs complete with at least one successful relay delivery (success or partial status).
- **Queue processing lag:** Time from enqueue to start of fanout &lt; 1 min under normal load.

These are targets for tuning and alerting; adjust thresholds to your environment.

## Runbooks

### Health / readiness failing

- **Symptom:** GET /ready returns 503 or checks show db/kv/queue failure.
- **Actions:**
  - Check D1: connectivity and that migrations are applied; run a simple query (e.g. `SELECT 1`).
  - Check KV: binding name and namespace ID in wrangler.toml; verify read/write in dashboard.
  - Check queue: binding and queue name; confirm consumer is deployed and queue exists in Cloudflare dashboard.
  - Review Worker logs for the specific error message in the `checks` object.

### Fanout failing repeatedly

- **Symptom:** Many `fanout_failed` or `queue_message_retried` metrics; poison events in logs.
- **Actions:**
  - Inspect `blastr_publish_attempts` and job status in D1 for failing job ids; note `error_code`, `relay_url`, and `attempt_number` (which try produced the outcome: 2 or 3 means a retry was used).
  - Check system relay list (`blastr_system_relays`) and `health_status`. `failed` means three consecutive publish attempts failed. The relay stays out of the fanout for 24 hours after `last_checked_at`, then it is tried again. A success sets `ok`. Catalog sync does not clear `failed`. To retry immediately: `UPDATE blastr_system_relays SET health_status = 'unknown' WHERE relay_url = 'wss://...';`
  - The 15-minute cron marks `queued` or `processing` jobs older than one hour as `failed`. Those rows have no queue message left.
  - Verify user policy (blacklist/whitelist and policy relays) for the pubkey; ensure at least one relay is allowed.
  - For persistent poison messages: filter logs for `poison: true`, fix the underlying relay or data issue; re-publish the event if needed.

### Relay catalog

- **Source:** `GET {NOSTRMASH_API_BASE}/api/v1/relays/catalog`. Cron is every 15 minutes. A failed response, a bad body, or `"relays": []` leaves membership unchanged.
- **Score** is `distinct_users`, not the catalog's float `score`.
- **Operator pin** (keep a relay that leaves the catalog): `UPDATE blastr_system_relays SET operator_hold = 1, enabled = 1 WHERE relay_url = 'wss://...';`
- **Operator disable** (do not turn it back on): `UPDATE blastr_system_relays SET operator_hold = 1, enabled = 0 WHERE relay_url = 'wss://...';`
- **Return a relay to the catalog:** `UPDATE blastr_system_relays SET operator_hold = 0 WHERE relay_url = 'wss://...';`
- The catalog is read liveness. It does not mean the relay will accept an EVENT.

### Rate limit or entitlement misconfiguration

- **Symptom:** Legitimate users get 429 or 403 (not entitled).
- **Actions:**
  - Admin API: use PUT /admin/entitlements/:pubkey to set status to `active` or `grace`; set `rate_limit_profile` if using a custom profile.
  - Check RATE_LIMIT_REQUESTS and RATE_LIMIT_WINDOW_MS (and per-profile limits in code) and adjust for your traffic.
  - Confirm the pubkey in the event matches the entitlement record.

### Admin API returns 429

- **Symptom:** Admin routes return "Too Many Requests".
- **Actions:**
  - Admin routes are rate-limited per IP (60 requests per 60 s by default). Space out admin calls or use from fewer IPs.
  - Check Retry-After header and wait before retrying.
