# Development

Everything runs locally without a Cloudflare account: `vite dev` runs the Worker and its Durable Object
in `workerd`, and the agent can use a fake `cloudflared`.

## Prerequisites

- Node.js 22 (20+ works), npm
- Python 3.9+ (3.11 recommended)
- Optional: `shellcheck` (CI runs it on `scripts/*.sh`)

## Web app and Worker

```bash
cd web
npm ci                      # web/.npmrc sets legacy-peer-deps (see CLAUDE.md)
cp .dev.vars.example .dev.vars   # local secrets; git-ignored. Edit the values if you like.
npm run dev                 # http://localhost:5173  (UI + API + Durable Object, local storage)
```

`.dev.vars` is the local replacement for the Worker secrets. If the file is missing or a value is too short
(token/secret ≥ 32 chars, password ≥ 12), every API call except `/api/health` returns `500 misconfigured`.
Local state lives under `web/.wrangler/state`; delete that folder to reset it.

Open the page, unlock it with `ADMIN_PASSWORD` from `.dev.vars`. Try the effects toggle in the header
(`FX: FULL / REDUCED`) and the full-screen button.

### Checks

```bash
npm run lint             # ESLint
npm run format:check     # Prettier   (npm run format to fix)
npm run typecheck        # tsc -b
npm test                 # Vitest: worker tests in workerd + client tests in jsdom
npm run build            # tsc -b && vite build
```

The worker tests use the real Durable Object (no mocks). They read secrets from `vitest.config.ts`
bindings, so they pass with or without a local `.dev.vars`. After editing `wrangler.jsonc`, run
`npm run cf-typegen` and commit `worker-configuration.d.ts`.

## Agent

```bash
cd agent
python -m venv .venv
. .venv/bin/activate                  # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
python -m pytest
ruff check . && ruff format --check .
```

### Run the agent against the local web app, with a fake cloudflared

The agent reads its configuration from environment variables (see `agent/.env.example`). With the dev
server running, in a second terminal:

```bash
cd agent
export CONTROL_BASE_URL=http://localhost:5173
export AGENT_TOKEN=$(grep '^AGENT_TOKEN=' ../web/.dev.vars | cut -d= -f2)
export AGENT_ID=vm-1
export PYTHON=$(command -v python)            # used by the fake launcher
export CLOUDFLARED_BIN=$PWD/dev/fake-cloudflared        # Windows: dev\fake-cloudflared.cmd
export PYTHONPATH=src
python -m tunnel_agent                        # add ENABLE_WEBSOCKET=false to test polling
```

`dev/fake-cloudflared` runs `tests/fixtures/fake_cloudflared.py`, which prints a fake
`https://test-abc-123.trycloudflare.com` URL to stderr. `FAKE_MODE=no_url` or `FAKE_MODE=crash` simulates failures.

Then in the browser: unlock the page, click **ENGAGE**, pick a session length, and **LAUNCH SESSION**.
The agent starts the fake tunnel within a second (WebSocket nudge) and the URL shows up.
Other handy commands:

```bash
python -m tunnel_agent --once     # one HTTPS sync, then exit
python -m tunnel_agent --version
```

### Simulating the agent with curl

See [api.md](api.md#simulating-the-agent-with-curl).

## Windows notes

- Use Git Bash for the `scripts/*.sh` files. `scripts/gen-secret.sh` also works on Windows (it falls back from
  `openssl` to Python, `/dev/urandom` or PowerShell).
- Shell scripts must keep LF line endings (`.gitattributes` enforces it). If you edit them on Windows, use an editor
  that preserves LF; `.editorconfig` sets `end_of_line = lf`.
- The `.cmd` launcher in `agent/dev` is for Windows only; on Linux use `dev/fake-cloudflared`.

## Knowledge graph (optional)

`graphify` is set up for this repo: `/graphify .` builds `graphify-out/` (git-ignored), and
`graphify update .` refreshes it after code changes.
