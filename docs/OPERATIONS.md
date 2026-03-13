# Operations

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
  - Check system relay list (`blastr_system_relays`) and `health_status`; disable or fix unhealthy relays.
  - Verify user policy (blacklist/whitelist and policy relays) for the pubkey; ensure at least one relay is allowed.
  - For persistent poison messages: filter logs for `poison: true`, fix the underlying relay or data issue; re-publish the event if needed.

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
