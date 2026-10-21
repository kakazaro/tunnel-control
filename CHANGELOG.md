# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Cloudflare Worker (Hono) API: agent sync, agent WebSocket nudges, control, events, login/logout, health.
- `AgentHub` Durable Object (SQLite): desired state, status, capped event log, offline alarm, login rate limiter.
- Single-page "Holo-HUD" UI (Vite, React, Tailwind, SWR + Axios, Motion): lock/unlock in place, reactor control,
  status, tunnel, and event panels, an animation for every action, full-screen layout, reduced-effects mode.
- Python agent: Quick Tunnel manager, HTTPS sync client, WebSocket nudge listener, reconciler with start backoff.
- Demo app, systemd units, installer/update scripts, optional QUIC sysctl tuning.
- GitHub Actions: `ci.yml` (web, agent and shell checks on pull requests and non-`main` branches) and
  `deploy.yml` (build + deploy to Cloudflare on push to `main`, without re-running tests).
- Documentation (`docs/`), four ADRs, and `CLAUDE.md` for AI agents. graphify knowledge-graph setup.

- Session length: starting a tunnel requires choosing 1, 2, 4, 8 or 12 hours in a modal. The tunnel stops
  automatically when time is up (server-side alarm plus a local deadline in the agent); the UI shows a countdown.
- `scripts/gen-secret.sh` works on Windows too (falls back from `openssl` to Python, `/dev/urandom` or PowerShell).

### Notes
- The web test setup uses `@cloudflare/vitest-plugin` (successor of the deprecated `vitest-pool-workers`).
- `deploy.yml` uploads Worker secrets with `wrangler secret bulk` after `wrangler deploy` instead of the
  `wrangler-action` `secrets:` input, so the order (deploy, then secrets) is explicit.
