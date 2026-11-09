# Deployment guide

Deploy the web app to Cloudflare Workers (from GitHub) and install the agent on your VM.
Each step says where to run it: **[local]** your computer, **[VM]** the Linux VM,
**[Cloudflare dashboard]**, **[GitHub]**.

## 1. Overview and prerequisites

You need:

- A **GitHub** account and a repository for this project (default branch `main`).
- A **Cloudflare** account (free plan is enough). No domain needed: the app gets a `*.workers.dev` URL.
- **SSH access with sudo** to the VM, with `cloudflared` installed at `/usr/bin/cloudflared`.
- The VM can make **outbound HTTPS** requests (through a proxy is fine).

How it fits together: a push to `main` builds and deploys the Worker (`.github/workflows/deploy.yml`).
The VM is private, so GitHub cannot reach it: the agent is installed and updated on the VM by hand.

## 2. Generate secrets [local]

You need three secrets. Generate each one and store them in a password manager:

```bash
./scripts/gen-secret.sh   # run three times: AGENT_TOKEN, SESSION_SECRET, and a long ADMIN_PASSWORD
```

- `AGENT_TOKEN`: shared between the Worker and the agent (at least 32 characters).
- `SESSION_SECRET`: signs the login cookie (at least 32 characters).
- `ADMIN_PASSWORD`: what you type to unlock the page (at least 12 characters; pick something you can type, or use the generated value).

## 3. Prepare Cloudflare [Cloudflare dashboard]

1. Open **Workers & Pages** once and choose your `workers.dev` subdomain (the first deploy fails without it).
2. Copy your **Account ID** (shown on the Workers & Pages overview page).
3. Create an **API token**: *My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template*, limited to your account. Copy the token.

## 4. Push the repo to GitHub and add secrets [local] [GitHub]

1. Push the repository to GitHub. Make sure the default branch is `main`:
   ```bash
   git branch -M main
   git remote add origin git@github.com:<you>/tunnel-control.git
   git push -u origin main
   ```
2. In the repository: *Settings → Secrets and variables → Actions → New repository secret*. Add:

   | Secret | Value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | the API token from step 3 |
   | `CLOUDFLARE_ACCOUNT_ID` | your account ID |
   | `AGENT_TOKEN` | from step 2 |
   | `ADMIN_PASSWORD` | from step 2 |
   | `SESSION_SECRET` | from step 2 |

3. Optional: *Settings → Environments → New environment* named `production` (the deploy job uses it, and it is created automatically if missing). You can add required reviewers there.

## 5. First deploy [GitHub]

1. Push to `main`, or open *Actions → Deploy → Run workflow*. Watch the **Actions** tab: the job builds, deploys, uploads the secrets, then checks `/api/health`.
   Pushes to `main` do **not** run the tests (to save resources). They run on pull requests and other branches (`ci.yml`), so merge only green pull requests.
2. Verify `https://tunnel-control.<subdomain>.workers.dev/api/health` returns `{"ok":true}`, then open the root URL and unlock the page with `ADMIN_PASSWORD`.
3. Note the **base URL** for the agent: `https://tunnel-control.<subdomain>.workers.dev`.
4. Optional: add a repository variable `WORKER_URL` with that URL so the smoke test does not have to parse the deploy log.
5. Do **not** put Cloudflare Access in front of the Worker: it would block the agent.

## 6. Prepare the VM [VM]

1. Identify the OS: `cat /etc/os-release`.
2. Install git and Python 3.9 or newer. RHEL / Rocky / Alma 8 and 9:
   ```bash
   sudo dnf install -y python3.11 git
   ```
   CentOS / RHEL 7 has no packaged Python 3.9+: upgrade the OS or build Python from source.
3. Verify outbound access:
   ```bash
   curl -I https://tunnel-control.<subdomain>.workers.dev/api/health
   curl -I https://api.trycloudflare.com
   ```
   WebSocket check (a `101` or `401` is fine; a proxy error means WebSockets are blocked):
   ```bash
   curl -i -N --max-time 5 \
     -H "Connection: Upgrade" -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
     https://tunnel-control.<subdomain>.workers.dev/api/agent/ws
   ```
4. If the network needs a proxy, set `HTTPS_PROXY` (and `NO_PROXY`) in the env file in step 7. If WebSockets are blocked, set `ENABLE_WEBSOCKET=false`: the agent then polls every 60s.

## 7. Install the agent [VM]

1. Clone the repo and run the installer (add `--tune-udp` to raise UDP buffers for QUIC; behind a proxy use `sudo -E` so `pip` sees `HTTPS_PROXY`):
   ```bash
   git clone https://github.com/<you>/tunnel-control.git
   cd tunnel-control
   sudo ./scripts/install-agent.sh
   ```
