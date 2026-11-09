# Security

This is a test/learning project with a single admin and a Quick Tunnel. Read the caveats before relying on it.

## What is public and what is protected

| Surface | Access |
|---|---|
| The Quick Tunnel URL (`*.trycloudflare.com`) | **Public**: anyone with the URL reaches the demo app on port 8080. It is time-limited (session length) and changes on every start. |
| The SPA files (`/`, JS, CSS) | Public by design; they contain no data and no secrets. |
| `GET /api/health` | Public; returns `{ "ok": true }` only. |
| `POST /api/auth/login`, `/logout` | Public endpoints; login is rate limited. |
| `GET/PUT /api/control`, `GET /api/events` | Session cookie required (checked in a middleware on exactly these routes). |
| `POST /api/agent/sync`, `GET /api/agent/ws` | Bearer `AGENT_TOKEN` required. |

The agent has **no HTTP server**: nothing on the VM listens for control traffic, and the tunnel forwards only to the demo app
on `127.0.0.1:8080`.

## Secrets

- `AGENT_TOKEN`, `ADMIN_PASSWORD`, `SESSION_SECRET` live only as **GitHub Actions secrets** and **Worker secrets**
  (uploaded on every deploy). Locally they are in `web/.dev.vars` (git-ignored). On the VM, `AGENT_TOKEN` is in
  `/etc/tunnel-agent/agent.env` (root:root, mode 600).
- Nothing secret is in `wrangler.jsonc`, the repo, or the client bundle (CI greps the bundle for secret names).
- The agent never logs the token, and a log filter masks it as a second layer.
- Rotate secrets as described in [deployment.md](deployment.md#11-rotating-secrets).

## Authentication

- Secrets and passwords are compared in **constant time** (both sides are hashed with SHA-256, then `crypto.subtle.timingSafeEqual`).
- The session is a signed JWT (HS256, 12h) in a cookie that is `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS.
- **Brute-force protection:** 10 login attempts per IP per 15 minutes (stored in the Durable Object), plus a fixed 1s
  delay on every failure. The IP comes from `CF-Connecting-IP`.
- CSRF: the cookie is `SameSite=Lax` and the API only accepts JSON bodies on state-changing routes.
- Every request body, query string and WebSocket message is validated with zod (strings are length-limited, tunnel URLs must be
  `https://<name>.trycloudflare.com`).

## Time-limited exposure

Starting a tunnel requires a session length (1, 2, 4, 8 or 12 hours). The server stops the session when it ends, and the agent
enforces the same deadline locally if it loses contact with the server. This limits how long the public URL stays open.

## Agent hardening (systemd)

Runs as the dedicated `tunnelagent` user with `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`,
`PrivateDevices`, kernel protections, and a root-owned, read-only code directory. `subprocess` is always called with an
argument list (never `shell=True`).

## Known limitations

- Quick Tunnels have no authentication: anyone who learns the URL can use the app behind it until the session ends.
  Do not point the tunnel at anything sensitive.
- One shared admin password, no per-user accounts or audit history.
- If `AGENT_TOKEN` leaks, anyone can impersonate the agent (set the reported URL/status, read the desired state). Rotate it.
- Dependencies are not pinned by hash; run `npm audit` / `pip-audit` before relying on this.

## Recommended next step

For anything beyond testing: a **named tunnel** with a domain and **Cloudflare Access** in front of both the Worker and the tunnel.
