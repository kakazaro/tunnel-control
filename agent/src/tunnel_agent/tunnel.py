"""QuickTunnel: manages one `cloudflared tunnel --url ...` child process."""

from __future__ import annotations

import collections
import logging
import re
import subprocess
import threading
import time
from typing import Deque, List, Optional

log = logging.getLogger(__name__)

URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


class TunnelStartError(RuntimeError):
    """cloudflared did not produce a URL (timeout or early exit)."""


class QuickTunnel:
    def __init__(
        self,
        binary: str,
        target_url: str = "http://localhost:8080",
        protocol: str = "auto",
        metrics: str = "127.0.0.1:20241",
        start_timeout: float = 30.0,
    ) -> None:
        self._binary = binary
        self._target = target_url
        self._protocol = protocol
        self._metrics = metrics
        self._start_timeout = start_timeout
        self._lock = threading.Lock()
        self._proc: Optional["subprocess.Popen[str]"] = None
        self._url: Optional[str] = None
        self._started_at: Optional[int] = None
        self._logs: Deque[str] = collections.deque(maxlen=50)
        self._version: Optional[str] = None
        self._version_checked = False

    # -- state -------------------------------------------------------------
    @property
    def url(self) -> Optional[str]:
        return self._url if self.is_running() else None

    @property
    def started_at(self) -> Optional[int]:
        return self._started_at if self.is_running() else None

    def is_running(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def recent_logs(self, n: int = 5) -> List[str]:
        return list(self._logs)[-n:]

    def exit_summary(self) -> str:
        """Why the last process is gone (for lastError)."""
        code = self._proc.poll() if self._proc else None
        tail = " | ".join(self.recent_logs())
        return "cloudflared exited with code %s: %s" % (code, tail)

    # -- lifecycle ---------------------------------------------------------
    def build_command(self) -> List[str]:
        cmd = [self._binary, "tunnel", "--no-autoupdate", "--metrics", self._metrics]
        cmd += ["--url", self._target]
        if self._protocol != "auto":
            cmd += ["--protocol", self._protocol]
        return cmd

    def start(self) -> None:
        with self._lock:
            if self.is_running():
                return
            self._reset()
            try:
                proc = subprocess.Popen(
                    self.build_command(),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    bufsize=1,
                )
            except OSError as exc:
                raise TunnelStartError("cannot execute %s: %s" % (self._binary, exc)) from exc
            self._proc = proc
            found = threading.Event()
            threading.Thread(target=self._drain, args=(proc, found), daemon=True).start()

            deadline = time.monotonic() + self._start_timeout
            while not found.wait(0.05):
                if proc.poll() is not None:
                    found.wait(0.2)  # let the reader flush the last lines
                    break
                if time.monotonic() >= deadline:
                    break
            if not found.is_set():
                reason = "exited early" if proc.poll() is not None else "timed out waiting for URL"
                tail = " | ".join(self.recent_logs(10))
                self._terminate(proc)
                raise TunnelStartError("cloudflared %s: %s" % (reason, tail))
            self._started_at = int(time.time() * 1000)

    def stop(self) -> None:
        with self._lock:
            proc = self._proc
            if proc is not None:
                self._terminate(proc)
            self._reset()

    def cloudflared_version(self) -> Optional[str]:
        if not self._version_checked:
            self._version_checked = True
            try:
                out = subprocess.run(
                    [self._binary, "--version"],
                    capture_output=True,
                    text=True,
                    timeout=10,
                    check=False,
                )
                self._version = (out.stdout or out.stderr).strip().splitlines()[0] or None
            except (OSError, subprocess.SubprocessError, IndexError):
                self._version = None
        return self._version

    # -- internals ---------------------------------------------------------
    def _reset(self) -> None:
        self._proc = None
        self._url = None
        self._started_at = None

    def _drain(self, proc: "subprocess.Popen[str]", found: threading.Event) -> None:
        # Always drain stderr so the pipe can never fill up and block cloudflared.
        assert proc.stderr is not None
        for line in proc.stderr:
            line = line.rstrip()
            self._logs.append(line)
            if self._url is None and proc is self._proc:
                match = URL_RE.search(line)
                if match:
                    self._url = match.group(0)
                    found.set()

    @staticmethod
    def _terminate(proc: "subprocess.Popen[str]") -> None:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(10)
            except subprocess.TimeoutExpired:
                log.warning("cloudflared ignored SIGTERM, killing")
                proc.kill()
                proc.wait()
