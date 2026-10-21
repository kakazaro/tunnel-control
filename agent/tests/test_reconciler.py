from __future__ import annotations

import threading

import pytest

from tunnel_agent.client import AuthError, ServerError, SyncResponse
from tunnel_agent.reconciler import Reconciler
from tunnel_agent.tunnel import TunnelStartError


class FakeTunnel:
    def __init__(self):
        self.running, self._url = False, None
        self.starts = self.stops = 0
        self.fail_start = None  # exception to raise from start()

    @property
    def url(self):
        return self._url if self.running else None

    started_at = 1000

    def is_running(self):
        return self.running

    def start(self):
        self.starts += 1
        if self.fail_start:
            raise self.fail_start
        self.running, self._url = True, "https://x-y.trycloudflare.com"

    def stop(self):
        self.stops += 1
        self.running = False

    def cloudflared_version(self):
        return "cf-fake"

    def exit_summary(self):
        return "cloudflared exited with code 1: boom"


class FakeClient:
    def __init__(self):
        self.desired = "stopped"
        self.interval = None
        self.error = None
        self.expires_at = None
        self.server_ms = 1000 * 1000  # the server clock, in ms
        self.calls = []

    def sync(self, status, timeout=None):
        self.calls.append((status, timeout))
        if self.error:
            raise self.error
        return SyncResponse(self.desired, self.interval, self.server_ms, self.expires_at)


class FakeWake:
    """Event stand-in: records waits instead of sleeping; optional hook per wait."""

    def __init__(self):
        self.waits, self.flag, self.on_wait = [], False, None

    def wait(self, timeout=None):
        self.waits.append(timeout)
        if self.on_wait:
            self.on_wait()
        return self.flag

    def set(self):
        self.flag = True

    def clear(self):
        self.flag = False


@pytest.fixture
def env():
    clock = [0.0]
    t, c, w = FakeTunnel(), FakeClient(), FakeWake()
    r = Reconciler(t, c, w, "vm-1", "host", 60, clock=lambda: clock[0], jitter=lambda a, b: 1.0)
    return r, t, c, w, clock


def test_start_when_desired_running_and_resync_immediately(env):
    r, t, c, *_ = env
    c.desired = "running"
    r.tick()
    assert t.starts == 1 and t.running
    assert len(c.calls) == 2  # sync, start, immediate re-sync
    assert c.calls[0][0].running is False
    assert c.calls[1][0].running is True and c.calls[1][0].url == "https://x-y.trycloudflare.com"


def test_no_change_means_single_sync(env):
    r, t, c, *_ = env
    r.tick()
    assert len(c.calls) == 1 and t.starts == 0 and t.stops == 0


def test_stop_when_desired_stopped(env):
    r, t, c, *_ = env
    t.running = True
    r.tick()
    assert t.stops == 1
    assert len(c.calls) == 2 and c.calls[1][0].running is False


def test_crashed_tunnel_restarted_and_error_reported(env):
    r, t, c, *_ = env
    c.desired = "running"
    r.tick()
    t.running = False  # process died
    r.tick()
    assert t.starts == 2
    assert c.calls[-1][0].last_error is None  # restarted successfully
    assert c.calls[-2][0].running is False


def test_start_backoff_is_a_gate(env):
    r, t, c, w, clock = env
    c.desired = "running"
    t.fail_start = TunnelStartError("no url")
    r.tick()
    assert t.starts == 1
    assert c.calls[-1][0].last_error == "no url"  # error reported via immediate re-sync
    clock[0] = 59
    r.tick()
    assert t.starts == 1  # gated
    clock[0] = 60
    r.tick()
    assert t.starts == 2
    clock[0] = 60 + 119
    r.tick()
    assert t.starts == 2
    clock[0] = 60 + 120
    r.tick()
    assert t.starts == 3
    clock[0] += 239
    r.tick()
    assert t.starts == 3
    clock[0] += 1
    r.tick()
    assert t.starts == 4
    clock[0] += 299
    r.tick()
    assert t.starts == 4
    clock[0] += 1  # cap at 300
    r.tick()
    assert t.starts == 5
    assert w.waits == []  # gate never sleeps


def test_backoff_resets_on_success_and_on_stopped(env):
    r, t, c, _, clock = env
    c.desired = "running"
    t.fail_start = TunnelStartError("x")
    r.tick()
    c.desired = "stopped"
    r.tick()
    assert r.last_error is None
    c.desired = "running"
    r.tick()  # gate was reset by desired=stopped
    assert t.starts == 2