2. Edit the env file (`CONTROL_BASE_URL` = the base URL from step 5, `AGENT_TOKEN` = the same value as in GitHub):
   ```bash
   sudo nano /etc/tunnel-agent/agent.env
   ```
3. Start the services:
   ```bash
   sudo systemctl start tunnel-demo-app tunnel-agent
   ```
4. Verify:
   ```bash
   systemctl status tunnel-agent tunnel-demo-app
   journalctl -u tunnel-agent -f
   curl http://127.0.0.1:8080/healthz      # prints: ok
   ```

## 8. End-to-end test

1. The page shows the agent **ONLINE** within a few seconds, with the "LIVE LINK" badge (or "POLLING" if the WebSocket is blocked).
2. Click **ENGAGE** and wait for the URL to appear in the Tunnel panel.
3. Open the URL: you should see the demo page ("Hello from <hostname>").
4. Click **DISENGAGE** and confirm the URL stops working.

## 9. Reboot test [VM]

```bash
sudo reboot
```

After it comes back, the services start by themselves and the agent goes online again. If the desired state was `running`, the tunnel is restarted (with a new URL).

## 10. Updating

- **Web:** merge a pull request (or push) to `main`. GitHub Actions builds and deploys it.
- **Agent** [VM]:
  ```bash
  cd tunnel-control && sudo ./scripts/update-agent.sh
  ```

## 11. Rotating secrets

- **`AGENT_TOKEN`:** update the GitHub secret, re-run the *Deploy* workflow, then edit `/etc/tunnel-agent/agent.env` on the VM and `sudo systemctl restart tunnel-agent`. The agent is offline between the deploy and the restart.
- **`ADMIN_PASSWORD`:** update the GitHub secret and re-run *Deploy*. Existing sessions stay valid until they expire (12h) or `SESSION_SECRET` changes.
- **`SESSION_SECRET`:** update the GitHub secret and re-run *Deploy*. Everyone is logged out.

## 12. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Agent shows offline | `journalctl -u tunnel-agent -n 50` on the VM. Check `CONTROL_BASE_URL`, outbound HTTPS and the proxy. |
| `401` / "AGENT_TOKEN mismatch?" in the agent log | The VM's `AGENT_TOKEN` differs from the GitHub secret. Fix one, redeploy or restart. |
| `400 agent_id_mismatch` | `AGENT_ID` in `agent.env` differs from the Worker's `AGENT_ID` (default `vm-1`). |
| Page shows "POLLING" instead of "LIVE LINK" | The WebSocket is blocked by a proxy or firewall. Works, but a click takes up to 60s. Try step 6.3; or set `ENABLE_WEBSOCKET=false` to silence retries. |
| Tunnel start timeout | See the `cloudflared` lines in the agent log. Check outbound access to Cloudflare (`api.trycloudflare.com`, UDP/TCP 7844). |
| UDP blocked | Set `TUNNEL_PROTOCOL=http2` in `agent.env` and restart the agent. |
| 502 on the tunnel URL | The demo app is not running: `sudo systemctl start tunnel-demo-app`. |
| Warning about UDP buffer size | Harmless. Optionally run `sudo ./scripts/install-agent.sh --tune-udp`. |
| Installer says no Python 3.9+ | Install `python3.11` (step 6.2). |
| SELinux denials | `sudo ausearch -m avc -ts recent`; fix the policy for the denied path rather than disabling SELinux. |
| Deploy job fails | Check the API token scope ("Edit Cloudflare Workers"), that the `workers.dev` subdomain exists, and that all 5 GitHub secrets are set. |
| `500 misconfigured` from the API | A Worker secret is missing or too short. Re-run *Deploy* (it uploads the secrets) and check lengths (token/secret ≥ 32, password ≥ 12). |
| Env/secret changes not applied | Re-run the *Deploy* workflow; the agent needs a restart after editing `agent.env`. |

## 13. Uninstall

[VM]:
```bash
sudo systemctl disable --now tunnel-agent tunnel-demo-app
sudo rm /etc/systemd/system/tunnel-agent.service /etc/systemd/system/tunnel-demo-app.service
sudo systemctl daemon-reload
sudo rm -rf /opt/tunnel-agent /etc/tunnel-agent /var/lib/tunnel-agent
sudo rm -f /etc/sysctl.d/99-quic.conf
sudo userdel tunnelagent
```

[local]: delete the Worker with `cd web && npx wrangler delete`, or in the Cloudflare dashboard (*Workers & Pages → tunnel-control → Settings → Delete*).
