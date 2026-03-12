# Blastr API reference

This document describes the HTTP and WebSocket API of the Blastr worker.

## Authentication

When `API_TOKEN` is set in the environment:

- **POST /event** and **WebSocket** upgrade require one of:
  - `Authorization: Bearer <API_TOKEN>`
  - `X-API-TOKEN: <API_TOKEN>`
- **Admin** routes (`/admin/*`) use the same mechanism.

If `API_TOKEN` is not set, the relay is publicly accessible (no auth).

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

**Health check.**

**Response:** `200 OK`, `Content-Type: application/json`

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T12:00:00.000Z"
}
```

---

### POST /event

**Submit a Nostr event for publishing.**

**Request:**

- Method: `POST`
- Body: JSON — either a raw Nostr event object, or a Nostr array: `["EVENT", <event>]`
- Headers: If `API_TOKEN` is set, include `Authorization: Bearer <token>` or `X-API-TOKEN: <token>`. CORS is applied when `CORS_ENABLED` is set.

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
- Status codes: `400` (validation, entitlement, rate limit, duplicate, no relays), `401` (missing/invalid API token when required), `500` (server error).

---

### WebSocket (Nostr relay)

**Path:** `/` or `/ws` with `Upgrade: websocket`.

Standard Nostr relay protocol. Clients send Nostr messages (e.g. `["EVENT", event]`); the relay accepts events and runs them through the same ingress pipeline as `POST /event`. When `API_TOKEN` is set, the upgrade request must include the same auth as above.

---

## Admin API

All admin routes require `API_TOKEN` when set: `Authorization: Bearer <token>` or `X-API-TOKEN: <token>`. Otherwise `401 Unauthorized` with body `{ "error": "Unauthorized", "code": "unauthorized" }`.

All admin responses are JSON (`Content-Type: application/json`).

---

### PUT /admin/entitlements/:pubkey

**Create or update an entitlement for a pubkey.**

**Request:** JSON body

| Field               | Type   | Required | Description                                      |
|---------------------|--------|----------|--------------------------------------------------|
| `plan_tier`         | string | No       | Default `"default"`                              |
| `status`            | string | No       | One of `active`, `grace`, `expired`, `suspended`; default `active` |
| `rate_limit_profile`| string \| null | No | Optional profile key or null                     |

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
  "relays": [
    { "relay_url": "wss://...", "action": "block" }
  ]
}
```

`policy` is `null` if no policy exists. `relays` is the list of policy relays (allow/block entries).

---

### PUT /admin/users/:pubkey/policy

**Set the relay policy for a pubkey.**

**Request:** JSON body

| Field    | Type   | Required | Description                          |
|----------|--------|----------|--------------------------------------|
| `mode`   | string | No       | `"blacklist"` or `"whitelist"`; default `blacklist` |
| `enabled`| boolean| No       | Default `true` (stored as 1/0)       |

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

| Field       | Type   | Required | Description              |
|-------------|--------|----------|--------------------------|
| `relay_url` | string | Yes      | Relay URL (e.g. wss://…) |
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

| Code                 | Meaning                          |
|----------------------|----------------------------------|
| `invalid_signature`  | Event signature verification failed |
| `disallowed_kind`   | Event kind not in allow list     |
| `event_too_large`   | Event exceeds max size          |
| `not_entitled`      | Pubkey not active/grace         |
| `rate_limit_exceeded` | Per-pubkey (or IP) limit exceeded |
| `duplicate`         | Event id already seen            |
| `no_relays_configured` | Resolved relay list empty     |

---

## CORS

When `CORS_ENABLED` is set, CORS headers are applied to `/event` (and optionally admin) according to `CORS_ORIGINS`. OPTIONS preflight is handled for configured methods and headers.
