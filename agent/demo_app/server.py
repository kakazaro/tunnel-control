"""Tiny demo app for testing the tunnel. Binds to 127.0.0.1 only (stdlib only)."""

from __future__ import annotations

import html
import os
import socket
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = int(os.environ.get("DEMO_APP_PORT", "8080"))


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: str, ctype: str) -> None:
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802 - http.server naming
        path = self.path.split("?", 1)[0]
        if path == "/healthz":
            self._send(200, "ok", "text/plain")
        elif path == "/":
            host = html.escape(socket.gethostname())
            now = time.strftime("%Y-%m-%d %H:%M:%S %Z")
            page = "<!doctype html><title>Demo</title><h1>Hello from %s</h1><p>%s</p>" % (host, now)
            self._send(200, page, "text/html")
        else:
            self._send(404, "not found", "text/plain")


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
