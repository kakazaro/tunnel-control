# Operations runbook

## Where things are

| What | Where |
|---|---|
| Worker + UI | `https://tunnel-control.<subdomain>.workers.dev` |
| Worker logs | Cloudflare dashboard → Workers & Pages → tunnel-control → Logs, or `cd web && npx wrangler tail` |
| Agent code / venv | `/opt/tunnel-agent` (root-owned), `/opt/tunnel-agent/.venv` |
| Agent config | `/etc/tunnel-agent/agent.env` (root, mode 600) |
| Agent state / HOME | `/var/lib/tunnel-agent` |
| Services | `tunnel-agent.service`, `tunnel-demo-app.service` |

## Logs [VM]

```bash
journalctl -u tunnel-agent -f              # follow
journalctl -u tunnel-agent --since "1 hour ago"
journalctl -u tunnel-demo-app -n 50
```

The agent logs state changes at INFO: tunnel started (with the URL), tunnel stopped, desired state changed,
WebSocket connected/disconnected. `cloudflared` output is kept in memory (last 50 lines) and appears in the log
only when a start fails.

## Restart, stop, status [VM]

```bash
sudo systemctl restart tunnel-agent        # also restarts cloudflared (same cgroup)
sudo systemctl stop tunnel-agent tunnel-demo-app
systemctl status tunnel-agent tunnel-demo-app
```

Stopping the agent stops the tunnel. The Worker marks the agent offline after 150s without a sync.

## Sessions and auto stop

Every start needs a session length (1, 2, 4, 8 or 12 hours). When time is up:

1. The Durable Object sets the desired state to `stopped`, logs a `session_expired` event and nudges the agent.
2. The agent also stops the tunnel itself at the deadline (it uses the remaining time reported by the last sync),
   so a lost connection cannot leave the public URL open.

To keep the tunnel longer, start a new session (ENGAGE again after DISENGAGE; the URL changes).
The tunnel also stops when the agent stops or the VM reboots (a rebooted agent restarts it only if the session
has not expired).

## Tunnel metrics and resources [VM]

`cloudflared` exposes metrics on a fixed address (`TUNNEL_METRICS`, default `127.0.0.1:20241`):

```bash
curl -s 127.0.0.1:20241/metrics | head
curl -s 127.0.0.1:20241/ready
ps -o pid,etime,rss,cmd -u tunnelagent
systemd-cgtop -n 1 | grep tunnel
```

The agent idles at roughly 20-30 MB of memory and does one small HTTPS request per minute.

## Updating

- Web: merge to `main` (builds and deploys automatically; tests run on PRs, not on the deploy).
- Agent [VM]: `cd tunnel-control && sudo ./scripts/update-agent.sh`.
- Rolling back a bad Worker deploy: `cd web && npx wrangler rollback` or the dashboard (*Deployments → Rollback*).
  Then fix forward on `main`.

## Rotating secrets

See [deployment.md](deployment.md#11-rotating-secrets).

## Common incidents

| Incident | What to do |
|---|---|
| Page shows "OFFLINE · SIGNAL LOST" | `systemctl status tunnel-agent`; `journalctl -u tunnel-agent -n 100`; check network and `agent.env`. |
| Click on ENGAGE does nothing for a minute | The WebSocket is down (badge says POLLING). The agent still picks it up within one poll interval. |
| Tunnel keeps failing to start | The log shows the last `cloudflared` lines. The agent backs off (60s, 120s, 240s, then 300s). Check outbound access and try `TUNNEL_PROTOCOL=http2`. |
| URL stopped working but page says running | `cloudflared` may have crashed: the next tick restarts it (new URL). Check the demo app. |
| Login locked out ("LOCKED OUT · RETRY IN …") | 10 wrong attempts per IP in 15 minutes. Wait for the countdown. |
| Unexpected `500 misconfigured` | A Worker secret is missing/too short. Re-run the *Deploy* workflow; `npx wrangler tail` shows which variable. |
| Events stop updating | Check the Worker logs for errors; the Durable Object state is kept across deploys. |
