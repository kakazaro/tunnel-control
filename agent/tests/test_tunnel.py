from __future__ import annotations

import pytest

from tunnel_agent.tunnel import QuickTunnel, TunnelStartError


def make(binary, **kw):
    kw.setdefault("start_timeout", 20)
    return QuickTunnel(binary, "http://localhost:8080", **kw)


def test_start_extracts_url_and_stop_terminates(fake_bin):
    t = make(fake_bin("ok"))
    t.start()
    try:
        assert t.is_running()
        assert t.url == "https://test-abc-123.trycloudflare.com"
        assert t.started_at is not None
    finally:
        t.stop()
    assert not t.is_running()
    assert t.url is None and t.started_at is None


def test_start_twice_is_noop(fake_bin):
    t = make(fake_bin("ok"))
    t.start()
    try:
        proc = t._proc
        t.start()
        assert t._proc is proc
    finally:
        t.stop()


def test_timeout_raises_with_log_lines(fake_bin):
    t = make(fake_bin("no_url"), start_timeout=5.0)
    with pytest.raises(TunnelStartError) as exc:
        t.start()
    assert "timed out" in str(exc.value)
    assert "Thank you for trying" in str(exc.value)
    assert not t.is_running()


def test_crash_on_start_raises(fake_bin):
    t = make(fake_bin("crash"))
    with pytest.raises(TunnelStartError) as exc:
        t.start()
    assert "something went wrong" in str(exc.value)


def test_missing_binary_raises():
    with pytest.raises(TunnelStartError):
        make("/nonexistent/cloudflared").start()


def test_process_death_makes_is_running_false(fake_bin):
    t = make(fake_bin("ok"))
    t.start()
    t._proc.kill()
    t._proc.wait()
    assert not t.is_running()
    assert t.url is None
    assert "exited with code" in t.exit_summary()


def test_version(fake_bin):
    assert make(fake_bin("ok")).cloudflared_version() == "cloudflared version 0000.0.0 (fake)"
    assert make("/nonexistent/cloudflared").cloudflared_version() is None


def test_command_line():
    t = QuickTunnel("cf", "http://x:1", protocol="http2", metrics="127.0.0.1:9")
    assert t.build_command() == [
        "cf",
        "tunnel",
        "--no-autoupdate",
        "--metrics",
        "127.0.0.1:9",
        "--url",
        "http://x:1",
        "--protocol",
        "http2",
    ]
    assert "--protocol" not in QuickTunnel("cf").build_command()
