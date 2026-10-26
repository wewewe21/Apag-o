#!/usr/bin/env python3
"""Servidor local sem cache para rodar o jogo (modulos ES precisam de http://, nao file://).
Uso: python tools/serve.py [porta]   -> abre http://localhost:8765
"""
import http.server
import os
import sys
import webbrowser
from functools import partial
from urllib.parse import unquote, urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8765


class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
                      ".html": "text/html; charset=utf-8"}

    def _private_path(self):
        # O gerador usa .env local. Nunca disponibilizar segredos ou masters.
        parts = unquote(urlsplit(self.path).path).replace("\\", "/").split("/")
        return any(p.startswith(".") for p in parts if p) or "source" in parts

    def do_GET(self):
        if self._private_path():
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        if self._private_path():
            self.send_error(404)
            return
        super().do_HEAD()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    PORT = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    handler = partial(NoCache, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        url = f"http://localhost:{PORT}/index.html"
        print(f"APAGAO rodando em {url}  (Ctrl+C para parar)")
        if "--no-browser" not in sys.argv:
            webbrowser.open(url)
        httpd.serve_forever()
