# 0004. One Cloudflare Worker with a Vite + React SPA

## Context
The first plan used Next.js on Vercel with Upstash Redis. That needs three services, builds slowly, and cannot hold a WebSocket. The dashboard sits behind a login, so server-side rendering has no value.

## Decision
Deploy **one Cloudflare Worker** that serves a Vite + React single-page app as static assets and handles `/api/*` with Hono. State lives in a Durable Object (see 0002). GitHub Actions deploys it on every push to `main`.

## Consequences
- One platform, one deploy, one free tier. WebSockets and alarms are available.
- Fast builds. `@cloudflare/vite-plugin` runs the Worker in workerd during `vite dev`.
- No SSR and no Next.js features; not needed here.
- The agent cannot be deployed by CI because the VM is private; it is updated with `scripts/update-agent.sh`.
