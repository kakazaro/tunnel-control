# 0001. Desired-state model, HTTPS sync, and a WebSocket nudge

## Context
The VM is in a private network: it can make outbound HTTPS requests but cannot receive inbound ones. The UI must be able to start and stop a `cloudflared` Quick Tunnel on it.

## Decision
- The UI writes a **desired state** (`running` or `stopped`). The agent makes reality match it. Nothing is a one-off command.
- The agent talks to the Worker over HTTPS: `POST /api/agent/sync` sends its status and returns the desired state. This is the only protocol that carries state.
- The agent also keeps a WebSocket open (`/api/agent/ws`). The server sends only `{"type":"nudge"}` when the desired state changes, and the agent then syncs immediately.
- If the WebSocket cannot connect (for example a proxy blocks it), the agent polls every 60s. Behavior is identical, only slower.

## Consequences
- Safe to repeat; survives missed messages; a crashed tunnel is restarted automatically.
- A UI click reaches the agent in about a second with the WebSocket, within one poll interval without.
- One extra dependency in the agent (`websocket-client`) and a small reconnect loop.
- The WebSocket never changes tunnel state itself, so losing it cannot break anything.
