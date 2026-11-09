#!/usr/bin/env bash
# Print a random 64-hex-character secret (for AGENT_TOKEN / SESSION_SECRET / ADMIN_PASSWORD).
# Works on Linux, macOS, and Windows (Git Bash, MSYS2, Cygwin, WSL): it uses the first tool
# found that has a cryptographically secure random source.
#   Windows:  bash scripts/gen-secret.sh      (Git Bash)   or   wsl ./scripts/gen-secret.sh
set -euo pipefail

have() { command -v "$1" > /dev/null 2>&1; }

# 1. openssl (Linux, macOS, Git for Windows ships it)
if have openssl; then
  openssl rand -hex 32
  exit 0
fi

# 2. Python (os.urandom is cryptographically secure); "python" is the name on Windows
for py in python3 python; do
  if have "$py" && "$py" -c 'import sys; sys.exit(0 if sys.version_info[0] >= 3 else 1)' 2> /dev/null; then
    "$py" -c 'import secrets; print(secrets.token_hex(32))'
    exit 0
  fi
done

# 3. Kernel random device (Linux, macOS, MSYS2, Cygwin, WSL)
if [ -r /dev/urandom ] && have od; then
  head -c 32 /dev/urandom | od -An -vtx1 | tr -d ' \n'
  echo
  exit 0
fi

# 4. Windows PowerShell, for a plain Windows setup that has none of the above
for ps in powershell.exe pwsh.exe pwsh; do
  if have "$ps"; then
    # shellcheck disable=SC2016  # the $ signs belong to PowerShell, not to bash
    "$ps" -NoProfile -NonInteractive -Command \
      '$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString("x2") }) -join ""' |
      tr -d '\r'
    exit 0
  fi
done

echo "ERROR: need one of: openssl, python, /dev/urandom + od, or PowerShell" >&2
exit 1
