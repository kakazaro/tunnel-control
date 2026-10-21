"""Fake cloudflared for tests. Behaviour is selected with FAKE_MODE (ok | no_url | crash).

Logs go to stderr, like the real binary. The fake also exits when its parent disappears and
after FAKE_LIFETIME seconds, so a killed wrapper (Windows .cmd) cannot leave it running.
"""

from __future__ import annotations

import os
import signal
import sys
import time


def parent_alive(ppid: int) -> bool:
    if os.name == "nt":
        import ctypes

        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, ppid)  # QUERY_LIMITED_INFO
        if not handle:
            return False
        code = ctypes.c_ulong()
        ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(handle)
        return code.value == 259  # STILL_ACTIVE
    return os.getppid() == ppid


def log(line: str) -> None:
    print(line, file=sys.stderr, flush=True)


def main() -> int:
    if "--version" in sys.argv[1:]:
        print("cloudflared version 0000.0.0 (fake)")
        return 0
    mode = os.environ.get("FAKE_MODE", "ok")
    signal.signal(signal.SIGTERM, lambda *_: os._exit(0))
    log("INF Thank you for trying Cloudflare Tunnel (fake)")
    log("INF args: " + " ".join(sys.argv[1:]))
    if mode == "crash":
        log("ERR something went wrong")
        return 1
    if mode == "ok":
        log("INF Requesting new quick Tunnel on trycloudflare.com...")
        log("INF |  https://test-abc-123.trycloudflare.com  |")
    ppid = os.getppid()
    deadline = time.monotonic() + float(os.environ.get("FAKE_LIFETIME", "120"))
    while time.monotonic() < deadline and parent_alive(ppid):
        time.sleep(0.1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
