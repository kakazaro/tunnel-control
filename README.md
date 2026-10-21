# Tunnel Control

[![CI](https://github.com/your-org/tunnel-control/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/tunnel-control/actions/workflows/ci.yml)

Start and stop a **Cloudflare Quick Tunnel** on a private-network VM from a single, futuristic web page.
The VM has no inbound access, so a small **Python agent** connects *outbound* to a **Cloudflare Worker**:
it syncs over HTTPS and keeps a WebSocket open so a click in the UI reaches the VM within a second
(falling back to polling every 60s if WebSockets are blocked). Everything runs on Cloudflare's free plan,
and every push to `main` is tested and deployed automatically by GitHub Actions.

```
Browser ──HTTPS──► Cloudflare Worker (SPA + API) ──► Durable Object (state, WebSocket, alarm)
                         ▲   ▲
        HTTPS sync (POST)│   │WSS nudge
                         │   │
              Python agent on the VM ──► cloudflared ──► https://*.trycloudflare.com ──► demo app :8080
```

## Quick start

- **Run it locally:** [docs/development.md](docs/development.md)
- **Deploy it (Cloudflare + GitHub + VM):** [docs/deployment.md](docs/deployment.md)
- How it works: [docs/architecture.md](docs/architecture.md) · API: [docs/api.md](docs/api.md) ·
  Operations: [docs/operations.md](docs/operations.md) · Security: [docs/security.md](docs/security.md) ·
  UI design: [docs/design.md](docs/design.md) · Decisions: [docs/decisions/](docs/decisions/)

## Repository layout

```
web/       Cloudflare Worker (Hono + Durable Object) and the Vite/React single-page UI
agent/     Python agent, demo app, tests
deploy/    systemd units, env example, sysctl tuning
scripts/   install-agent.sh, update-agent.sh, gen-secret.sh
docs/      documentation and ADRs
.github/   CI/CD workflow
```

## Roadmap

Not implemented yet, by design:

- Named tunnel + custom domain + Cloudflare Access instead of a Quick Tunnel.
- Multiple VMs: an agent list in the UI and a separate token per agent (one Durable Object per `agentId` already).
- Live updates pushed to the browser over a WebSocket too (SWR `mutate()` on each message).
- Auto-stop the tunnel after N minutes or on a schedule (a Durable Object alarm fits well).
- Notifications (Telegram/Slack/email) when the URL changes or the agent goes offline.
- Preview deployments for pull requests.
- Proper multi-user authentication (Cloudflare Access or an OAuth provider) with an audit history.

> This is a test/learning project. Quick Tunnel URLs are public and change on every restart.
