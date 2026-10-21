"""WebSocket listener: only ever sets the reconciler's `wake` event."""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any, Callable, Dict, Optional

import websocket

from . import __version__
from .config import Proxy

log = logging.getLogger(__name__)

BACKOFF_START = 5.0
BACKOFF_CAP = 300.0
PING_INTERVAL = 30.0
PONG_TIMEOUT = 10.0
RECV_TIMEOUT = 1.0


class NudgeListener:
    def __init__(
        self,
        url: str,
        token: str,
        wake: threading.Event,
        proxy: Optional[Proxy] = None,
        no_proxy: tuple = (),
        connect: Optional[Callable[..., Any]] = None,
        stop: Optional[threading.Event] = None,
        sleep: Optional[Callable[[float], Any]] = None,
        clock: Callable[[], float] = time.monotonic,
        ping_interval: float = PING_INTERVAL,
        pong_timeout: float = PONG_TIMEOUT,
    ) -> None:
        self._url = url
        self._token = token
        self._wake = wake
        self._proxy = proxy
        self._no_proxy = list(no_proxy)
        self._connect = connect or websocket.create_connection
        self._stop = stop or threading.Event()
        self._sleep = sleep or self._stop.wait
        self._clock = clock
        self._ping_interval = ping_interval
        self._pong_timeout = pong_timeout
        self.connected = False
        self._thread: Optional[threading.Thread] = None
        self._conn: Any = None

    # -- thread control ----------------------------------------------------
    def start(self) -> None:
        self._thread = threading.Thread(target=self.run, name="nudge", daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._stop.set()
        conn = self._conn
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001 - best effort during shutdown
                pass
        if self._thread is not None:
            self._thread.join(timeout=3)

    # -- main loop ---------------------------------------------------------
    def run(self) -> None:
        delay = BACKOFF_START
        warned = False
        while not self._stop.is_set():
            try:
                conn = self._open()
            except Exception as exc:  # noqa: BLE001 - any failure means "retry later"
                if not warned:
                    warned = True
                    self._warn_failure(exc)
                if self._stop.is_set():
                    break
                self._sleep(delay)
                delay = min(delay * 2, BACKOFF_CAP)
                continue
            delay, warned = BACKOFF_START, False
            self._conn = conn
            self.connected = True
            log.info("WebSocket connected")
            self._wake.set()  # catch up on anything missed while disconnected
            try:
                self.serve(conn)
            except Exception as exc:  # noqa: BLE001
                log.debug("WebSocket error: %s", exc)
            finally:
                self.connected = False
                self._conn = None
                try:
                    conn.close()
                except Exception:  # noqa: BLE001
                    pass
            if self._stop.is_set():
                break
            log.warning("WebSocket disconnected, will retry in %.0fs", delay)
            self._sleep(delay)
            delay = min(delay * 2, BACKOFF_CAP)

    def _open(self) -> Any:
        kwargs: Dict[str, Any] = {
            "header": [
                "Authorization: Bearer " + self._token,
                "User-Agent: tunnel-agent/" + __version__,
            ],
            "timeout": 15,
        }
        if self._proxy is not None:
            kwargs["http_proxy_host"] = self._proxy.host
            kwargs["http_proxy_port"] = self._proxy.port
            kwargs["http_no_proxy"] = self._no_proxy
            if self._proxy.auth:
                kwargs["http_proxy_auth"] = self._proxy.auth
        conn = self._connect(self._url, **kwargs)
        conn.settimeout(RECV_TIMEOUT)
        return conn

    @staticmethod
    def _warn_failure(exc: Exception) -> None:
        status = getattr(exc, "status_code", None)
        if status in (401, 403):
            log.warning("WebSocket rejected (HTTP %s): AGENT_TOKEN mismatch?", status)
        else:
            log.warning("WebSocket connect failed (%s), falling back to polling", exc)

    def serve(self, conn: Any) -> None:
        """Read until the connection dies. Raises on any failure."""
        next_ping = self._clock() + self._ping_interval
        pong_deadline: Optional[float] = None
        while not self._stop.is_set():
            now = self._clock()
            if pong_deadline is not None and now > pong_deadline:
                raise TimeoutError("no pong within %.0fs" % self._pong_timeout)
            if pong_deadline is None and now >= next_ping:
                conn.send("ping")
                pong_deadline = now + self._pong_timeout
                next_ping = now + self._ping_interval
            try:
                msg = conn.recv()
            except websocket.WebSocketTimeoutException:
                continue
            if msg is None or msg == b"" or msg == "":
                raise ConnectionError("connection closed")
            if isinstance(msg, bytes):
                msg = msg.decode("utf-8", "replace")
            if msg == "pong":
                pong_deadline = None
                continue
            try:
                data = json.loads(msg)
            except ValueError:
                continue
            if isinstance(data, dict) and data.get("type") == "nudge":
                log.debug("nudge received")
                self._wake.set()
