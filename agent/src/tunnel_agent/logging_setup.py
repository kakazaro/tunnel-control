"""Logging to stdout (collected by journald) with token redaction."""

from __future__ import annotations

import logging
import sys
from typing import Iterable

FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


class RedactFilter(logging.Filter):
    """Defense in depth: replace secrets if one ever ends up in a log message."""

    def __init__(self, secrets: Iterable[str]) -> None:
        super().__init__()
        self._secrets = [s for s in secrets if s]

    def filter(self, record: logging.LogRecord) -> bool:
        if self._secrets:
            msg = record.getMessage()
            for secret in self._secrets:
                msg = msg.replace(secret, "***")
            record.msg, record.args = msg, None
        return True


def setup_logging(level: str = "INFO", secrets: Iterable[str] = ()) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(FORMAT))
    handler.addFilter(RedactFilter(secrets))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    for noisy in ("urllib3", "websocket"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
