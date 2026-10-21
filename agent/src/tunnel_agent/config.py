"""Environment loading and validation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Mapping, Optional
from urllib.parse import unquote, urlparse

MIN_POLL = 10
MAX_POLL = 300
LOCAL_HOSTS = ("localhost", "127.0.0.1")


class ConfigError(ValueError):
    """Raised when the environment is missing or invalid."""


@dataclass(frozen=True)
class Proxy:
    host: str
    port: int
    auth: Optional[tuple] = None  # (user, password)


@dataclass(frozen=True)
class Config:
    control_base_url: str
    agent_token: str
    agent_id: str = "vm-1"
    poll_interval: int = 60
    enable_websocket: bool = True
    tunnel_target_url: str = "http://localhost:8080"
    cloudflared_bin: str = "/usr/bin/cloudflared"
    tunnel_protocol: str = "auto"
    tunnel_metrics: str = "127.0.0.1:20241"
    start_timeout: float = 30.0
    http_timeout: float = 15.0
    log_level: str = "INFO"
    proxy: Optional[Proxy] = None
    no_proxy: tuple = ()

    @property
    def sync_url(self) -> str:
        return self.control_base_url + "/api/agent/sync"

    @property
    def ws_url(self) -> str:
        scheme = "wss" if self.control_base_url.startswith("https://") else "ws"
        return scheme + "://" + self.control_base_url.split("://", 1)[1] + "/api/agent/ws"


def clamp_poll(value: float) -> int:
    return int(max(MIN_POLL, min(MAX_POLL, value)))


def _num(env: Mapping[str, str], name: str, default: float) -> float:
    raw = env.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        raise ConfigError("%s must be a number, got %r" % (name, raw)) from None


def _bool(env: Mapping[str, str], name: str, default: bool) -> bool:
    raw = env.get(name, "").strip().lower()
    if not raw:
        return default
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    raise ConfigError("%s must be true or false, got %r" % (name, raw))


def _base_url(raw: str) -> str:
    if not raw:
        raise ConfigError("CONTROL_BASE_URL is required")
    parsed = urlparse(raw)
    if not parsed.hostname:
        raise ConfigError("CONTROL_BASE_URL is not a valid URL: %r" % raw)
    if parsed.scheme != "https" and not (
        parsed.scheme == "http" and parsed.hostname in LOCAL_HOSTS
    ):
        raise ConfigError(
            "CONTROL_BASE_URL must be https:// (http:// only for localhost / 127.0.0.1)"
        )
    return raw.rstrip("/")


def parse_proxy(env: Mapping[str, str]) -> Optional[Proxy]:
    raw = env.get("HTTPS_PROXY") or env.get("https_proxy") or ""
    if not raw.strip():
        return None
    parsed = urlparse(raw if "://" in raw else "http://" + raw)
    if not parsed.hostname:
        raise ConfigError("HTTPS_PROXY is not a valid URL")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    auth = None
    if parsed.username:
        auth = (unquote(parsed.username), unquote(parsed.password or ""))
    return Proxy(parsed.hostname, port, auth)


def load_config(env: Mapping[str, str]) -> Config:
    token = env.get("AGENT_TOKEN", "").strip()
    if not token:
        raise ConfigError("AGENT_TOKEN is required")
    protocol = env.get("TUNNEL_PROTOCOL", "auto").strip().lower() or "auto"
    if protocol not in ("auto", "quic", "http2"):
        raise ConfigError("TUNNEL_PROTOCOL must be auto, quic or http2")
    level = env.get("LOG_LEVEL", "INFO").strip().upper() or "INFO"
    if level not in ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"):
        raise ConfigError("LOG_LEVEL is not a valid level: %r" % level)
    no_proxy: List[str] = [
        h.strip()
        for h in (env.get("NO_PROXY") or env.get("no_proxy") or "").split(",")
        if h.strip()
    ]
    return Config(
        control_base_url=_base_url(env.get("CONTROL_BASE_URL", "").strip()),
        agent_token=token,
        agent_id=env.get("AGENT_ID", "").strip() or "vm-1",
        poll_interval=clamp_poll(_num(env, "POLL_INTERVAL_SECONDS", 60)),
        enable_websocket=_bool(env, "ENABLE_WEBSOCKET", True),
        tunnel_target_url=env.get("TUNNEL_TARGET_URL", "").strip() or "http://localhost:8080",
        cloudflared_bin=env.get("CLOUDFLARED_BIN", "").strip() or "/usr/bin/cloudflared",
        tunnel_protocol=protocol,
        tunnel_metrics=env.get("TUNNEL_METRICS", "").strip() or "127.0.0.1:20241",
        start_timeout=_num(env, "TUNNEL_START_TIMEOUT_SECONDS", 30),
        http_timeout=_num(env, "HTTP_TIMEOUT_SECONDS", 15),
        log_level=level,
        proxy=parse_proxy(env),
        no_proxy=tuple(no_proxy),
    )
