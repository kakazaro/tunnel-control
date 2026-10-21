# Development Plan: Tunnel Control (Python Agent + Vite/React on Cloudflare Workers)

> **Instructions for the AI agent (Claude Code):**
> You are building this project from scratch in a single repository. Read this whole document before writing any code. Work **phase by phase**, in order. At the end of each phase, run the checks listed under "Acceptance criteria", summarize what you did, and wait for confirmation before starting the next phase.
> If something in this plan is ambiguous, conflicts with the installed library versions, or seems wrong, **stop and ask** instead of guessing. Never commit secrets. Keep documentation in sync with the code at all times.

---

## 1. Context

- A Linux VM (RHEL/CentOS-family, uses `yum`/`dnf` and `systemd`) sits in a **private network**. It has **no inbound access** from the Internet, but it **can make outbound HTTPS requests** (possibly through a corporate proxy).
- `cloudflared` is already installed on the VM at `/usr/bin/cloudflared`. A token-based `cloudflared` systemd service also exists, but **this project does not touch it**.
- The user has **no domain**, so this project uses **Cloudflare Quick Tunnels**: `cloudflared tunnel --url http://localhost:8080`, which gives a random `https://*.trycloudflare.com` URL.
- Goal: a **web app on Cloudflare Workers** (free plan, `*.workers.dev` URL) lets the user **start/stop** the Quick Tunnel on the VM and see its status and current public URL.
- Because the VM can't receive inbound requests, a **Python agent** on the VM connects **outbound**:
    - It **syncs** over HTTPS (`POST /api/agent/sync`): it sends the current status and gets back the desired state.
    - It also keeps a **WebSocket** open to the Worker. The WebSocket carries only a "wake up" **nudge** when the desired state changes, so the agent syncs immediately instead of waiting.
    - If the WebSocket can't connect (for example, a proxy blocks it), the agent falls back to **polling every 60s**. Nothing else changes.
- Everything runs on Cloudflare: no Vercel, no Redis. State lives in a **Durable Object**.
- This is a **test/learning project**. Keep it simple, readable, and well documented. Avoid over-engineering, but don't cut corners on security basics.

## 2. Goals and non-goals

### Goals
1. The web UI shows: agent online/offline, the agent's channel (WebSocket or polling), desired state, actual state, tunnel URL, last seen time, last error, recent events.
2. The web UI can set the desired state to `running` or `stopped`.
3. The Python agent reconciles the actual state with the desired state. It starts, stops, or restarts `cloudflared`, and reports the new URL. With the WebSocket connected, a UI click reaches the agent within about a second.
4. **Every push to `main` on GitHub runs CI and, if it passes, deploys the web app to Cloudflare automatically.**
5. Both parts are deployable by following a step-by-step guide (`docs/deployment.md`).
6. The repo contains `CLAUDE.md` and `docs/` so that future AI agents and humans can maintain the code.

