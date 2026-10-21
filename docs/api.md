# API contract

Base URL: `https://tunnel-control.<subdomain>.workers.dev`. All bodies are JSON.
Every JSON response sends `Cache-Control: no-store`. The schemas live in `web/src/shared/schemas.ts`.

## Errors

```json
{ "error": { "code": "invalid_body", "message": "running: Invalid input" } }
```

| Status | `code` | Meaning |
|---|---|---|
| 400 | `invalid_body`, `invalid_query`, `agent_id_mismatch` | Validation failed |
| 401 | `unauthorized`, `invalid_credentials` | Missing/invalid token or session; wrong password |
| 404 | `not_found` | No such `/api/*` endpoint |
| 426 | `upgrade_required` | WebSocket route called without `Upgrade: websocket` |
| 429 | `rate_limited` | Too many login attempts; also has `retryAfterSeconds` and a `Retry-After` header |
| 500 | `misconfigured`, `internal` | A Worker secret is missing/invalid; unexpected error |

## Types

```ts
type AgentStatus = {
  agentId: string;             // 1-64 chars, must equal the Worker's AGENT_ID
  agentVersion: string;        // <= 32
  hostname: string;            // <= 255
  running: boolean;
  url: string | null;          // ^https://[a-z0-9-]+\.trycloudflare.com$ or null
  startedAt: number | null;    // epoch ms when the current tunnel started
  lastError: string | null;    // <= 2000
  cloudflaredVersion: string | null; // <= 100
  lastSeen: number;            // set by the SERVER (ignored if the agent sends it)
};

type Event = {
  id: number; at: number;      // at = server epoch ms
  type: "desired_changed" | "tunnel_started" | "tunnel_stopped" | "url_changed"
      | "agent_error" | "agent_online" | "agent_offline_detected" | "session_expired";
  message: string;
  data?: Record<string, string | number | boolean | null>;
};
```

## Agent endpoints (auth: `Authorization: Bearer <AGENT_TOKEN>`, compared in constant time)

### `POST /api/agent/sync`

Body: `AgentStatus` without `lastSeen`.

```bash
curl -X POST "$BASE/api/agent/sync" \
  -H "Authorization: Bearer $AGENT_TOKEN" -H "Content-Type: application/json" \
  -d '{"agentId":"vm-1","agentVersion":"0.1.0","hostname":"vm","running":true,
       "url":"https://example-abc.trycloudflare.com","startedAt":1760000000000,
       "lastError":null,"cloudflaredVersion":"2026.9.1"}'
```

`200`:
```json
{ "desired": "running", "expiresAt": 1760014400000, "pollIntervalSeconds": 60, "serverTime": 1760000001234 }
```

Effects: stores the status with the server's `lastSeen`, derives events (started, stopped, URL
changed, error, online), and re-arms the offline alarm. `401` bad token, `400` invalid body or `agentId` mismatch.
The agent may adopt `pollIntervalSeconds`.
`expiresAt` (epoch ms, server time) is when the running session ends, or `null` when stopped. The agent
stops the tunnel itself at that moment, even if it cannot reach the API (it uses `expiresAt - serverTime`
on its own clock).

### `GET /api/agent/ws`

WebSocket upgrade (use `wss://`). `401` bad token, `426` without `Upgrade: websocket`.

- Server → agent: text `{"type":"nudge"}` when the desired state changes. Unknown types must be ignored.
- Agent → server: text `ping` every 30s; the server answers `pong` (without waking the Durable Object).
- A new agent connection closes the older one (code 1000, reason `replaced`).
- The WebSocket never carries state; after a nudge (and after every reconnect) the agent calls `/api/agent/sync`.

## Control endpoints (auth: session cookie `tc_session`)

### `GET /api/control`
```json
{
  "desired": "running",
  "expiresAt": 1760014400000,
  "status": { "...AgentStatus": "or null if never seen" },
  "online": true,
  "pending": false,
  "agentWsConnected": true,
  "serverTime": 1760000001234
}
```
- `online = status !== null && now - status.lastSeen < AGENT_OFFLINE_AFTER_SECONDS`.
- `pending = online && (desired === "running") !== status.running`.

### `PUT /api/control`
Body is one of:

```json
{ "state": "running", "durationHours": 1 }
{ "state": "stopped" }
```

`durationHours` is **required** to start and must be `1`, `2`, `4`, `8` or `12`; anything else is `400 invalid_body`.
The response is the same as `GET`. Starting sets `expiresAt = now + durationHours`; starting again while
running restarts the timer. A change adds a `desired_changed` event and nudges the agent.

**Auto stop:** when `expiresAt` passes, the Durable Object sets the desired state to `stopped` (an alarm,
plus a check on every read/sync, so a late alarm cannot matter), logs a `session_expired` event, and nudges
the agent. Only `stopped` is ever set automatically.

### `GET /api/events?limit=50`
`limit` is 1 to 100 (default 50). Response `{ "events": Event[] }`, newest first.

## Auth endpoints

### `POST /api/auth/login`
Body `{ "password": string }`. `200 { "ok": true }` and a `Set-Cookie`: `tc_session`, `HttpOnly`,
`SameSite=Lax`, `Secure` (on HTTPS), `Path=/`, `Max-Age=43200` (12h).
`401 invalid_credentials` after a fixed 1s delay. `429 rate_limited` after 10 attempts per IP in 15 minutes
(a successful login resets the counter).

```bash
curl -c cookies.txt -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" \
  -d '{"password":"..."}'
curl -b cookies.txt "$BASE/api/control"
```

### `POST /api/auth/logout`
Clears the cookie. `200 { "ok": true }`.

## Health

### `GET /api/health`
No auth, no secrets: `{ "ok": true }`. It works even when the Worker is not configured yet.

## Simulating the agent with curl

Use the `POST /api/agent/sync` example above to appear online, then change the desired state with the
session cookie (`PUT /api/control`) and watch the response of the next sync (`desired`).
