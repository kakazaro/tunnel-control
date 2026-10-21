# 0003. Quick Tunnel, no domain

## Context
The user has no domain, so named tunnels and Cloudflare Access are not available.

## Decision
Use a Cloudflare **Quick Tunnel**: `cloudflared tunnel --url http://localhost:8080`. It gives a random `https://*.trycloudflare.com` URL. The agent reads the URL from `cloudflared`'s stderr and reports it.

## Consequences
- The URL is public and changes on every restart; the dashboard warns about this.
- No uptime guarantee from Cloudflare for Quick Tunnels. Fine for testing.
- For anything beyond testing, move to a named tunnel with a domain and Cloudflare Access.
- The existing token-based `cloudflared` service on the VM is left untouched.
