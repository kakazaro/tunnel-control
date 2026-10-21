"""Entry point: python -m tunnel_agent [--once] [--version]."""

from __future__ import annotations

import argparse
import logging
import os
import signal
import socket
import sys
import threading
from typing import List, Optional

from . import __version__
from .client import ControlClient
from .config import ConfigError, load_config
from .logging_setup import setup_logging
from .nudge import NudgeListener
from .reconciler import Reconciler
from .tunnel import QuickTunnel

log = logging.getLogger("tunnel_agent")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="tunnel_agent", description=__doc__)
    parser.add_argument("--version", action="version", version="tunnel-agent " + __version__)
    parser.add_argument(
        "--once", action="store_true", help="run one sync+reconcile tick (HTTP only), then exit"
    )
    args = parser.parse_args(argv)

    try:
        cfg = load_config(os.environ)
    except ConfigError as exc:
        print("configuration error: %s" % exc, file=sys.stderr)
        return 2
    setup_logging(cfg.log_level, secrets=[cfg.agent_token])

    wake = threading.Event()
    tunnel = QuickTunnel(
        cfg.cloudflared_bin,
        cfg.tunnel_target_url,
        cfg.tunnel_protocol,
        cfg.tunnel_metrics,
        cfg.start_timeout,
    )
    client = ControlClient(cfg.sync_url, cfg.agent_token, cfg.http_timeout)
    reconciler = Reconciler(
        tunnel, client, wake, cfg.agent_id, socket.gethostname(), cfg.poll_interval
    )

    if args.once:
        reconciler.tick()
        if tunnel.is_running():
            log.warning("--once: cloudflared was left running; stop it manually if unwanted")
        return 0

    listener = None
    if cfg.enable_websocket:
        listener = NudgeListener(cfg.ws_url, cfg.agent_token, wake, cfg.proxy, cfg.no_proxy)
        listener.start()

    def _on_signal(signum: int, _frame: object) -> None:
        log.info("received signal %d", signum)
        reconciler.request_stop()

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    log.info(
        "tunnel-agent %s starting (agent_id=%s, ws=%s)",
        __version__,
        cfg.agent_id,
        cfg.enable_websocket,
    )
    try:
        reconciler.run()
    finally:
        if listener is not None:
            listener.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
