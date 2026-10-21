#!/usr/bin/env bash
# Idempotent installer for the tunnel agent on a systemd-based Linux VM (RHEL family).
# Usage: sudo ./scripts/install-agent.sh [--tune-udp]
# Behind a proxy: sudo -E ./scripts/install-agent.sh   (so pip sees HTTPS_PROXY)
# Never overwrites /etc/tunnel-agent/agent.env.
set -euo pipefail

INSTALL_DIR=/opt/tunnel-agent
ENV_DIR=/etc/tunnel-agent
ENV_FILE=$ENV_DIR/agent.env
SERVICE_USER=tunnelagent
STATE_DIR=/var/lib/tunnel-agent
CLOUDFLARED_BIN=${CLOUDFLARED_BIN:-/usr/bin/cloudflared}
REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

die() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

TUNE_UDP=0
for arg in "$@"; do
  case "$arg" in
    --tune-udp) TUNE_UDP=1 ;;
    -h | --help) echo "Usage: sudo $0 [--tune-udp]"; exit 0 ;;
    *) die "unknown argument: $arg" ;;
  esac
done

# 1. Environment checks
[ "$(id -u)" -eq 0 ] || die "run as root (use sudo)"
[ "$(uname -s)" = "Linux" ] || die "Linux only"
command -v systemctl > /dev/null 2>&1 && [ -d /run/systemd/system ] || die "systemd is required"
[ -d "$REPO_DIR/agent/src/tunnel_agent" ] || die "cannot find agent/ next to scripts/ ($REPO_DIR)"

# 2. Python >= 3.9
PYTHON=""
for candidate in python3.13 python3.12 python3.11 python3.10 python3.9 python3; do
  if command -v "$candidate" > /dev/null 2>&1 &&
    "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'; then
    PYTHON=$(command -v "$candidate")
    break
  fi
done
if [ -z "$PYTHON" ]; then
  os_id=unknown
  os_ver=unknown
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    os_id=${ID:-unknown}
    os_ver=${VERSION_ID:-unknown}
  fi
  echo "No Python >= 3.9 found (detected OS: $os_id $os_ver)." >&2
  case "$os_id" in
    rhel | rocky | almalinux | centos | ol)
      case "$os_ver" in
        7*) echo "CentOS/RHEL 7 has no packaged Python 3.9+: upgrade the OS or build Python from source." >&2 ;;
        *) echo "Install it with:  sudo dnf install -y python3.11 git" >&2 ;;
      esac
      ;;
    *) echo "Install Python 3.9 or newer with your package manager, then re-run." >&2 ;;
  esac
  exit 1
fi
info "Using Python: $PYTHON ($("$PYTHON" --version 2>&1))"

# 3. cloudflared
[ -x "$CLOUDFLARED_BIN" ] || die "cloudflared not found at $CLOUDFLARED_BIN (set CLOUDFLARED_BIN or install it)"

# 4. Service user
if ! id -u "$SERVICE_USER" > /dev/null 2>&1; then
  info "Creating user $SERVICE_USER"
  useradd --system --user-group --home-dir "$STATE_DIR" --no-create-home \
    --shell /sbin/nologin "$SERVICE_USER"
fi

# 5. Code + venv (code is owned by root, read-only for the service)
info "Copying agent to $INSTALL_DIR"
install -d -m 755 "$INSTALL_DIR"
rm -rf "$INSTALL_DIR/src" "$INSTALL_DIR/demo_app"
cp -R "$REPO_DIR/agent/src" "$INSTALL_DIR/src"
cp -R "$REPO_DIR/agent/demo_app" "$INSTALL_DIR/demo_app"
cp "$REPO_DIR/agent/requirements.txt" "$INSTALL_DIR/requirements.txt"
find "$INSTALL_DIR/src" "$INSTALL_DIR/demo_app" -name '__pycache__' -type d -prune -exec rm -rf {} +
chown -R root:root "$INSTALL_DIR/src" "$INSTALL_DIR/demo_app" "$INSTALL_DIR/requirements.txt"
chmod -R u=rwX,go=rX "$INSTALL_DIR/src" "$INSTALL_DIR/demo_app"

info "Creating/refreshing virtualenv"
"$PYTHON" -m venv "$INSTALL_DIR/.venv" ||
  die "venv creation failed (on RHEL 8/9 install python3.11 which includes venv)"
"$INSTALL_DIR/.venv/bin/python" -m pip install --quiet --disable-pip-version-check --upgrade pip
"$INSTALL_DIR/.venv/bin/python" -m pip install --quiet --disable-pip-version-check \
  -r "$INSTALL_DIR/requirements.txt"

# 6. Env file: create only if missing, always enforce permissions
install -d -m 755 "$ENV_DIR"
if [ -e "$ENV_FILE" ]; then
  info "Keeping existing $ENV_FILE"
else
  info "Creating $ENV_FILE from example (edit it!)"
  install -m 600 -o root -g root "$REPO_DIR/deploy/tunnel-agent.env.example" "$ENV_FILE"
fi
chown root:root "$ENV_FILE"
chmod 600 "$ENV_FILE"

# 7. systemd units (enabled, not started: the env file must be edited first)
info "Installing systemd units"
install -m 644 "$REPO_DIR/deploy/systemd/tunnel-agent.service" /etc/systemd/system/
install -m 644 "$REPO_DIR/deploy/systemd/tunnel-demo-app.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable tunnel-demo-app.service tunnel-agent.service

# 8. Optional UDP buffer tuning for QUIC
if [ "$TUNE_UDP" -eq 1 ]; then
  info "Installing sysctl UDP buffer tuning"
  install -m 644 "$REPO_DIR/deploy/sysctl/99-quic.conf" /etc/sysctl.d/99-quic.conf
  sysctl -p /etc/sysctl.d/99-quic.conf
fi

cat <<EOF

Done. Next steps:
  1. Edit $ENV_FILE (CONTROL_BASE_URL, AGENT_TOKEN, AGENT_ID, ...)
  2. sudo systemctl start tunnel-demo-app tunnel-agent
  3. systemctl status tunnel-agent tunnel-demo-app
  4. journalctl -u tunnel-agent -f
EOF
