# 0002. Durable Object (SQLite) storage

## Context
The first design used Vercel plus Upstash Redis. Moving everything to Cloudflare removes both. The state is small: one desired value, one status, a capped event list, and login rate-limit counters.

## Decision
Use one **Durable Object** class, `AgentHub`, with its built-in SQLite storage. One instance per `agentId` holds that agent's state and its WebSocket; a second instance named `auth` holds the login rate limiter. Only `agent-hub.ts` touches storage.

## Consequences
- No external database, no extra account, and it works on the Workers Free plan (SQLite backend).
- Strong consistency per agent, WebSocket hibernation, and alarms for offline detection come for free.
- Local development and tests run the real Durable Object in workerd, so no in-memory fake is needed.
- Migrations are append-only: never edit an applied migration tag.
