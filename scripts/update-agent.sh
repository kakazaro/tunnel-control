#!/usr/bin/env bash
# Pull the latest code, reinstall, restart the services. Usage: sudo ./scripts/update-agent.sh [--port N]
# (Behind a proxy: sudo -E ./scripts/update-agent.sh)
set -euo pipefail

main() {
  local repo_dir
  repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

  [ "$(id -u)" -eq 0 ] || { echo "ERROR: run with sudo" >&2; exit 1; }
  [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ] ||
    { echo "ERROR: run via sudo from your normal user (SUDO_USER is not set)" >&2; exit 1; }

  # Pull as the clone's owner: avoids git's "dubious ownership" error when run as root.
  echo "==> git pull (as $SUDO_USER)"
  (cd "$repo_dir" && sudo -u "$SUDO_USER" git pull)

  # install-agent.sh is idempotent: recopies code, refreshes deps, keeps agent.env.
  echo "==> reinstalling"
  "$repo_dir/scripts/install-agent.sh" "$@"

  echo "==> starting agent if stopped"
  systemctl start tunnel-agent.service  # install-agent.sh already restarted it if it was running
  systemctl status --no-pager tunnel-agent.service || true
}

# Everything is inside main() so that a `git pull` replacing this file mid-run is harmless.
main "$@"
exit $?
