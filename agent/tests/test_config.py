from __future__ import annotations

import pytest

from tunnel_agent.config import ConfigError, load_config

BASE = {"CONTROL_BASE_URL": "https://tc.example.workers.dev/", "AGENT_TOKEN": "t" * 32}


def env(**kw):
    return {**BASE, **kw}


def test_defaults_and_urls():
    cfg = load_config(BASE)
    assert cfg.control_base_url == "https://tc.example.workers.dev"
    assert cfg.sync_url == "https://tc.example.workers.dev/api/agent/sync"
    assert cfg.ws_url == "wss://tc.example.workers.dev/api/agent/ws"
    assert (cfg.agent_id, cfg.poll_interval, cfg.enable_websocket) == ("vm-1", 60, True)
    assert cfg.tunnel_target_url == "http://localhost:8080"
    assert cfg.proxy is None


@pytest.mark.parametrize("missing", ["CONTROL_BASE_URL", "AGENT_TOKEN"])
def test_required(missing):
    e = dict(BASE)
    del e[missing]
    with pytest.raises(ConfigError, match=missing):
        load_config(e)


@pytest.mark.parametrize(("raw", "expected"), [("1", 10), ("5000", 300), ("90", 90)])
def test_poll_clamped(raw, expected):
    assert load_config(env(POLL_INTERVAL_SECONDS=raw)).poll_interval == expected


@pytest.mark.parametrize(
    "url", ["http://evil.example.com", "ftp://x", "tc.example.com", "https://"]
)
def test_bad_base_url(url):
    with pytest.raises(ConfigError):
        load_config(env(CONTROL_BASE_URL=url))


def test_http_localhost_allowed():
    cfg = load_config(env(CONTROL_BASE_URL="http://localhost:5173"))
    assert cfg.ws_url == "ws://localhost:5173/api/agent/ws"
    assert load_config(env(CONTROL_BASE_URL="http://127.0.0.1:8787")).sync_url.startswith("http://")


@pytest.mark.parametrize(
    "bad",
    [
        {"POLL_INTERVAL_SECONDS": "abc"},
        {"ENABLE_WEBSOCKET": "maybe"},
        {"TUNNEL_PROTOCOL": "tcp"},
        {"LOG_LEVEL": "LOUD"},
    ],
)
def test_invalid_values(bad):
    with pytest.raises(ConfigError):
        load_config(env(**bad))


def test_websocket_flag():
    assert load_config(env(ENABLE_WEBSOCKET="false")).enable_websocket is False


def test_proxy_parsing():
    cfg = load_config(env(HTTPS_PROXY="http://u%40x:p@proxy.local:3128", NO_PROXY="a.com, b.com"))
    assert (cfg.proxy.host, cfg.proxy.port, cfg.proxy.auth) == ("proxy.local", 3128, ("u@x", "p"))
    assert cfg.no_proxy == ("a.com", "b.com")
