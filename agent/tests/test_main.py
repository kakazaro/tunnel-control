from __future__ import annotations

import pytest

from tunnel_agent import __version__
from tunnel_agent.__main__ import main


def test_version(capsys):
    with pytest.raises(SystemExit) as exc:
        main(["--version"])
    assert exc.value.code == 0
    assert __version__ in capsys.readouterr().out


def test_config_error_exits_2(monkeypatch, capsys):
    monkeypatch.delenv("AGENT_TOKEN", raising=False)
    assert main(["--once"]) == 2
    assert "AGENT_TOKEN" in capsys.readouterr().err
