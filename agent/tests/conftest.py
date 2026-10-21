from __future__ import annotations

import os
import stat
import sys
from pathlib import Path
from typing import Callable

import pytest

FAKE = Path(__file__).parent / "fixtures" / "fake_cloudflared.py"


@pytest.fixture
def fake_bin(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Callable[..., str]:
    """Create a launcher for the fake cloudflared that works on Windows and POSIX."""
    monkeypatch.setenv("FAKE_LIFETIME", "30")  # safety net against stray processes

    def make(mode: str = "ok") -> str:
        monkeypatch.setenv("FAKE_MODE", mode)
        if os.name == "nt":
            wrapper = tmp_path / "cloudflared.cmd"
            wrapper.write_text('@"%s" "%s" %%*\r\n' % (sys.executable, FAKE))
        else:
            wrapper = tmp_path / "cloudflared"
            wrapper.write_text('#!/bin/sh\nexec "%s" "%s" "$@"\n' % (sys.executable, FAKE))
            wrapper.chmod(wrapper.stat().st_mode | stat.S_IXUSR)
        return str(wrapper)

    return make
