from __future__ import annotations

import json

import pytest
import requests

from tunnel_agent.client import AuthError, ControlClient, ProtocolError, ServerError, Status

URL = "https://tc.example.workers.dev/api/agent/sync"


class Resp:
    def __init__(self, code=200, body=None, bad_json=False):
        self.status_code, self._body, self._bad = code, body, bad_json

    def json(self):
        if self._bad:
            raise ValueError("nope")
        return self._body


class FakeSession:
    def __init__(self, result):
        self.headers = {}
        self.result, self.calls = result, []

    def post(self, url, json=None, timeout=None):
        self.calls.append((url, json, timeout))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def client(result):
    s = FakeSession(result)
    return ControlClient(URL, "secret-token", 15, session=s), s


STATUS = Status("vm-1", "host", True, "https://a-b.trycloudflare.com", 123, None, "cf 1")


def test_ok_and_request_shape():
    c, s = client(Resp(200, {"desired": "running", "pollIntervalSeconds": 45, "serverTime": 9}))
    r = c.sync(STATUS)
    assert (r.desired, r.poll_interval_seconds, r.server_time) == ("running", 45, 9)
    url, body, timeout = s.calls[0]
    assert url == URL and timeout == 15
    assert set(body) == {
        "agentId",
        "agentVersion",
        "hostname",
        "running",
        "url",
        "startedAt",
        "lastError",
        "cloudflaredVersion",
    }
    assert body["url"] == "https://a-b.trycloudflare.com" and body["startedAt"] == 123
    assert s.headers["Authorization"] == "Bearer secret-token"
    assert s.headers["User-Agent"].startswith("tunnel-agent/")
    json.dumps(body)


def test_missing_optional_fields():
    c, _ = client(Resp(200, {"desired": "stopped"}))
    assert c.sync(STATUS).poll_interval_seconds is None


@pytest.mark.parametrize("code", [401, 403])
def test_auth_error(code):
    with pytest.raises(AuthError):
        client(Resp(code))[0].sync(STATUS)


@pytest.mark.parametrize("code", [500, 502, 429])
def test_server_error(code):
    with pytest.raises(ServerError):
        client(Resp(code))[0].sync(STATUS)


@pytest.mark.parametrize("exc", [requests.Timeout(), requests.ConnectionError()])
def test_network_errors(exc):
    with pytest.raises(ServerError):
        client(exc)[0].sync(STATUS)


@pytest.mark.parametrize(
    "resp",
    [Resp(200, bad_json=True), Resp(200, ["x"]), Resp(200, {"desired": "paused"}), Resp(400)],
)
def test_protocol_error(resp):
    with pytest.raises(ProtocolError):
        client(resp)[0].sync(STATUS)


def test_explicit_timeout():
    c, s = client(Resp(200, {"desired": "stopped"}))
    c.sync(STATUS, timeout=2)
    assert s.calls[0][2] == 2


def test_payload_respects_server_length_limits():
    from tunnel_agent.client import Status

    payload = Status(
        agent_id="vm-1",
        hostname="h" * 400,
        running=False,
        last_error="e" * 5000,
        cloudflared_version="v" * 500,
    ).to_payload()
    assert len(payload["hostname"]) == 255
    assert len(payload["lastError"]) == 2000
    assert len(payload["cloudflaredVersion"]) == 100


def test_sync_response_carries_the_session_end(monkeypatch):
    import requests

    from tunnel_agent.client import ControlClient

    class Resp:
        status_code = 200

        def json(self):
            return {"desired": "running", "expiresAt": 1760003600000, "serverTime": 1760000000000}

    session = requests.Session()
    monkeypatch.setattr(session, "post", lambda *a, **k: Resp())
    got = ControlClient("http://x/api/agent/sync", "t", session=session).sync(
        __import__("tunnel_agent.client", fromlist=["Status"]).Status("vm-1", "h", False)
    )
    assert got.expires_at == 1760003600000 and got.server_time == 1760000000000