### Non-goals (for now)
- Named tunnels, custom domains, Cloudflare Access.
- Real-time push to the **browser**. The dashboard uses SWR polling every 5s (shorter than cloudflared's own startup time).
- Sending state over the WebSocket. It only carries nudges; HTTPS sync stays the single state protocol.
- Multi-user accounts or roles. A single admin password is enough.
- Managing multiple VMs in the UI. Use one Durable Object per `agentId` so this is easy to add later, but build the UI for one agent.
- Automatic agent updates from CI. GitHub can't reach the private VM; the agent is updated with `scripts/update-agent.sh`.
- Server-side rendering. The dashboard is behind a login, so a static SPA is enough.

## 3. Architecture

```
Browser (admin)
   │  HTTPS (session cookie), SWR polling every 5s
   ▼
Cloudflare Worker (tunnel-control.<subdomain>.workers.dev)
   ├── static assets: Vite + React SPA (public, contains no secrets)
   └── /api/* (Hono) ──► Durable Object "AgentHub" (one instance per agentId, SQLite storage)
   ▲      ▲                - desired state, last reported status, events (capped at 100)
   │      │                - holds the agent's WebSocket (Hibernation API), sends nudges
   │      │                - alarm for offline detection
   │      │  WSS /api/agent/ws (Bearer AGENT_TOKEN): server → agent {"type":"nudge"}
   │  HTTPS POST /api/agent/sync (Bearer AGENT_TOKEN): request = status, response = desired
   │
Python agent on VM (systemd service)
   │  subprocess
   ▼
cloudflared tunnel --url http://localhost:8080  ──► Cloudflare edge ──► public *.trycloudflare.com
   │
   ▼
Demo app on localhost:8080 (separate systemd service, for testing)

GitHub (push to main) ──► GitHub Actions: CI ──► wrangler deploy (Worker + assets + secrets)
```

### Core design rules
- **Desired-state model, not one-off commands.** The UI writes `desired = running | stopped`. The agent makes reality match on every sync. This is safe to repeat, survives missed syncs, and restarts a crashed tunnel automatically.
- **One round trip per sync.** The agent POSTs its status, and the response contains the desired state.
- **The WebSocket is an optimization, never a requirement.** It only triggers an early sync. Losing it changes latency, not behavior.
- **The server owns time.** `lastSeen` is set by the server, never trusted from the agent.
- **Online detection:** the agent counts as online if `now - lastSeen < AGENT_OFFLINE_AFTER_SECONDS` (default 150s = 2.5 × the 60s poll interval). A Durable Object alarm emits the offline event at the right moment.
- **Control endpoints are never exposed through the tunnel.** The agent has no HTTP server. The tunnel forwards only to the demo app on port 8080.

## 4. Repository layout

Create exactly this structure. Adjust only if a tool requires it, and explain why.

```
.
├── CLAUDE.md                     # Guide for AI agents (see section 10)
├── README.md                     # Project overview + quick links to docs
├── CHANGELOG.md                  # Keep a Changelog format
├── .gitignore
├── .editorconfig
├── .github/
│   └── workflows/
│       └── ci.yml                # CI for web + agent + scripts; deploy job on push to main
├── docs/
│   ├── architecture.md           # Diagrams, data flow, design decisions
│   ├── api.md                    # HTTP + WebSocket API contract
│   ├── development.md            # Local setup and running both parts locally
│   ├── deployment.md             # Step-by-step deploy: Cloudflare + GitHub + VM
│   ├── operations.md             # Runbook: logs, restart, update, rotate secrets, troubleshooting
│   ├── security.md               # Threat model, secrets, what is public
│   ├── design.md                 # Visual language: tokens, motion, components (section 6.8)
│   └── decisions/                # ADRs (Architecture Decision Records)
│       ├── 0001-desired-state-sync-with-ws-nudge.md
│       ├── 0002-durable-object-storage.md
│       ├── 0003-quick-tunnel-no-domain.md
│       └── 0004-cloudflare-workers-vite-spa.md
├── web/                          # Cloudflare Worker + Vite/React SPA (one deployable unit)
│   ├── package.json
│   ├── wrangler.jsonc            # Worker, assets, Durable Object binding + migration, vars
│   ├── vite.config.ts            # @cloudflare/vite-plugin + React + Tailwind
│   ├── vitest.config.ts          # Two projects: worker (pool-workers) and client (jsdom)
│   ├── tsconfig.json             # (plus per-target tsconfigs if the template needs them)
│   ├── index.html
│   ├── .dev.vars.example         # Local secrets for `npm run dev`
│   ├── src/
│   │   ├── shared/
│   │   │   └── schemas.ts                # zod schemas + types shared by Worker and UI
│   │   ├── worker/
│   │   │   ├── index.ts                  # Hono app: routes, auth middleware, exports AgentHub
│   │   │   ├── agent-hub.ts              # Durable Object class (storage, events, WS, alarm)
│   │   │   ├── auth.ts                   # Session sign/verify (jose), constant-time compare
│   │   │   └── env.ts                    # Validated env/secrets (zod)
│   │   └── client/
│   │       ├── main.tsx                  # React root + SWRConfig provider
│   │       ├── App.tsx                   # The single page: deck + locked/unlocked state
│   │       ├── components/               # UI components
│   │       │   └── fx/                   # Visual effects (HoloPanel, ScrambleText, GridBackground…)
│   │       ├── styles/
│   │       │   ├── tokens.css            # Design tokens (CSS variables), the only place for raw colors
│   │       │   └── effects.css           # Ambient keyframes: grid, scanlines, glow, glitch
│   │       ├── hooks/                    # SWR hooks (useControl, useSetDesired, useEvents) + useEffectsLevel
│   │       └── lib/
│   │           ├── http.ts               # Axios instance + interceptors
│   │           └── fetcher.ts            # SWR fetcher using Axios
│   └── tests/
│       ├── worker/                       # Runs inside workerd (@cloudflare/vitest-pool-workers)
│       └── client/                       # jsdom
├── agent/                        # Python agent
│   ├── pyproject.toml
│   ├── requirements.txt          # Pinned runtime deps (for simple VM install)
│   ├── requirements-dev.txt
│   ├── .env.example
│   ├── src/
│   │   └── tunnel_agent/
│   │       ├── __init__.py       # __version__
│   │       ├── __main__.py       # python -m tunnel_agent
│   │       ├── config.py         # Env loading + validation
│   │       ├── tunnel.py         # QuickTunnel process manager
│   │       ├── client.py         # HTTP client for /api/agent/sync
│   │       ├── nudge.py          # WebSocket listener thread for /api/agent/ws
│   │       ├── reconciler.py     # Desired vs actual logic + backoff
│   │       └── logging_setup.py
│   ├── demo_app/
│   │   └── server.py             # Tiny HTTP app on 127.0.0.1:8080 for testing
│   └── tests/                    # pytest
├── deploy/
│   ├── systemd/
│   │   ├── tunnel-agent.service
│   │   └── tunnel-demo-app.service
│   ├── tunnel-agent.env.example
│   └── sysctl/99-quic.conf       # Optional UDP buffer tuning
└── scripts/
    ├── install-agent.sh          # Idempotent VM installer (venv, env file, systemd)
    ├── update-agent.sh           # Pull + reinstall + restart
    └── gen-secret.sh             # openssl rand -hex 32
```

## 5. Tech stack and versions

### Web (`web/`)
- **Vite + React + TypeScript (strict)**, latest stable versions. Scaffold with `npm create cloudflare@latest` (React framework template), which sets up **`@cloudflare/vite-plugin`** so the SPA and the Worker build and run together (`vite dev` runs the Worker in workerd).
- **Worker API:** **Hono**, on the Workers runtime. Use Workers RPC to call the Durable Object (a class that extends `DurableObject`).
- **Static assets:** served by the same Worker (`assets` in `wrangler.jsonc`, `not_found_handling: "single-page-application"`, `run_worker_first: ["/api/*"]`).
- **Data fetching in the UI: SWR + Axios (required).**
    - `src/client/lib/http.ts`: one Axios instance (`baseURL: "/api"`, `withCredentials: true`, timeout 10s). Add a response interceptor that turns errors into a typed `ApiError { status, message }`. On `401`, emit a "session lost" signal that switches the page to its **locked** state (section 6.6), **except for requests to `/auth/*`** (a wrong password returns 401 and must show "ACCESS DENIED" in the lock panel instead).
    - `src/client/lib/fetcher.ts`: `const fetcher = (url) => http.get(url).then(r => r.data)`.
    - Use `useSWR` for reads and `useSWRMutation` for writes. Never call `fetch` directly in components.
    - Wrap the app in an `SWRConfig` provider with the global fetcher, `revalidateOnFocus: true`, and a sensible `dedupingInterval`.
- **No router library, one page.** Everything lives at `/`. The page is either **locked** (no session) or **unlocked**; login is a state of the same page, not a separate route.
- **Validation:** `zod`, for every request body, every WebSocket message, and for env/secrets.
- **Storage:** Durable Object built-in SQLite storage (`ctx.storage.sql`). Use the SQLite backend (`new_sqlite_classes` migration); it is required on the Workers Free plan. No KV, no Redis.
- **Auth:** `jose` for a signed JWT in an httpOnly cookie. Constant-time comparison with `crypto.subtle.timingSafeEqual` (a Workers runtime extension) on equal-length SHA-256 digests.
- **Styling:** Tailwind CSS (via `@tailwindcss/vite`), themed from the tokens in section 6.8. No heavy UI kit.
- **Motion and visuals:** `motion` (Motion for React) for enter/exit, layout and gesture animation; plain CSS keyframes for ambient loops. `lucide-react` for SVG icons (no emoji icons). Fonts: Orbitron (display) + JetBrains Mono (everything else), self-hosted with `@fontsource` packages so the page makes no third-party requests.
- **Design process:** use the `ui-ux-pro-max` skills (`design`, `design-system`, `ui-styling`) to finalize tokens and component specs before building UI (Phase 3).
- **Testing:** Vitest. Worker tests use `@cloudflare/vitest-pool-workers` (real Durable Objects in workerd, no mocks). Client tests use jsdom. Use the Vitest version that the pool supports.
- **Lint/format:** ESLint (typescript-eslint + react-hooks) + Prettier.
- **Deploy tool:** `wrangler` (dev dependency, used by CI).
- **Package manager:** npm. Use Node.js 20 LTS or newer.

### Agent (`agent/`)
- **Python 3.9+**, tested on 3.9 and 3.11. The VM's default `python3` may be 3.6, so the deployment guide must install a newer Python.
- **Runtime dependencies:** `requests` and `websocket-client` only. Use the standard library for everything else.
- **Dev dependencies:** `pytest`, `ruff` (lint + format), `mypy` (optional, but preferred).
- No async framework is needed. The WebSocket runs in a daemon thread.

## 6. Web app specification

### 6.1 Configuration (`wrangler.jsonc` vars + secrets)
| Name | Kind | Required | Description |
|---|---|---|---|
| `AGENT_TOKEN` | secret | yes | Shared secret for the agent (≥ 32 chars) |
| `ADMIN_PASSWORD` | secret | yes | Password for the dashboard (≥ 12 chars) |
| `SESSION_SECRET` | secret | yes | Secret used to sign the session JWT (≥ 32 chars) |
| `AGENT_ID` | var | no | Default `vm-1` |
| `POLL_INTERVAL_SECONDS` | var | no | Default `60`. Returned to the agent as `pollIntervalSeconds`. |
| `AGENT_OFFLINE_AFTER_SECONDS` | var | no | Default `150` |

- **Secrets** are never in `wrangler.jsonc` or the repo.
    - In production they are GitHub Actions secrets that the deploy job uploads to the Worker on every deploy (section 11), so GitHub is the single source of truth.
    - Locally they live in `web/.dev.vars` (gitignored; `.dev.vars.example` is committed).
- Validate with zod in `src/worker/env.ts` (parse once per isolate and cache). If a secret is missing or invalid, every API route returns `500 { error: { code: "misconfigured" } }` and logs a clear message. Never echo secret values.
- The SPA bundle is public. It must never contain secrets or env values.

### 6.2 Data model (one Durable Object instance per agent, `idFromName(agentId)`)
SQLite tables inside `AgentHub`:
```
kv(key TEXT PRIMARY KEY, value TEXT)   -- "desired" -> Desired JSON, "status" -> AgentStatus JSON,
                                       -- "wasOnline" -> "1" | "0"
events(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, type TEXT, message TEXT, data TEXT)
                                       -- trimmed to the newest 100 after each insert
rate_limits(key TEXT PRIMARY KEY, count INTEGER, window_start INTEGER)
```
The login rate limiter uses a separate instance of the same class, named `auth` (`idFromName("auth")`), so it doesn't depend on any agent.

```ts
type Desired = { state: "running" | "stopped"; updatedAt: number };

type AgentStatus = {
  agentId: string;
  agentVersion: string;
  hostname: string;
  running: boolean;
  url: string | null;
  startedAt: number | null;      // epoch ms, when the current tunnel started
  lastError: string | null;
  cloudflaredVersion: string | null;
  lastSeen: number;              // set by the SERVER
};

type Event = {
  at: number;                    // epoch ms (server time)
  type: "desired_changed" | "tunnel_started" | "tunnel_stopped" | "url_changed"
      | "agent_error" | "agent_online" | "agent_offline_detected";
  message: string;
  data?: Record<string, unknown>;
};
```

The server derives events by comparing the previous status with the new one on each sync. Examples: `running` goes from false to true, the URL changes, or a new `lastError` appears.

**Online/offline events:**
- On every sync, set the Durable Object alarm to `lastSeen + AGENT_OFFLINE_AFTER_SECONDS`.
- `alarm()`: if the agent is now offline and `wasOnline` is `1`, add `agent_offline_detected` and set `wasOnline = 0`.
- On a sync while `wasOnline` is `0` (including the first sync ever), add `agent_online` and set `wasOnline = 1`.

### 6.3 Durable Object interface (`AgentHub`, called through Workers RPC)
```ts
class AgentHub extends DurableObject {
  getDesired(): Promise<Desired>;                       // default { state: "stopped" }
  setDesired(state): Promise<Desired>;                  // adds desired_changed, sends nudge
  sync(status: Omit<AgentStatus, "lastSeen">): Promise<{ desired: Desired }>; // sets lastSeen, derives events, sets alarm
  getControl(): Promise<{ desired, status, agentWsConnected: boolean }>;
  listEvents(limit): Promise<Event[]>;                  // newest first
  hitRateLimit(key, limit, windowSeconds): Promise<{ allowed: boolean; remaining: number }>;
  fetch(request): Promise<Response>;                    // WebSocket upgrade only
  webSocketMessage / webSocketClose / alarm             // runtime handlers
}
```
- The Worker validates input and auth; the Durable Object assumes valid input and owns storage.
- Only `agent-hub.ts` touches `ctx.storage`.

### 6.4 API contract (document it fully in `docs/api.md`)
All JSON responses send `Cache-Control: no-store`. Errors use the shape `{ error: { code: string, message: string } }`.

1. **`POST /api/agent/sync`** (auth: `Authorization: Bearer <AGENT_TOKEN>`, compared in **constant time**)
    - Body: `AgentStatus` without `lastSeen` (validated with zod, URL must match `^https://[a-z0-9-]+\.trycloudflare\.com$` or be null, strings length-limited).
    - Effect: stores the status with the server `lastSeen`, appends derived events, and resets the offline alarm.
    - Response `200`: `{ desired: "running" | "stopped", pollIntervalSeconds: number, serverTime: number }`. The agent may adopt `pollIntervalSeconds`, so the server can tune polling.
    - `401` for a bad token, `400` for an invalid body.
2. **`GET /api/agent/ws`** (auth: Bearer `AGENT_TOKEN`, header `Upgrade: websocket`)
    - The Worker checks the token, then forwards the request to the Durable Object, which accepts it with the **WebSocket Hibernation API** (`ctx.acceptWebSocket(ws, ["agent"])`).
    - Server → agent messages: `{"type":"nudge"}` (sent by `setDesired`). The agent ignores unknown message types.
    - Keepalive: the agent sends the text `ping` every 30s; the Durable Object answers `pong` with `setWebSocketAutoResponse`, so idle connections don't wake it up.
    - A new agent connection closes any older one (code 1000, reason `"replaced"`).
    - `401` for a bad token, `426` without an upgrade header.
3. **`GET /api/control`** (auth: session)
    - Response: `{ desired, status: AgentStatus | null, online: boolean, pending: boolean, agentWsConnected: boolean, serverTime }`.
    - `online = status !== null && now - status.lastSeen < AGENT_OFFLINE_AFTER_SECONDS × 1000`.
    - `pending = online && (desired === "running") !== status.running`.
4. **`PUT /api/control`** (auth: session)
    - Body: `{ state: "running" | "stopped" }`. Response: same shape as GET. Adds a `desired_changed` event and nudges the agent.
5. **`GET /api/events?limit=50`** (auth: session, `limit` 1–100, default 50) returns `{ events: Event[] }`.
6. **`POST /api/auth/login`** with body `{ password }`.
    - Compare in constant time. On success, set an httpOnly, SameSite=Lax cookie with a signed JWT (expires in 12h). Set `Secure` when the request is HTTPS (always true on `workers.dev`; false only for local `http://localhost`).
    - Brute-force protection: 10 attempts per 15 minutes per IP, using `hitRateLimit` on the `auth` instance. The IP comes from the `CF-Connecting-IP` header. On failure, wait a fixed 1s before answering (a timer, so it doesn't use CPU time). `429` when the limit is hit.
    - `401` for a wrong password.
7. **`POST /api/auth/logout`** clears the cookie.
8. **`GET /api/health`** returns `{ ok: true }`. No auth, and no secrets in the response.

### 6.5 Route protection
- Protected APIs: `/api/control` and `/api/events`. A Hono middleware on exactly these routes verifies the session with the helper from `worker/auth.ts` and returns `401` JSON otherwise.
- `/api/agent/*`, `/api/auth/*`, and `/api/health` must **not** require a session (the agent routes use the Bearer token instead).
- Static assets (`/`, JS/CSS) are public by design and contain no data. When an API call returns `401`, the page switches to its locked state.

### 6.6 UI: one single page (`/`)
Login, control, and status all live on **one page**, the command deck. It has two states:
- **Locked** (no valid session; detected when `GET /api/control` returns 401):
    - The deck is visible but dormant: the panels are dimmed, blurred, and show "NO SIGNAL" placeholders. No agent data is fetched or shown.
    - A **lock panel** ("ACCESS TERMINAL") floats over the reactor with a password field and submit (Axios → `POST /api/auth/login`), and shows errors there (wrong password, the 429 message).
- **Unlocked:** after a successful login, the lock panel dissolves and the deck **powers up in place** (no navigation, no page reload); SWR starts fetching. **Logout** (or any 401) powers the deck back down into the locked state and clears the SWR cache.

The unlocked deck contains:
- **Status card:**
    - Agent online/offline badge, last seen shown as relative time ("12s ago").
    - Channel badge: "Live (WebSocket)" when `agentWsConnected`, otherwise "Polling (up to ~60s)".
    - Desired state, actual state, and a "Pending…" indicator when `pending`.
- **Tunnel card:** current URL as a link, a **Copy** button, the tunnel uptime (from `startedAt`), and the cloudflared version.
- **Controls:**
    - One **power control** (the "reactor core", section 6.8) that toggles between Start and Stop, using `useSWRMutation` → `PUT /api/control`. It's a real `<button>` with `aria-pressed` and a visible text label ("ENGAGE" / "DISENGAGE").
    - Use an optimistic update of `desired`, then revalidate.
    - While the mutation runs, the button is disabled and shows its charging animation.
- **Error banner** for `lastError` and for API errors.
- **Events list:** the latest 20 events, using `useSWR("/events?limit=20")`.
- **Refresh:**
    - `useSWR("/control", { refreshInterval: 5000 })`.
    - Pause the refresh when the tab is hidden (SWR's default behavior is fine). Show a stale-data indicator if the last fetch failed.
- **Header:** app name, the effects toggle, and a **Logout** button (only when unlocked).
- **Notice text** on the dashboard: "Quick Tunnel URLs are public and change on every restart. Anyone with the URL can reach the app on port 8080."
- **Accessibility and UX:** use semantic HTML and visible focus states, and make the layout work on mobile. Show times in the browser's local timezone.
- **Component split (suggested):** `StatusCard`, `TunnelCard`, `ReactorButton`, `EventList`, `ErrorBanner`, `Header`, plus effect primitives in `components/fx/`. Data hooks go in `src/client/hooks/`: `useControl()`, `useSetDesired()`, `useEvents()`.

### 6.8 Visual design and motion: "Holo-HUD control deck"
The user explicitly wants a **fancy, surprising, futuristic** UI: neon, holographic, lots of motion. Treat this as a requirement, not polish. The direction combines the *HUD / Sci-Fi FUI* and *Cyberpunk UI* styles: a dark command deck with floating holographic glass panels, neon light, and purposeful motion. It must still be readable, accessible, and fast.

**Design tokens** (`styles/tokens.css`; components never use raw hex, only tokens or Tailwind theme names mapped to them):
| Token | Value | Use |
|---|---|---|
| `--bg` | `#05060F` | Page background (deep space) |
| `--surface` | `rgb(16 20 44 / 0.55)` + `backdrop-filter: blur(14px)` | Holographic glass panels |
| `--line` | `rgb(0 229 255 / 0.25)` | Panel borders, grid lines |
| `--neon-cyan` | `#00E5FF` | Primary: focus, links, active glow |
| `--neon-magenta` | `#FF2BD6` | Accent: the power control, highlights |
| `--neon-violet` | `#7C3AED` | Gradients, ambient nebula |
| `--ok` | `#39FF88` | Online, running |
| `--warn` | `#FFB020` | Pending |
| `--danger` | `#FF3B5C` | Offline, errors |
| `--text` | `#E6F1FF` | Body text |
| `--text-muted` | `#8A9BC2` | Secondary text |
| `--glow-sm/md/lg` | layered `box-shadow` / `text-shadow` in the current color | Neon glow levels |

- **Typography:** Orbitron 700/900 for the logo, headings, and big numbers (uptime, state), uppercase with wide letter spacing. JetBrains Mono for everything else (body, URL, logs). Body ≥ 16px, line height 1.5. Numbers use `font-variant-numeric: tabular-nums` so counters don't jitter.
- **Background (ambient, CSS only):**
    - A slow-drifting nebula of radial gradients (violet/cyan/magenta, 20–40s loops).
    - A perspective neon **grid floor** at the bottom of the viewport that scrolls slowly toward the viewer.
    - A very faint **scanline** overlay (opacity ≤ 0.06) and film-grain noise.
- **Holo panels** (`HoloPanel`): glass surface, chamfered corners (`clip-path`), animated **corner brackets**, a thin border with a slowly rotating conic-gradient sheen, and a **cursor spotlight** (a radial glow that follows the pointer). Subtle 3D tilt toward the pointer (max 4°) on desktop pointers only.
- **Signature components:**
    - **Reactor core (`ReactorButton`):** a large circular power control in the center of the deck.
        - *Stopped:* dim magenta core, slowly "breathing".
        - *Pending/charging:* orbital rings spin up and a progress arc sweeps around ("ESTABLISHING LINK…").
        - *Running:* bright core, two counter-rotating rings, a soft pulse every few seconds.
        - *Click:* a shockwave ripple and a brief scale press.
    - **Status card:** an online badge with a radar-ping ring (green) or a red flicker when offline; a **signal-bars** animation for "LIVE LINK" (WebSocket) versus a plain "POLLING" badge; last seen as a ticking relative time.
    - **Tunnel card:** when the URL appears or changes, it **decrypts** (scramble text effect, ~600ms) into place. The Copy button flashes "COPIED" with a holographic toast. Uptime is a live ticking HH:MM:SS counter.
    - **Event stream:** a terminal-style log. New rows slide in from the top with a short glow and a typewriter reveal; each type has its own color and icon.
    - **Error banner:** a red alert strip with a brief glitch on entry, then static.
    - **Lock panel ("ACCESS TERMINAL"):** a holo panel over the dormant reactor, with a short boot sequence typed out line by line and a password field with a neon underline.
- **Every action has its own animation** (on the same page, never a page change):

| Action / event | Animation |
|---|---|
| Page load (locked) | Grid floor and nebula fade in; the dormant deck flickers on like a CRT; the lock panel types its boot lines |
| Typing the password | Each keystroke pulses the underline; a faint scan sweeps the field |
| Submit (waiting) | The submit button becomes a spinning scanner ring; "AUTHENTICATING…" |
| Wrong password / 429 | Panel shake + short glitch + red "ACCESS DENIED" (or "LOCKED OUT · RETRY IN …" countdown) |
| Login success | "ACCESS GRANTED" in green, the lock panel splits and dissolves into particles of light, a horizontal scan wipe passes over the deck, panels power up one by one (stagger, ≤ 1.2s), numbers count up to their values |
| Data refresh (every 5s) | A tiny sync blip on the header indicator only; values that changed flash softly; nothing else moves |
| Agent goes online | Radar ping on the badge, the status card border lights up green once |
| Agent goes offline | Badge flickers red, the card's glow drains away, a "SIGNAL LOST" stamp glitches in |
| WebSocket link up / down | Signal bars climb up / drop down; badge morphs between "LIVE LINK" and "POLLING" |
| Click ENGAGE (start) | Shockwave ripple from the reactor, rings spin up, progress arc sweeps; "ESTABLISHING LINK…" while `pending` |
| Tunnel started (URL arrives) | Reactor flares bright, a beam travels from the reactor to the tunnel card, the URL **decrypts** into place, uptime starts ticking |
| URL changed | The old URL glitches out, the new one decrypts in |
| Click DISENGAGE (stop) | Rings slow down and collapse inward, the core dims, a power-down sweep goes over the tunnel card; URL fades to "OFFLINE" |
| Copy URL | Button flashes "COPIED", a holographic toast floats up and fades |
| New event in the log | Row slides in from the top with a typewriter reveal and a short glow in its type's color |
| Error (API or `lastError`) | Red alert strip glitches in once, then stays static until resolved; resolving slides it away |
| Stale data (fetch failed) | Panels get a slight static/noise overlay and a "STALE" tag until the next success |
| Logout / session lost | Panels power down in reverse stagger, the deck dims, the lock panel re-forms from light |
| Toggle effects level | Brief crossfade between full and reduced styling |
- **Motion rules:**
    - Micro-interactions 150–250ms; panel enter/exit 400–600ms with spring easing; ambient loops 6–40s.
    - Animate only `transform`, `opacity`, and `filter`. Never animate layout properties.
    - Motion must mean something: state changes get the strongest motion; idle motion stays subtle so it doesn't distract.
    - Pause ambient loops when the tab is hidden (a `data-hidden` attribute driven by `visibilitychange`).
- **Accessibility (non-negotiable):**
    - `prefers-reduced-motion: reduce` turns off tilt, glitch, scramble, particles, shake, scanlines, the grid scroll, and the power-up stagger; every action in the table above falls back to a short fade or color change. An in-app **"Effects: Full / Reduced"** toggle in the header does the same and is saved in `localStorage` (`useEffectsLevel`).
    - Text contrast ≥ 4.5:1. Neon colors are for accents and glow; body text is `--text`.
    - Nothing flashes more than 3 times per second. Glitch effects last ≤ 300ms and never hide essential text.
    - State is never conveyed by color alone: always an icon and a text label too.
    - Visible focus: a 2px `--neon-cyan` outline with glow on every focusable element. Full keyboard support.
    - Touch targets ≥ 44×44px.
- **Full-screen layout:** the page is one full-viewport command deck (`height: 100dvh`, edge to edge, no centered "website" column, no page scroll from 768px up). A CSS grid places the header strip on top, the reactor in the center, and the status, tunnel, and event panels around it; the event log scrolls inside its own panel. A header button enters/exits true full screen with the native Fullscreen API (hidden where unsupported).
- **Responsive:** works at 375px, 768px, 1024px, and 1440px. Below 768px the deck becomes a vertical stack (reactor on top) and the page may scroll; tilt/spotlight are disabled.
- **Performance budget:**
    - Initial JS ≤ 200 KB gzipped; fonts subset to Latin.
    - Lighthouse (mobile) Performance ≥ 85 and Accessibility ≥ 95 on the deployed dashboard.
    - At most two elements with `backdrop-filter` blur per viewport section; no canvas or WebGL in this version.
- `docs/design.md` documents the tokens, the component behaviors above, and the motion and accessibility rules.

### 6.7 Cloudflare specifics
- Worker name: `tunnel-control`. URL: `https://tunnel-control.<subdomain>.workers.dev`.
- `wrangler.jsonc` declares the `AGENT_HUB` Durable Object binding and the migration `{ "tag": "v1", "new_sqlite_classes": ["AgentHub"] }`. Never edit an applied migration; add a new tag instead.
- Stay within the **Workers Free** limits (check the current numbers on Cloudflare's pricing page): every request must use only a few ms of CPU. No password hashing loops; the 1s login delay is a timer, not CPU.
- `wrangler.jsonc` sets a `compatibility_date` and enables `observability` (Workers Logs) so `console.log` output is visible in the dashboard.

---

## 7. Python agent specification

### 7.1 Configuration (environment variables, `agent/.env.example` and `deploy/tunnel-agent.env.example`)
| Name | Default | Description |
|---|---|---|
| `CONTROL_BASE_URL` | (required) | e.g. `https://tunnel-control.<subdomain>.workers.dev`. The agent uses `/api/agent/sync` and `/api/agent/ws` (wss) under it. |
| `AGENT_TOKEN` | (required) | Same value as the Worker secret |
| `AGENT_ID` | `vm-1` | Must match the Worker `AGENT_ID` |
| `POLL_INTERVAL_SECONDS` | `60` | The server may override it with `pollIntervalSeconds`. Clamp to 10–300. |
| `ENABLE_WEBSOCKET` | `true` | Set `false` to use polling only (for example, if the proxy blocks WebSockets) |
| `TUNNEL_TARGET_URL` | `http://localhost:8080` | What the Quick Tunnel forwards to |
| `CLOUDFLARED_BIN` | `/usr/bin/cloudflared` | Path to the binary (tests point this to a fake) |
| `TUNNEL_PROTOCOL` | `auto` | `auto`, `quic`, or `http2`. Use `http2` if outbound UDP 7844 is blocked. |
| `TUNNEL_METRICS` | `127.0.0.1:20241` | Fixed metrics address, so `operations.md` can document one URL |
| `TUNNEL_START_TIMEOUT_SECONDS` | `30` | Time to wait for the URL to appear in the logs |
| `HTTP_TIMEOUT_SECONDS` | `15` | Timeout for calls to the control API |
| `LOG_LEVEL` | `INFO` | |

- Validate at startup. Exit with a clear error message if a value is missing or invalid. `CONTROL_BASE_URL` must be `https://` (allow `http://localhost` for development).
- `requests` automatically uses `HTTPS_PROXY`/`NO_PROXY` if the VM needs a corporate proxy. Pass the same proxy to `websocket-client` explicitly (parse `HTTPS_PROXY` in `config.py`; check how the installed version handles proxies). Document this.
- **Never log `AGENT_TOKEN`**, not even partially.

### 7.2 `tunnel.py`: `QuickTunnel` process manager
- Start with `subprocess.Popen` using an **argument list** (never `shell=True`):
  `[bin, "tunnel", "--no-autoupdate", "--metrics", metrics, "--url", target, ("--protocol", proto if not auto)]`
- `stdout=DEVNULL` and `stderr=PIPE` (text mode, line-buffered). A **daemon reader thread** must always drain stderr, to keep the pipe from filling up.
    - The reader extracts the first URL that matches `https://[a-z0-9-]+\.trycloudflare\.com`.
    - It also keeps the last 50 log lines in a ring buffer (`collections.deque`), for error reporting.
- **No `preexec_fn` / `PR_SET_PDEATHSIG`.** `preexec_fn` is unsafe when threads are running, and systemd's `KillMode=control-group` already kills `cloudflared` when the agent stops. Keep the default `start_new_session=False` so it stays in the agent's cgroup.
- `start()`:
    - Wait up to the start timeout for the URL. On timeout or early exit, kill the process.
    - Raise `TunnelStartError` with the last few log lines.
    - Record `started_at` (epoch ms).
- `stop()`: send SIGTERM, wait up to 10s, then SIGKILL. Reset `url` and `started_at`.
- `is_running()`: uses `proc.poll() is None`.
- If the process dies unexpectedly, `is_running()` becomes False. The reconciler then restarts it.
- `cloudflared_version()`: run `cloudflared --version` once, cache the result, and return `None` on failure.
- Thread-safe: protect start and stop with a lock.

### 7.3 `client.py`: control API client
- Use a `requests.Session` with the `Authorization: Bearer` header and a `User-Agent: tunnel-agent/<version>` header.
- `sync(status) -> SyncResponse(desired, poll_interval_seconds, server_time)`.
- Raise typed errors: `AuthError` (401/403), `ServerError` (5xx, network errors, timeouts), and `ProtocolError` (a response that doesn't validate).

### 7.4 `nudge.py`: WebSocket listener
- A daemon thread that connects to `wss://<base>/api/agent/ws` with the `Authorization: Bearer` and `User-Agent` headers, using `websocket-client`.
- On `{"type":"nudge"}`: set the reconciler's `wake` event (a shared `threading.Event`). It never changes tunnel state itself.
- Send `ping` every 30s. Treat no `pong` within 10s as a dead connection.
- On disconnect or connect failure: reconnect with exponential backoff (5s, 10s, 20s… capped at 5 min), and log at WARNING once per failure streak (not on every retry). On a 401 handshake, log the same "AGENT_TOKEN mismatch?" hint as the sync client.
- After every successful (re)connect, set `wake` once, so the agent catches any desired-state change it missed while disconnected.
- Expose `connected: bool` for logging. Disabled entirely when `ENABLE_WEBSOCKET=false`.

### 7.5 `reconciler.py`: main loop
On each tick:
1. Build the status (`running`, `url`, `startedAt`, `lastError`, `hostname`, `agentVersion`, `cloudflaredVersion`).
2. Call `sync`, and get `desired` back.
3. Reconcile:
    - `desired=running` and not running: start (unless the start backoff is active).
    - `desired=stopped` and running: stop.
    - Otherwise: nothing to do.
4. If the actual state or URL changed, **sync again immediately**, so the UI gets the new URL without waiting a full interval.
5. Wait for `interval ± 10% jitter` using `wake.wait(timeout)` (then clear `wake`). A nudge or a shutdown signal ends the wait early, so both are instant.

The loop runs on the main thread. `start()` and `stop()` are only called from it.

Failure handling:
- **Start failures:**
    - The backoff is a gate: after a failure, skip start attempts until `next_start_allowed_at`. Ticks still happen at the normal interval (and on nudges), so status keeps flowing.
    - Delays: 60s, 120s, 240s, then capped at 300s.
    - Put the error in `lastError`.
    - Reset the backoff after a successful start, or when desired becomes `stopped`.
- **Control API unreachable:**
    - Keep the current tunnel state (documented behavior), log a warning, and retry on the next tick.
- **Auth error:** log an ERROR with a clear hint ("AGENT_TOKEN mismatch?") and keep retrying at the normal interval. Don't crash-loop.
- **SIGTERM/SIGINT:**
    - Set `wake`, stop the tunnel, close the WebSocket, then send a best-effort final sync with `running=false` (2s timeout).
    - Exit with code 0.

### 7.6 Logging
- Log to stdout/stderr with `logging`. systemd and journald collect it.
- Format: `%(asctime)s %(levelname)s %(name)s: %(message)s`.
- Log state transitions at INFO: tunnel started (with the URL), tunnel stopped, desired changed, WebSocket connected/disconnected.

### 7.7 Demo app (`agent/demo_app/server.py`)
- Standard library only (`http.server`). Bind to **`127.0.0.1:8080`**.
- Endpoints:
    - `GET /` returns a small HTML page with "Hello from <hostname>" and the server time.
    - `GET /healthz` returns `ok`.
- It's a separate process and service from the agent. It exists only to test the tunnel.

### 7.8 Entry point
- `python -m tunnel_agent`, with an optional `--once` flag that runs one tick (HTTP sync only, no WebSocket) and then exits (useful for testing and debugging).
- Also support `--version`.

---

## 8. Deployment artifacts

### 8.1 `deploy/systemd/tunnel-agent.service`
- Runs as a **dedicated system user**, `tunnelagent` (no login shell).
- Paths:
    - Install directory: `/opt/tunnel-agent`, with a venv at `/opt/tunnel-agent/.venv`.
    - Env file: `/etc/tunnel-agent/agent.env` (mode `600`, owned by root, readable by the service through `EnvironmentFile=`).
- Unit settings:
    - `After=network-online.target`, `Wants=network-online.target`
    - `Restart=always`, `RestartSec=5`, `KillMode=control-group`
- Hardening:
    - `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`
    - Make sure `cloudflared` can still run. It may need a writable home or state directory. Use `StateDirectory=tunnel-agent` and set `HOME` to it if needed. Test this.

### 8.2 `deploy/systemd/tunnel-demo-app.service`
- The same pattern, running `server.py` as `tunnelagent`.

### 8.3 `scripts/install-agent.sh` (idempotent, `set -euo pipefail`)
1. Check that it's running as root or via sudo, on a systemd-based Linux.
2. Detect a suitable Python (≥ 3.9). If none is found, print the exact install command for the detected OS (see the deployment guide) and exit.
3. Check that `cloudflared` exists.
4. Create the `tunnelagent` user if it's missing.
5. Copy `agent/` to `/opt/tunnel-agent` (or use an `rsync`-style copy), create or refresh the venv, and `pip install -r requirements.txt`.
6. Create `/etc/tunnel-agent/agent.env` from the example **only if it doesn't exist** (never overwrite secrets). Set the permissions to 600.
7. Install the systemd units, then run `daemon-reload` and `enable` (don't start until the env file has been edited; print the next steps).
8. Optionally install `deploy/sysctl/99-quic.conf` when run with the `--tune-udp` flag.

### 8.4 Other scripts
- `scripts/update-agent.sh`: run `git pull` **as the invoking user** (`sudo -u "$SUDO_USER" git pull`, to avoid git's "dubious ownership" error on a clone owned by that user), then recopy the files, reinstall the dependencies, restart the services, and show the status.
- `scripts/gen-secret.sh`: prints `openssl rand -hex 32`.

---

## 9. Documentation requirements (`docs/`)

All docs are written in clear English, use copy-pasteable commands, and say on which machine each command runs (**[local]**, **[VM]**, **[Cloudflare dashboard]**, **[GitHub]**).

### 9.1 `docs/deployment.md`: step-by-step guide (most important)
It must let a non-expert deploy from zero. Required sections, in this order:

1. **Overview and prerequisites:** a GitHub account, a Cloudflare account (free plan), VM SSH access with sudo, `cloudflared` installed, and outbound HTTPS from the VM.
2. **Generate secrets [local]:** create `AGENT_TOKEN`, `SESSION_SECRET`, and `ADMIN_PASSWORD` using `scripts/gen-secret.sh`. Store them in a password manager.
3. **Prepare Cloudflare [Cloudflare dashboard]:**
    1. Open **Workers & Pages** once and choose your `workers.dev` subdomain (the first deploy fails without it).
    2. Copy your **Account ID**.
    3. Create an **API token** from the "Edit Cloudflare Workers" template, scoped to your account.
4. **Push the repo to GitHub and configure Actions [local] [GitHub]:**
    1. Push to a repo whose default branch is `main`.
    2. Add the repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `AGENT_TOKEN`, `ADMIN_PASSWORD`, `SESSION_SECRET`.
5. **First deploy [GitHub]:**
    1. Push to `main` (or re-run the workflow). Watch the **Actions** tab: CI runs, then the `deploy` job.
    2. Verify `https://tunnel-control.<subdomain>.workers.dev/api/health`, then open the root URL and unlock the deck with `ADMIN_PASSWORD`.
    3. Note the base URL for the agent: `https://tunnel-control.<subdomain>.workers.dev`.
    4. Note: don't put Cloudflare Access in front of the Worker; it would block the agent.
6. **Prepare the VM [VM]:**
    1. Identify the OS (`cat /etc/os-release`).
    2. Install git and Python ≥ 3.9. Give the commands for RHEL/Rocky/Alma 8 and 9 (`sudo dnf install -y python3.11 git`), and a note for CentOS 7 (no packaged 3.9+, so suggest an alternative or an upgrade).
    3. Verify outbound access:
        - `curl -I https://tunnel-control.<subdomain>.workers.dev/api/health`
        - `curl -I https://api.trycloudflare.com`
        - WebSocket upgrade check (should get `101` or `401`, not a proxy error): a `curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" https://.../api/agent/ws` example.
    4. Proxy note: set `HTTPS_PROXY` in the env file if the network needs one. If WebSockets are blocked, set `ENABLE_WEBSOCKET=false`.
7. **Install the agent [VM]:**
    1. Clone the repo and run `sudo ./scripts/install-agent.sh`.
    2. Edit `/etc/tunnel-agent/agent.env`.
    3. Start the services: `sudo systemctl start tunnel-demo-app tunnel-agent`.
    4. Verify: `systemctl status ...`, `journalctl -u tunnel-agent -f`, `curl http://127.0.0.1:8080/healthz`.
8. **End-to-end test:**
    1. The dashboard shows the agent as online, with the "Live (WebSocket)" badge, within a few seconds.
    2. Click **Start** and wait for the URL to appear.
    3. Open the URL and see the demo page.
    4. Click **Stop**, and confirm the URL stops working.
9. **Reboot test [VM]:** reboot the VM and confirm the services come back and the agent goes online again. The tunnel restarts automatically if desired = running.
10. **Updating:**
    - Web: push to `main`; GitHub Actions tests and deploys it.
    - Agent: `sudo ./scripts/update-agent.sh` on the VM.
11. **Rotating secrets:** the order of steps to avoid downtime. Rotating `AGENT_TOKEN` means updating the GitHub secret, re-running the deploy, then updating the VM env file and restarting the agent (the agent is offline in between). Rotating `SESSION_SECRET` logs everyone out.
12. **Troubleshooting table:**
    - Agent offline
    - 401 errors in the agent logs
    - Dashboard shows "Polling" instead of "Live" (WebSocket blocked by a proxy)
    - Tunnel start timeout
    - UDP blocked (switch to `TUNNEL_PROTOCOL=http2`)
    - 502 on the tunnel URL (the demo app isn't running)
    - The UDP buffer warning (harmless; optional sysctl)
    - Old Python
    - SELinux denials (check with `ausearch -m avc -ts recent`)
    - Deploy job fails (API token scope, missing workers.dev subdomain, missing GitHub secret)
    - `500 misconfigured` from the API (a Worker secret is missing)
13. **Uninstall:** stop and disable the services, remove the units, `/opt/tunnel-agent`, `/etc/tunnel-agent`, and the user. Delete the Worker with `npx wrangler delete` or from the dashboard.

### 9.2 Other docs
- `architecture.md`: the diagram from section 3, a sequence diagram (Mermaid) of the UI click → Durable Object → nudge → agent sync → cloudflared → status flow, the polling fallback, the design rules, and the failure modes.
- `api.md`: every endpoint (including the WebSocket), with its auth, request and response examples, error codes, and curl examples. This includes simulating the agent with curl.
- `development.md`:
    - Running the web app locally (`npm run dev` in `web/`, `.dev.vars`; the Durable Object runs locally in workerd with local storage).
    - Running the agent locally against `http://localhost:5173` (or the port Vite prints).
    - Using the fake cloudflared for development without a real tunnel.
    - Running the tests and lint.
- `operations.md`: a runbook covering logs (journald on the VM, Workers Logs / `npx wrangler tail` for the Worker), restarts, checking the tunnel metrics (`curl 127.0.0.1:20241/metrics`), resource checks (`ps`, `systemd-cgtop`), rolling back a bad Worker deploy (`npx wrangler rollback` or the dashboard), and common incidents.
- `security.md`:
    - What is public: the tunnel URL, the SPA static files, `/api/health`, `/api/auth/login`, `/api/agent/*` (token-protected).
    - Secret handling (GitHub secrets → Worker secrets), brute-force protection, and constant-time comparisons.
    - Quick Tunnel caveats, and a recommendation to use a named tunnel + domain + Cloudflare Access for anything beyond testing.
- `decisions/000X-*.md`: short ADRs (Context, Decision, Consequences) for the four decisions listed in section 4. ADR 0004 records why Vercel + Next.js + Upstash were replaced by a single Worker + Vite SPA + Durable Object (no SSR needed, faster builds, WebSockets, one platform, free tier).

### 9.3 `README.md`
A one-paragraph description, the architecture diagram, quick start links (development, deployment), the repo layout, and a status badge for CI.

---

## 10. `CLAUDE.md` (create in Phase 0, keep it updated)

`CLAUDE.md` must contain:
1. **Project summary:** about 5 lines, and a link to `docs/architecture.md`.
2. **Repo map:** what lives where (`web/src/worker`, `web/src/client`, `web/src/shared`, `agent/`, `deploy/`, `scripts/`, `docs/`).
3. **Commands:**
    - Web: install, dev, build, lint, typecheck, test, deploy (CI only), tail logs.
    - Agent: create a venv, install the dev dependencies, run, run once, test, lint.
4. **Conventions and rules:**
    - UI data access goes **only** through SWR hooks in `web/src/client/hooks/` that use the Axios instance in `web/src/client/lib/http.ts`. Never use raw `fetch` in components.
    - Every API input and WebSocket message is validated with zod. Shared schemas live in `web/src/shared/schemas.ts`.
    - Storage goes only through the `AgentHub` Durable Object. Never touch `ctx.storage` outside `agent-hub.ts`. Never edit an applied Durable Object migration.
    - The client bundle never imports from `src/worker/` and never contains secrets.
    - UI colors come only from `styles/tokens.css`. Every new animation respects the effects level and `prefers-reduced-motion` (see `docs/design.md`).
    - The agent has no HTTP server and uses only `requests`, `websocket-client`, and the standard library. The WebSocket only wakes the reconciler; it never changes tunnel state.
    - Never use `shell=True`. Never log secrets.
    - The API contract lives in `docs/api.md`. If you change an endpoint, update `schemas.ts`, `client.py` / `nudge.py`, the tests, and `docs/api.md` **in the same change**.
5. **Definition of done for any change:**
    - Tests added or updated, and lint, typecheck, and tests all pass.
    - Related docs updated, with a `CHANGELOG.md` entry.
    - An ADR for any significant design change.
6. **Gotchas:**
    - Quick Tunnel URLs change on every restart.
    - cloudflared logs go to stderr.
    - Durable Objects on the free plan must use the SQLite backend (`new_sqlite_classes`).
    - Pushing to `main` deploys to production.
    - The server sets `lastSeen`.
    - The VM's default Python may be too old.
    - Corporate proxies may block WebSockets; polling is the fallback.
7. **Where to look first** when debugging each kind of problem.
8. **The `## graphify` section** (already created by `graphify claude install`). Keep it when writing the rest of `CLAUDE.md`: use `graphify query/path/explain` for codebase questions when `graphify-out/graph.json` exists, and run `graphify update .` after code changes.

**graphify setup (already applied):**
- `graphify claude install` wrote the `## graphify` section of `CLAUDE.md` and PreToolUse hooks, which were moved to `.claude/settings.local.json` because they contain machine-specific absolute paths.
- `graphify-out/` and `.claude/settings.local.json` are in `.gitignore` and must never be committed.
- At the end of every phase, run `graphify update .` (AST-only, no API cost) so the graph matches the code. Run `/graphify .` once after Phase 0 to build the first graph.

---

## 11. Testing and CI/CD

### Web (Vitest)
Worker tests (`@cloudflare/vitest-pool-workers`, real Durable Objects, isolated storage per test):
- `schemas.ts`: valid and invalid payloads, and rejection of URLs that aren't trycloudflare.
- `AgentHub`: desired defaults to `stopped`, set/get round trip, events are capped at 100 and returned newest first, `agent_online` on first sync, the alarm emits `agent_offline_detected` once, `hitRateLimit` resets after the window.
- `auth.ts`: sign/verify a session, reject expired or tampered tokens.
- Routes (through `SELF.fetch`):
    - `POST /api/agent/sync`: 401 without a token or with a wrong token, 400 on an invalid body, 200 returns the desired state, `lastSeen` is set by the server (the agent's value is ignored), and events are derived correctly (started, stopped, url_changed, agent_error).
    - `GET /api/agent/ws`: 401 with a wrong token; with a valid token, `PUT /api/control` delivers `{"type":"nudge"}` to the socket.
    - `GET/PUT /api/control`: 401 without a session, `online` and `pending` computed correctly, and PUT writes a `desired_changed` event.
    - `POST /api/auth/login`: wrong password returns 401, correct password sets the cookie, and 429 after too many attempts.
    - Missing secret → `500 misconfigured`.

Client tests (jsdom):
- `http.ts`: a 401 on `/control` emits "session lost" (the page locks); a 401 on `/auth/login` does not.
- `App.tsx`: renders the locked state on 401, switches to unlocked after a successful login without changing the URL, and locks again on logout.
- Hooks: at least one test for `useControl`/`useSetDesired` using a mocked Axios instance (optional, but preferred).

### Agent (pytest)
- Create a **fake cloudflared** at `agent/tests/fixtures/fake_cloudflared.py` (executable, with a `#!/usr/bin/env python3` shebang). Its behavior is controlled by env vars:
    - `FAKE_MODE=ok`: print a few log lines and a `https://test-abc-123.trycloudflare.com` URL to **stderr**, then sleep until it gets SIGTERM.
    - `FAKE_MODE=no_url`: print logs without a URL and keep running (tests the start timeout).
    - `FAKE_MODE=crash`: exit with code 1 after one log line.
    - `--version`: print `cloudflared version 0000.0.0 (fake)`.
- `tunnel.py` tests: start extracts the URL, stop terminates the process, timeout raises `TunnelStartError` with log lines, a crash makes `is_running()` False, and starting twice is a no-op.
- `client.py` tests: mock HTTP with `requests`' adapter or `responses`-style monkeypatching (no extra runtime dependency). Cover 200, 401 → `AuthError`, 500/timeout → `ServerError`, and an invalid JSON body → `ProtocolError`.
- `nudge.py` tests: with a fake WebSocket connection object, a nudge message sets `wake`, an unknown message is ignored, reconnect sets `wake` once, and the backoff grows and caps.
- `reconciler.py` tests: use a fake tunnel and a fake client to check each transition, the immediate re-sync after a state change, a nudge ending the wait early, the start backoff gate, keeping the tunnel's state when the API is unreachable, and shutdown sending the final sync.
- `config.py` tests: required vars missing → a clear error, the interval is clamped to 10–300, and a non-https base URL is rejected.

### CI/CD (`.github/workflows/ci.yml`)
- Trigger on push (all branches) and pull requests.
- **Job `web`** (working directory `web`): `npm ci`, lint, typecheck (`tsc --noEmit` or `tsc -b`), test, build. Must not need any real secret (tests use bindings from `vitest.config.ts`).
- **Job `agent`** (working directory `agent`): Python 3.9 and 3.11 matrix, install the dev dependencies, `ruff check`, `ruff format --check`, `pytest`.
- **Job `shellcheck`:** `shellcheck scripts/*.sh`.
- **Job `deploy`:**
    - `needs: [web, agent, shellcheck]`, and runs only on `push` to `main` (never on pull requests).
    - `concurrency: deploy-production` (no parallel deploys), `environment: production`.
    - Builds the app, then deploys with `cloudflare/wrangler-action` (working directory `web`), using `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and uploads `AGENT_TOKEN`, `ADMIN_PASSWORD`, `SESSION_SECRET` as Worker secrets from GitHub secrets (the action's `secrets:` input).
    - After deploying, smoke-test `GET <workers.dev URL>/api/health` and fail the job if it doesn't return `{ ok: true }`. Read the URL from the wrangler output or a `WORKER_URL` repository variable.
- The agent is **not** deployed by CI (the VM is private; see the non-goals).

---

## 12. Security checklist (must all be true before the final phase is accepted)
- [ ] No secrets in the repo. `.env*` and `.dev.vars` files are gitignored except `*.example`.
- [ ] Production secrets exist only as GitHub Actions secrets and Worker secrets.
- [ ] `AGENT_TOKEN` and `ADMIN_PASSWORD` are compared in constant time (`crypto.subtle.timingSafeEqual` on equal-length digests).
- [ ] The session cookie is httpOnly, Secure (on HTTPS), SameSite=Lax, and signed. It expires after 12h.
- [ ] Login has brute-force protection (10 per 15 min per IP, fixed delay).
- [ ] Every protected API route is covered by the session middleware, verified by tests.
- [ ] The agent WebSocket requires the same Bearer token as sync.
- [ ] Every request body and WebSocket message is validated with zod, with length limits on strings.
- [ ] The SPA bundle contains no secrets (grep the build output).
- [ ] The deploy job runs only on pushes to `main`, never on pull requests.
- [ ] The agent never logs the token. The `subprocess` call uses an argument list, never `shell=True`.
- [ ] The agent runs as a non-root user with systemd hardening, and the env file is mode 600.
- [ ] The demo app binds to `127.0.0.1` only.
- [ ] The dashboard shows the "Quick Tunnel URLs are public" notice.
- [ ] The UI loads no third-party resources at runtime (fonts are self-hosted).
- [ ] `docs/security.md` lists what is public and what is protected.

---

## 13. Implementation phases

Work through the phases in order. At the end of each phase: run the listed checks, update `CHANGELOG.md`, summarize the changes and any deviations from this plan, and **wait for the user to confirm** before you continue.

### Phase 0: Scaffolding, project guide, and pipeline
- Rename the git branch `master` to `main`.
- Create the repo layout from section 4: `.gitignore` (extend the existing one; keep `graphify-out/` and `.claude/settings.local.json` ignored), `.editorconfig`, `README.md` (draft), `CHANGELOG.md`, and `CLAUDE.md` (full first version, following section 10).
- Create the `docs/` files with headings and short placeholders, and write the four ADRs in full.
- Initialize `web/` with `npm create cloudflare@latest` (React + Vite template with `@cloudflare/vite-plugin`, TypeScript). Add Hono, Tailwind, ESLint, Prettier, Vitest (both projects), `swr`, `axios`, `zod`, `jose`. Configure `wrangler.jsonc` (assets, `AGENT_HUB` binding, SQLite migration, vars) with a stub `AgentHub` and a working `/api/health`.
- Initialize `agent/` with `pyproject.toml`, `requirements.txt` (pinned `requests` and `websocket-client`), `requirements-dev.txt`, and the package skeleton.
- Add the full CI/CD workflow (section 11).
- **Acceptance criteria:** `npm run lint`, `npm run build`, and `npm test` (in `web/`), and `pytest` (in `agent/`, even with a smoke test) all pass. `CLAUDE.md` exists and is accurate. Once the user has added the GitHub secrets and pushed, the `deploy` job succeeds and `/api/health` answers on `workers.dev`.

### Phase 1: Worker core
- Write `env.ts`, `schemas.ts`, `auth.ts`, and the full `AgentHub` Durable Object (storage, events, derived events, alarm, rate limit; WebSocket handling can stay a stub until Phase 2).
- Add unit tests for all of them.
- **Acceptance criteria:** worker tests pass, and typecheck passes.

### Phase 2: API, WebSocket, and route protection
- Implement every route from section 6.4 (including `/api/agent/ws` and nudges) and the middleware from section 6.5.
- Add route tests from section 11.
- Write `docs/api.md` in full, with curl examples.
- **Acceptance criteria:** all route tests pass. Manually simulating the agent with curl against `npm run dev` works. After pushing to `main`, the same curl calls work against `workers.dev`.

### Phase 3: Web UI (SWR + Axios, Holo-HUD design)
- **First, design:** use the `ui-ux-pro-max:design` skill (with its `design-system` and `ui-styling` sub-skills) to finalize the tokens and component specs from section 6.8. Write `styles/tokens.css`, `styles/effects.css`, and `docs/design.md`. Show the user a static preview of the single page in both its locked and unlocked states (screenshots at 375px and 1440px) and **wait for approval of the look** before wiring data.
- Then write `http.ts`, `fetcher.ts`, the `SWRConfig` provider, the hooks, the `fx/` primitives, the components, and the single page (`App.tsx` with its locked/unlocked states), as specified in sections 6.6 and 6.8, including every action animation in the 6.8 table.
- **Acceptance criteria:**
    - Lint, typecheck, test, and build all pass.
    - Screenshots at 375px, 768px, and 1440px, in both "Full" and "Reduced" effects mode, look correct.
    - With `prefers-reduced-motion` emulated, no tilt, glitch, scramble, or boot intro runs.
    - The performance budget from section 6.8 holds (bundle size from the build output; Lighthouse on the deployed URL).
    - Keyboard-only: log in, toggle the reactor, and copy the URL with visible focus at every step.
    - Locally: unlock the page, click the reactor, and the desired state changes; logout locks it again without a URL change. Simulate the agent with curl, and the dashboard shows online, the URL, and the events.
    - No raw `fetch` calls exist in client components (check with grep).

### Phase 4: Python agent
- Write `config.py`, `tunnel.py`, `client.py`, `nudge.py`, `reconciler.py`, `logging_setup.py`, and `__main__.py` (with `--once` and `--version`).
- Add the fake cloudflared and all agent tests from section 11.
- **Acceptance criteria:**
    - `ruff` and `pytest` pass on Python 3.9 and 3.11.
    - Locally, the agent with the fake cloudflared, pointed at the local web app, makes the full loop work: Start in the UI → the nudge arrives → the agent starts the fake tunnel within a few seconds → the UI shows the URL → Stop in the UI → the fake tunnel stops.
    - With `ENABLE_WEBSOCKET=false`, the same loop works through polling.

### Phase 5: Demo app and deployment artifacts
- Write the demo app, both systemd units, the env example, the sysctl file, and all three scripts from section 8.
- **Acceptance criteria:** `shellcheck` passes. `install-agent.sh` is idempotent: running it twice doesn't overwrite the env file or fail. The demo app answers on `127.0.0.1:8080/healthz`.

### Phase 6: Documentation
- Write `docs/deployment.md` in full (section 9.1), plus `architecture.md` (with Mermaid diagrams), `development.md`, `operations.md`, and `security.md`.
- Finish `README.md`, and update `CLAUDE.md` with any changes made during implementation.
- **Acceptance criteria:**
    - Every command in the docs matches the real file names, paths, script names, secret names, and env var names in the repo. Cross-check them.
    - Every step says on which machine it runs.

### Phase 7: Final review
- Go through the security checklist (section 12) and the definition of done (section 14). Fix any gaps.
- Run the full CI locally: web lint, typecheck, test, build; agent ruff and pytest; shellcheck.
- Produce a short **handover summary**:
    - What was built.
    - How to deploy (a link to `docs/deployment.md`).
    - Known limitations.
    - Suggested next steps.
- **Acceptance criteria:** everything passes, and the summary has been written.

---

## 14. Definition of done (whole project)
- [ ] The UI can start and stop the tunnel on the VM, and shows the live URL, status, channel, and events.
- [ ] With the WebSocket connected, a UI click reaches the agent within a few seconds; without it, within one poll interval.
- [ ] The agent restarts a crashed tunnel when desired = running, and survives a VM reboot (through systemd).
- [ ] Losing contact with the control API (HTTP or WebSocket) never crashes the agent or changes the tunnel state.
- [ ] A push to `main` runs CI and deploys the Worker to Cloudflare without manual steps; a failing check blocks the deploy.
- [ ] All tests, lint, typecheck, build, and shellcheck pass in CI.
- [ ] `CLAUDE.md`, `README.md`, every file in `docs/`, the ADRs, and `CHANGELOG.md` are complete and match the code.
- [ ] `docs/deployment.md` lets a non-expert deploy both parts from zero.
- [ ] The security checklist (section 12) is fully checked.

---

## 15. Future ideas (do NOT implement now; list them in the README "Roadmap")
- Named tunnel + custom domain + Cloudflare Access instead of a Quick Tunnel.
- Multiple VMs: an agent list in the UI, and a separate token per agent (one Durable Object per `agentId` already).
- Push live updates to the browser over a WebSocket too, and call SWR `mutate()` on each message.
- Auto-stop the tunnel after N minutes, or on a schedule (a Durable Object alarm fits well).
- Notifications (Telegram/Slack/email) when the URL changes or the agent goes offline.
- Preview deployments for pull requests.
- Proper authentication (Cloudflare Access or an OAuth provider) with multiple users and audit history.

---

## 16. Rules for the AI agent while working
1. Follow the phases in order, and stop at the end of each phase for confirmation.
2. Prefer the simplest solution that meets the spec. Don't add dependencies beyond those listed without asking.
3. If a library API differs from what this plan assumes (for example, `@cloudflare/vite-plugin`, wrangler config keys, `vitest-pool-workers`, Hono, SWR, or `websocket-client` changes), follow the **installed version's** documentation and write down the difference in `CLAUDE.md` and the phase summary.
4. Never commit secrets, real tokens, or real tunnel URLs. Use obvious placeholders such as `change-me` and `https://example-abc.trycloudflare.com`.
5. Keep the code, tests, and docs in sync **in the same change**.
6. When unsure, ask. Don't guess about anything that affects security or deployment.
