"""Reconciler: make the actual tunnel state match the desired state.

Everything time- or I/O-related is injected (tunnel, client, wake, clock, jitter)
so tests need no real sleeping or network.
"""

from __future__ import annotations

import logging
import random
import threading
import time
from typing import Any, Callable, Optional

from .client import AuthError, ClientError, ControlClient, Status, SyncResponse
from .config import clamp_poll
from .tunnel import QuickTunnel, TunnelStartError

log = logging.getLogger(__name__)

BACKOFF_BASE = 60.0
BACKOFF_CAP = 300.0
FINAL_SYNC_TIMEOUT = 2.0


class Reconciler:
    def __init__(
        self,
        tunnel: QuickTunnel,
        client: ControlClient,
        wake: threading.Event,
        agent_id: str,
        hostname: str,
        interval: int = 60,
        clock: Callable[[], float] = time.monotonic,
        jitter: Callable[[float, float], float] = random.uniform,
    ) -> None:
        self.tunnel = tunnel
        self.client = client
        self.wake = wake
        self.agent_id = agent_id
        self.hostname = hostname
        self.interval = interval
        self._clock = clock
        self._jitter = jitter
        self._stopping = False
        self.last_error: Optional[str] = None
        self._failures = 0
        self._next_start_at = 0.0
        self._was_running = False
        self._desired: Optional[str] = None
        # When the session ends, on this agent's monotonic clock. Enforced locally so the
        # tunnel still closes if the control API is unreachable. None = no limit known.
        self._deadline: Optional[float] = None

    # -- public ------------------------------------------------------------
    def request_stop(self) -> None:
        """Safe to call from a signal handler."""
        self._stopping = True
        self.wake.set()

    def run(self) -> None:
        try:
            while not self._stopping:
                try:
                    self.tick()
                except Exception:  # noqa: BLE001 - the loop must never die
                    log.exception("unexpected error during tick")
                if self._stopping:
                    break
                self.wake.wait(self.next_wait())
                self.wake.clear()
        finally:
            self.shutdown()

    def next_wait(self) -> float:
        """Seconds to wait before the next tick: the poll interval, or less near session end."""
        timeout = self.interval * self._jitter(0.9, 1.1)
        if self._deadline is not None and self.tunnel.is_running():
            timeout = min(timeout, max(0.05, self._deadline - self._clock()))
        return timeout

    def tick(self) -> None:
        """One sync + reconcile (+ an immediate second sync if something changed)."""
        self._enforce_deadline()
        desired = self._sync(self.status())
        if desired is None:
            return
        before = self._snapshot()
        self._reconcile(desired)
        if self._snapshot() != before:
            self._sync(self.status())

    def shutdown(self) -> None:
        log.info("shutting down")
        try:
            self.tunnel.stop()
        except Exception:  # noqa: BLE001
            log.exception("failed to stop tunnel")
        try:
            self.client.sync(self.status(), timeout=FINAL_SYNC_TIMEOUT)
        except ClientError as exc:
            log.warning("final sync failed: %s", exc)

    def status(self) -> Status:
        running = self.tunnel.is_running()
        return Status(
            agent_id=self.agent_id,
            hostname=self.hostname,
            running=running,
            url=self.tunnel.url if running else None,
            started_at=self.tunnel.started_at if running else None,
            last_error=self.last_error,
            cloudflared_version=self.tunnel.cloudflared_version(),
        )

    # -- internals ---------------------------------------------------------
    def _snapshot(self) -> Any:
        return (self.tunnel.is_running(), self.tunnel.url, self.last_error)

    def _sync(self, status: Status) -> Optional[str]:
        try:
            resp: SyncResponse = self.client.sync(status)
        except AuthError as exc:
            log.error("%s: AGENT_TOKEN mismatch? Will keep retrying", exc)
            return None
        except ClientError as exc:
            log.warning("sync failed, keeping current tunnel state: %s", exc)
            return None
        if resp.poll_interval_seconds is not None:
            self.interval = clamp_poll(resp.poll_interval_seconds)
        if resp.expires_at is not None and resp.server_time is not None:
            remaining = (resp.expires_at - resp.server_time) / 1000.0
            self._deadline = self._clock() + remaining
        elif resp.desired == "stopped" or resp.expires_at is None:
            self._deadline = None
        if resp.desired != self._desired:
            log.info("desired state: %s", resp.desired)
            self._desired = resp.desired
        return resp.desired

    def _reconcile(self, desired: str) -> None:
        running = self.tunnel.is_running()
        if self._was_running and not running:
            self.last_error = self.tunnel.exit_summary()
            log.error("tunnel died unexpectedly: %s", self.last_error)
        self._was_running = running

        if desired == "stopped":
            self._failures = 0
            self._next_start_at = 0.0
            if running:
                self.tunnel.stop()
                log.info("tunnel stopped")
            self.last_error = None
            self._was_running = False
        elif not running:
            self._try_start()

    def _session_over(self) -> bool:
        return self._deadline is not None and self._clock() >= self._deadline

    def _enforce_deadline(self) -> None:
        """Stop the tunnel when the session time is up, with or without the control API."""
        if self.tunnel.is_running() and self._session_over():
            log.warning("session time is up: stopping the tunnel")
            self.tunnel.stop()
            self._was_running = False
            self.last_error = None

    def _try_start(self) -> None:
        if self._session_over():
            # The server may lag a moment behind our clock: never reopen an expired session.
            log.debug("session already over: not starting")
            return
        now = self._clock()
        if now < self._next_start_at:
            log.debug("start gated for another %.0fs", self._next_start_at - now)
            return
        try:
            self.tunnel.start()
        except TunnelStartError as exc:
            delay = min(BACKOFF_BASE * (2**self._failures), BACKOFF_CAP)
            self._failures += 1
            self._next_start_at = now + delay
            self.last_error = str(exc)
            log.error("tunnel start failed (next attempt in %.0fs): %s", delay, exc)
            return
        self._failures = 0
        self._next_start_at = 0.0
        self.last_error = None
        self._was_running = True
        log.info("tunnel started: %s", self.tunnel.url)
