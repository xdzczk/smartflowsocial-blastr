# Blastr API reference

SFS broadcast relay API. This document describes the HTTP and WebSocket API of the Blastr worker. The API is considered **v1** (implicit). For versioning policy and future breaking changes, see [VERSIONING.md](VERSIONING.md).

## Authentication

- **Relay** (POST /event and WebSocket): Does **not** use `API_TOKEN`. Access is gated by **pubkey entitlement** only (see ingress pipeline). No API token is required for publishing.
- **Admin** routes (`/admin/*`): When `API_TOKEN` is set, require `Authorization: Bearer <API_TOKEN>` or `X-API-TOKEN: <API_TOKEN>`. If `API_TOKEN` is not set, admin routes are unprotected.

---

## Public endpoints

### GET /

**Relay discovery (NIP-11).**

- If the request has `Accept: application/nostr+json` (or `*/*`), the response is JSON with:
  - `name`: `"Blastr"`
  - `description`: `"SFS Broadcast Relay - write-focused managed relay"`
  - `supported_nips`: `[1, 11, 15, 20]`
  - `limitation`: `{ "write": true, "read": false }`
- Otherwise returns plain text: `Blastr relay. Use Nostr client with wss://... or POST /event`

**Response:** `200 OK`, `Content-Type: application/nostr+json` or `text/plain`.

---

### GET /health

**Liveness probe.** Cheap check that the worker is running. No dependency checks (D1, KV, queue).

