"""HTTP client for POST /api/agent/sync."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional

import requests

from . import __version__

log = logging.getLogger(__name__)


class ClientError(Exception):
    pass


class AuthError(ClientError):
    """401/403: AGENT_TOKEN mismatch?"""


class ServerError(ClientError):
    """5xx, 429, network error or timeout. Retry on the next tick."""


class ProtocolError(ClientError):
    """The response did not look like the documented contract."""


@dataclass
class Status:
    agent_id: str
    hostname: str
    running: bool
    url: Optional[str] = None
    started_at: Optional[int] = None
    last_error: Optional[str] = None
    cloudflared_version: Optional[str] = None
    agent_version: str = __version__

    def to_payload(self) -> Dict[str, Any]:
        """camelCase body of the sync request (no lastSeen: the server owns time)."""
        return {
            "agentId": self.agent_id,
            "agentVersion": self.agent_version[:32],
            "hostname": self.hostname[:255],
            "running": self.running,
            "url": self.url,
            "startedAt": self.started_at,
            # Same limits as the server's schema: an over-long value would be a 400.
            "lastError": self.last_error[:2000] if self.last_error else None,
            "cloudflaredVersion": (
                self.cloudflared_version[:100] if self.cloudflared_version else None
            ),
        }


@dataclass
class SyncResponse:
    desired: str
    poll_interval_seconds: Optional[int]
    server_time: Optional[int]
    # Epoch ms (server time) when the running session ends; None when stopped.
    expires_at: Optional[int] = None


class ControlClient:
    def __init__(
        self,
        sync_url: str,
        token: str,
        timeout: float = 15.0,
        session: Optional[requests.Session] = None,
    ) -> None:
        self._url = sync_url
        self._timeout = timeout
        self._session = session or requests.Session()
        self._session.headers["Authorization"] = "Bearer " + token
        self._session.headers["User-Agent"] = "tunnel-agent/" + __version__

    def sync(self, status: Status, timeout: Optional[float] = None) -> SyncResponse:
        try:
            resp = self._session.post(
                self._url, json=status.to_payload(), timeout=timeout or self._timeout
            )
        except requests.RequestException as exc:
            raise ServerError("control API unreachable: %s" % type(exc).__name__) from exc
        code = resp.status_code
        if code in (401, 403):
            raise AuthError("control API rejected the token (HTTP %d)" % code)
        if code >= 500 or code == 429:
            raise ServerError("control API error (HTTP %d)" % code)
        if code != 200:
            raise ProtocolError("unexpected HTTP %d from control API" % code)
        try:
            data = resp.json()
        except ValueError as exc:
            raise ProtocolError("response is not valid JSON") from exc
        if not isinstance(data, dict) or data.get("desired") not in ("running", "stopped"):
            raise ProtocolError("response has no valid 'desired' field")
        return SyncResponse(
            desired=data["desired"],
            poll_interval_seconds=_int_or_none(data.get("pollIntervalSeconds")),
            server_time=_int_or_none(data.get("serverTime")),
            expires_at=_int_or_none(data.get("expiresAt")),
        )


def _int_or_none(value: Any) -> Optional[int]:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return int(value)
    return None
