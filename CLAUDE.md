# Tunnel Control: guide for AI agents

Start/stop a Cloudflare **Quick Tunnel** on a private-network VM from a web page.
A Cloudflare Worker (Vite + React SPA + Hono API + one Durable Object) holds the *desired state*;
a Python agent on the VM syncs with it over HTTPS, keeps a WebSocket open for instant "nudges",
and runs `cloudflared` to match. Pushing to `main` deploys the Worker from GitHub Actions.
Details: [docs/architecture.md](docs/architecture.md). Full original spec: `plan.md`.

## Repo map

| Path | What lives there |
|---|---|
| `web/src/worker/` | Hono API (`index.ts`), Durable Object `AgentHub` (`agent-hub.ts`), auth (`auth.ts`), env validation (`env.ts`) |
| `web/src/client/` | The single-page UI: `App.tsx`, `components/`, `components/fx/` (visual effects), `hooks/` (SWR), `lib/` (Axios, session store), `styles/` |
| `web/src/shared/schemas.ts` | zod schemas + types used by both the Worker and the UI |
| `web/tests/worker`, `web/tests/client` | Vitest: workerd (real Durable Objects) and jsdom |
| `agent/src/tunnel_agent/` | The agent: `config`, `tunnel`, `client`, `nudge`, `reconciler` |
| `agent/demo_app/server.py` | Tiny app on `127.0.0.1:8080` that the tunnel exposes (for testing) |
| `agent/dev/` | Launchers that make `fake_cloudflared.py` usable as `CLOUDFLARED_BIN` |
| `deploy/`, `scripts/` | systemd units, env example, sysctl, `install-agent.sh`, `update-agent.sh`, `gen-secret.sh` |
| `docs/` | architecture, api, development, deployment, operations, security, design, `decisions/` (ADRs) |

## Commands

Web (`cd web`; Node 22):
```bash
npm ci                 # install (web/.npmrc sets legacy-peer-deps)
npm run dev            # Vite + Worker in workerd on http://localhost:5173 (needs web/.dev.vars)
npm run lint           # ESLint
npm run format:check   # Prettier (npm run format to fix)
npm run typecheck      # tsc -b
npm test               # Vitest: worker + client projects
npm run build          # tsc -b && vite build
npm run cf-typegen     # regenerate worker-configuration.d.ts after editing wrangler.jsonc
npx wrangler tail      # live Worker logs (needs Cloudflare login)
```
Deploy is done by CI only (push to `main`). Do not run `wrangler deploy` by hand.

Agent (`cd agent`; Python 3.9+):
```bash
python -m venv .venv && . .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
python -m tunnel_agent                # run (config from environment variables, see agent/.env.example)
python -m tunnel_agent --once         # one HTTP sync, then exit
python -m pytest                      # tests
ruff check . && ruff format --check . # lint
```

## Conventions and rules

- **UI data access goes only through SWR hooks** in `web/src/client/hooks/` that use the Axios
  instance in `web/src/client/lib/http.ts`. Never use `fetch` in client code (ESLint enforces it).
- **Every API input and WebSocket message is validated with zod.** Shared schemas live in
  `web/src/shared/schemas.ts`.
- **Storage goes only through the `AgentHub` Durable Object.** Never touch `ctx.storage` anywhere
  else. Never edit an applied migration in `wrangler.jsonc`; add a new tag.
- The client bundle never imports from `src/worker/` and never contains secrets.
- **UI colors come only from `web/src/client/styles/tokens.css`.** Every new animation must respect
  the effects level and `prefers-reduced-motion` (see `docs/design.md`). The UI is one page: login is
  a *state* of `/`, not a route.
- The agent has no HTTP server and uses only `requests`, `websocket-client` and the standard library.
  The WebSocket only wakes the reconciler; it never changes tunnel state by itself.
- Never use `shell=True`. Never log secrets. Never put secrets in `wrangler.jsonc`, `NEXT_PUBLIC`-style
  public config, or the client bundle.
- **The API contract lives in `docs/api.md`.** If you change an endpoint, update `schemas.ts`,
  `agent/src/tunnel_agent/client.py` / `nudge.py`, the tests and `docs/api.md` **in the same change**.
- Keep line endings LF (`.gitattributes`). Do not edit files with Python text-mode writes on Windows (they
  silently produce CRLF, which breaks shell scripts); use the editor tools or `newline="
"`.
- Agent code must stay Python 3.9 compatible (`from __future__ import annotations`, `Optional[...]`).

## Definition of done for any change

- Tests added or updated; lint, typecheck and tests pass (web and agent).
- Related docs updated and a `CHANGELOG.md` entry added.
- An ADR in `docs/decisions/` for any significant design change.
- Run `graphify update .` so the knowledge graph matches the code.

## Gotchas

- Quick Tunnel URLs change on every restart, and they are public. Every start needs a session length
  (`durationHours` 1/2/4/8/12); `expiresAt` lives in the Durable Object's `desired` record, and the agent
  enforces it locally too (`reconciler.py`).
- `cloudflared` logs go to **stderr**; the agent reads the URL from there.
- Durable Objects on the Workers Free plan must use the SQLite backend (`new_sqlite_classes`).
- **Pushing to `main` deploys to production and runs NO tests** (`deploy.yml` only builds and deploys).
  Tests run in `ci.yml` on pull requests and non-`main` branches, so merge only green PRs.
- The server sets `lastSeen`; the agent's clock is never trusted.
- The VM's default Python may be too old (3.6 on RHEL 8); the installer looks for 3.9+.
- Corporate proxies may block WebSockets; the agent then polls (set `ENABLE_WEBSOCKET=false`).
- `web/.npmrc` has `legacy-peer-deps=true`: npm's peer resolver crashes on the Vitest/Cloudflare
  plugin tree otherwise.
- The tests read `env.*` from `cloudflare:workers`, so they pass with or without a local `.dev.vars`.
- Library notes where the installed version differs from the plan: Vitest integration is
  `@cloudflare/vitest-plugin` (the plan's `vitest-pool-workers` is deprecated), TypeScript is pinned
  to 6.x because `typescript-eslint` does not support 7, and `react-hooks` v7 lint rules are strict
  (no ref access / impure calls during render, no synchronous `setState` in effects).

## Where to look first

| Problem | Start here |
|---|---|
| Agent not shown online | `journalctl -u tunnel-agent -f` on the VM; then `AGENT_TOKEN`/`CONTROL_BASE_URL`; `docs/operations.md` |
| 401/500 from the API | `web/src/worker/index.ts`, `env.ts` (a missing secret gives `500 misconfigured`); `npx wrangler tail` |
| State/events wrong | `web/src/worker/agent-hub.ts` and `web/tests/worker/agent-hub.test.ts` |
| Tunnel won't start | `agent/src/tunnel_agent/tunnel.py`; `cloudflared` stderr in the agent log |
| UI behavior or animation | `web/src/client/App.tsx`, `components/`, `styles/effects.css`, `docs/design.md` |
| Deploy failed | `.github/workflows/deploy.yml`, GitHub Actions log, `docs/deployment.md` troubleshooting |

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

`graphify-out/` and `.claude/settings.local.json` are git-ignored (the hooks there contain
machine-specific paths). Re-create the hooks with `graphify claude install` and move them to
`.claude/settings.local.json`.