def test_api_unreachable_keeps_tunnel(env):
    r, t, c, *_ = env
    t.running = True
    c.error = ServerError("down")
    r.tick()
    assert t.running and t.stops == 0 and t.starts == 0


def test_auth_error_keeps_going(env, caplog):
    r, t, c, *_ = env
    c.error = AuthError("401")
    with caplog.at_level("ERROR"):
        r.tick()
    assert any("AGENT_TOKEN mismatch" in m.message for m in caplog.records)


def test_server_interval_adopted_and_clamped(env):
    r, _, c, *_ = env
    c.interval = 5
    r.tick()
    assert r.interval == 10
    c.interval = 45
    r.tick()
    assert r.interval == 45


def test_run_waits_interval_with_jitter_and_nudge_ends_wait(env):
    r, t, c, w, _ = env
    seen = []

    def on_wait():
        seen.append(len(c.calls))
        if len(w.waits) == 2:
            r.request_stop()

    w.on_wait = on_wait
    r.run()
    assert w.waits == [60.0, 60.0]
    # ticks: 2 loop syncs + 1 final sync from shutdown
    assert len(c.calls) == 3
    assert c.calls[-1][1] == 2.0  # final sync uses the 2s timeout


def test_nudge_wakes_loop_via_real_event():
    t, c = FakeTunnel(), FakeClient()
    wake = threading.Event()
    r = Reconciler(t, c, wake, "vm-1", "host", 3600)
    c.desired = "running"
    thread = threading.Thread(target=r.run)
    thread.start()
    deadline = threading.Event()
    while len(c.calls) < 2 and not deadline.wait(0.01):
        pass
    c.desired = "stopped"
    wake.set()  # nudge: must end the 1h wait immediately
    while t.running and not deadline.wait(0.01):
        if len(c.calls) > 50:
            break
    r.request_stop()
    thread.join(5)
    assert not thread.is_alive()
    assert t.stops >= 1


def test_shutdown_stops_tunnel_and_sends_final_status(env):
    r, t, c, w, _ = env
    c.desired = "running"
    t.running = True
    w.on_wait = r.request_stop
    r.run()
    assert t.stops == 1
    status, timeout = c.calls[-1]
    assert status.running is False and status.url is None and timeout == 2.0


def test_shutdown_survives_failing_api(env):
    r, t, c, *_ = env
    t.running = True
    c.error = ServerError("down")
    r.shutdown()  # must not raise
    assert t.stops == 1


# -- session expiry (fail-safe: enforced on the agent too) -----------------------------


def _session(c, seconds_left):
    """Make the fake server report a running session that ends in `seconds_left` seconds."""
    c.desired = "running"
    c.expires_at = int((1000 + seconds_left) * 1000)  # server clock: server_time is 1000 s


def test_stops_tunnel_at_session_end_even_if_api_is_down(env):
    r, t, c, w, clock = env
    _session(c, 3600)
    r.tick()
    assert t.running
    c.error = ServerError("down")  # the control API disappears
    clock[0] = 3599
    r.tick()
    assert t.running  # not yet
    clock[0] = 3601
    r.tick()
    assert not t.running and t.stops == 1


def test_does_not_reopen_an_expired_session_if_server_still_says_running(env):
    r, t, c, w, clock = env
    _session(c, 60)
    r.tick()
    assert t.starts == 1
    clock[0] = 61
    c.server_ms = 1061 * 1000
    c.expires_at = 1060 * 1000  # already past on the server clock too, but it still says running
    r.tick()
    assert not t.running and t.starts == 1


def test_new_session_after_expiry_starts_again(env):
    r, t, c, w, clock = env
    _session(c, 60)
    r.tick()
    clock[0] = 61
    c.server_ms = 1061 * 1000
    r.tick()
    assert not t.running
    c.expires_at = (1061 + 7200) * 1000  # the user started a new 2 h session
    r.tick()
    assert t.running and t.starts == 2


def test_wait_is_shortened_near_session_end(env):
    r, t, c, w, clock = env
    assert r.next_wait() == 60  # nothing running: normal interval
    _session(c, 10)
    r.tick()
    assert r.next_wait() == pytest.approx(10)  # session ends before the next poll
    clock[0] = 9.99
    assert r.next_wait() == pytest.approx(0.05)  # never a busy loop
    _session(c, 7200)
    clock[0] = 0
    r.tick()
    assert r.next_wait() == 60


def test_stopped_server_clears_the_deadline(env):
    r, t, c, w, clock = env
    _session(c, 60)
    r.tick()
    c.desired, c.expires_at = "stopped", None
    r.tick()
    assert not t.running
    assert r.next_wait() == 60
