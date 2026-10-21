from __future__ import annotations

import threading

import pytest
import websocket

from tunnel_agent.config import Proxy
from tunnel_agent.nudge import BACKOFF_CAP, BACKOFF_START, NudgeListener


class FakeConn:
    """Scripted connection: str items are returned, exceptions are raised, then it closes."""

    def __init__(self, script, on_exhausted=None):
        self.script = list(script)
        self.sent, self.closed = [], False
        self.on_exhausted = on_exhausted

    def settimeout(self, _t):
        pass

    def send(self, msg):
        self.sent.append(msg)

    def close(self):
        self.closed = True

    def recv(self):
        if not self.script:
            if self.on_exhausted:
                self.on_exhausted()
            raise websocket.WebSocketConnectionClosedException("closed")
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def listener(connect, **kw):
    wake, stop, sleeps = threading.Event(), threading.Event(), []
    max_sleeps = kw.pop("max_sleeps", 99)

    def sleep(delay):
        sleeps.append(delay)
        if len(sleeps) >= max_sleeps:
            stop.set()

    nl = NudgeListener(
        "wss://x/api/agent/ws", "tok", wake, connect=connect, stop=stop, sleep=sleep, **kw
    )
    return nl, wake, stop, sleeps


def test_nudge_sets_wake_and_unknown_ignored():
    conn = FakeConn(['{"type":"other"}', "garbage", '{"type":"nudge"}'])
    nl, wake, *_ = listener(lambda *a, **k: conn)
    wake.clear()
    with pytest.raises(websocket.WebSocketConnectionClosedException):
        nl.serve(conn)
    assert wake.is_set()


def test_unknown_message_does_not_wake():
    conn = FakeConn(['{"type":"future"}', "not json", '{"a":1}', "[1]"])
    nl, wake, *_ = listener(lambda *a, **k: conn)
    with pytest.raises(websocket.WebSocketConnectionClosedException):
        nl.serve(conn)
    assert not wake.is_set()


def test_reconnect_sets_wake_once_per_connect():
    conns = [FakeConn([]), FakeConn([])]
    wakes = []
    nl, wake, stop, sleeps = listener(lambda *a, **k: conns.pop(0), max_sleeps=1)
    orig = wake.set
    wake.set = lambda: (wakes.append(1), orig())  # type: ignore[method-assign]
    nl.run()  # first connect -> wake; closes; sleep -> stop set after 1 sleep
    assert len(wakes) == 1
    assert sleeps == [BACKOFF_START]
    assert not nl.connected


def test_backoff_grows_caps_and_resets():
    attempts = []

    def connect(*a, **k):
        attempts.append(1)
        raise OSError("down")

    nl, _, _, sleeps = listener(connect, max_sleeps=10)
    nl.run()
    assert sleeps[:4] == [5, 10, 20, 40]
    assert max(sleeps) == BACKOFF_CAP and sleeps[-1] == BACKOFF_CAP


def test_backoff_resets_after_successful_connect():
    seq = [OSError("x"), OSError("x"), FakeConn([]), OSError("x")]

    def connect(*a, **k):
        item = seq.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    nl, _, _, sleeps = listener(connect, max_sleeps=4)
    nl.run()
    # 5, 10 (failures); connect+close -> 5 (reset); failure after that -> 10
    assert sleeps == [5, 10, 5, 10]


def test_failure_logged_once_per_streak(caplog):
    def connect(*a, **k):
        raise OSError("down")

    nl, *_ = listener(connect, max_sleeps=4)
    with caplog.at_level("WARNING"):
        nl.run()
    assert len([r for r in caplog.records if "connect failed" in r.message]) == 1


def test_401_handshake_hint(caplog):
    def connect(*a, **k):
        raise websocket.WebSocketBadStatusException("bad %s", 401)

    nl, *_ = listener(connect, max_sleeps=1)
    with caplog.at_level("WARNING"):
        nl.run()
    assert any("AGENT_TOKEN mismatch" in r.message for r in caplog.records)


def test_ping_sent_and_missing_pong_is_dead():
    now = [0.0]
    timeout = websocket.WebSocketTimeoutException()

    def advance():
        now[0] += 20

    conn = FakeConn([timeout] * 20)
    orig = conn.recv

    def recv():
        advance()
        return orig()

    conn.recv = recv  # type: ignore[method-assign]
    nl, *_ = listener(lambda *a, **k: conn, clock=lambda: now[0])
    with pytest.raises(TimeoutError):
        nl.serve(conn)
    assert conn.sent == ["ping"]


def test_pong_keeps_connection_alive():
    now = [0.0]
    conn = FakeConn([])
    timeout = websocket.WebSocketTimeoutException()
    items = [timeout, timeout, "pong"]

    def recv():
        now[0] += 20
        if items:
            item = items.pop(0)
            if isinstance(item, Exception):
                raise item
            return item
        raise websocket.WebSocketConnectionClosedException("end")

    conn.recv = recv  # type: ignore[method-assign]
    nl, *_ = listener(lambda *a, **k: conn, clock=lambda: now[0])
    with pytest.raises(websocket.WebSocketConnectionClosedException):
        nl.serve(conn)
    assert conn.sent[0] == "ping"


def test_connect_args_include_auth_and_proxy():
    captured = {}

    def connect(url, **kw):
        captured.update(kw, url=url)
        raise OSError("stop")

    nl, *_ = listener(
        connect, max_sleeps=1, proxy=Proxy("p.local", 3128, ("u", "pw")), no_proxy=("a",)
    )
    nl.run()
    assert "Authorization: Bearer tok" in captured["header"]
    assert (captured["http_proxy_host"], captured["http_proxy_port"]) == ("p.local", 3128)
    assert captured["http_proxy_auth"] == ("u", "pw") and captured["http_no_proxy"] == ["a"]