**Response:** `200 OK`, `Content-Type: application/json`

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T12:00:00.000Z"
}
```

---

### GET /ready

**Readiness probe.** Verifies that required bindings are reachable (D1, KV, queue binding). Use for load balancers or orchestrators that should only send traffic when the worker can use its dependencies.

**Response:**

- `200 OK` when all checks pass: `{ "status": "ok", "checks": { "db": true, "kv": true, "queue": true }, "timestamp": "..." }`
- `503 Service Unavailable` when any check fails: same body shape with `"status": "degraded"` and `checks` indicating which dependency failed (value is `true` or an error message string).

---

### POST /event

**Submit a Nostr event for publishing.**

**Request:**

- Method: `POST`
- Body: JSON — either a raw Nostr event object, or a Nostr array: `["EVENT", <event>]`
- Headers: CORS is applied when `CORS_ENABLED` is set. No API token is required; entitlement is checked by pubkey.

**Success response:** `200 OK`, `Content-Type: application/json`

Body is a Nostr OK message:

```json
["OK", "<event_id>", true, ""]
```

**Error response:** Non-2xx status, `Content-Type: application/json`

- For Nostr-style errors (when event id is known), body is:

  ```json
  ["OK", "<event_id>", false, "<human-readable message>"]
  ```

- Possible messages include:
  - Invalid signature, disallowed kind, event too large
  - Not entitled (e.g. “paid SmartFlowSocial subscription required”)
  - Rate limit exceeded
  - Duplicate event
  - No relays configured (e.g. whitelist with no allowed relays)
- Status codes: `400` (validation, entitlement, rate limit, duplicate, no relays), `403` (not entitled), `500` (server error).

---

### WebSocket (Nostr relay)

**Path:** `/` or `/ws` with `Upgrade: websocket`.

Standard Nostr relay protocol. Clients send Nostr messages (e.g. `["EVENT", event]`); the relay accepts events and runs them through the same ingress pipeline as `POST /event`. No API token is required for the WebSocket upgrade; entitlement is enforced in the pipeline by pubkey.

**WebSocket protocol (write-only):**

- **Supported message:** Only `["EVENT", event]` is supported. The relay responds with NIP-01 `["OK", event_id, accepted, message]` (success or pipeline error).
- **Invalid JSON:** The relay sends a single `["NOTICE", "invalid JSON"]` (or similar) so the client knows the message was rejected.
- **Invalid format:** Valid JSON that is not a non-empty array of length ≥ 2, or whose first element is not a string, receives `["NOTICE", "invalid message format"]`.
- **Unsupported message types:** `REQ`, `CLOSE`, or any other type than `EVENT` receives `["NOTICE", "unsupported: only EVENT is supported"]`.
- **NIP-42 AUTH:** If the client sends `["AUTH", ...]`, the relay responds with `["NOTICE", "auth not required for this relay"]` (no challenge, no connection-level auth).

---

## Admin API

All admin routes require `API_TOKEN` when set: `Authorization: Bearer <token>` or `X-API-TOKEN: <token>`. Otherwise `401 Unauthorized` with body `{ "error": "Unauthorized", "code": "unauthorized" }`.

All admin responses are JSON (`Content-Type: application/json`).

---

### PUT /admin/entitlements/:pubkey

**Create or update an entitlement for a pubkey.**

**Request:** JSON body

| Field                | Type           | Required | Description                                                        |
| -------------------- | -------------- | -------- | ------------------------------------------------------------------ |
| `plan_tier`          | string         | No       | Default `"default"`                                                |
| `status`             | string         | No       | One of `active`, `grace`, `expired`, `suspended`; default `active` |
| `rate_limit_profile` | string \| null | No       | Optional profile key or null                                       |

**Response:** `200 OK`

```json
{
  "ok": true,
  "pubkey": "<hex>",
  "plan_tier": "default",
  "status": "active"
}
```

**Errors:** `400` if body is not valid JSON.

---

### GET /admin/users/:pubkey/policy

**Get the relay policy for a pubkey.**

**Response:** `200 OK`

```json
{
  "pubkey": "<hex>",
  "policy": {
    "mode": "blacklist",
    "enabled": 1
  },
  "relays": [{ "relay_url": "wss://...", "action": "block" }]
}
```

`policy` is `null` if no policy exists. `relays` is the list of policy relays (allow/block entries).

---

### PUT /admin/users/:pubkey/policy

**Set the relay policy for a pubkey.**

**Request:** JSON body

| Field     | Type    | Required | Description                                         |
| --------- | ------- | -------- | --------------------------------------------------- |
| `mode`    | string  | No       | `"blacklist"` or `"whitelist"`; default `blacklist` |
| `enabled` | boolean | No       | Default `true` (stored as 1/0)                      |

**Response:** `200 OK`

```json
{
  "ok": true,
  "pubkey": "<hex>",
  "mode": "blacklist",
  "enabled": 1
}
```

**Errors:** `400` if body is not valid JSON.

---

### POST /admin/users/:pubkey/relays

**Add a relay to the pubkey’s policy.**

**Request:** JSON body

| Field       | Type   | Required | Description                             |
| ----------- | ------ | -------- | --------------------------------------- |
| `relay_url` | string | Yes      | Relay URL (e.g. wss://…)                |
| `action`    | string | No       | `"allow"` or `"block"`; default `block` |

**Response:** `200 OK`

```json
{
  "ok": true,
  "pubkey": "<hex>",
  "relay_url": "wss://...",
  "action": "block"
}
```

**Errors:** `400` if body is not valid JSON or `relay_url` is missing.

---

### DELETE /admin/users/:pubkey/relays?relay_url=...

**Remove a relay from the pubkey’s policy.**

**Query:** `relay_url` — URL-encoded relay URL.

**Response:** `200 OK`

```json
{
  "ok": true,
  "pubkey": "<hex>",
  "relay_url": "wss://..."
}
```

---

## Error codes (ingress / POST /event)

These codes can appear in Nostr OK messages or in JSON error bodies:

| Code                   | Meaning                             |
| ---------------------- | ----------------------------------- |
| `invalid_signature`    | Event signature verification failed |
| `disallowed_kind`      | Event kind not in allow list        |
| `event_too_large`      | Event exceeds max size              |
| `not_entitled`         | Pubkey not active/grace             |
| `rate_limit_exceeded`  | Per-pubkey (or IP) limit exceeded   |
| `duplicate`            | Event id already seen               |
| `no_relays_configured` | Resolved relay list empty           |

---

## CORS

When `CORS_ENABLED` is set, CORS headers are applied to `/event` (and optionally admin) according to `CORS_ORIGINS`. OPTIONS preflight is handled for configured methods and headers. For allowed origins, CORS allows the request headers: `Content-Type`, `Authorization`, `X-API-TOKEN`, `X-Correlation-ID`, and `X-Request-ID`.
