#!/usr/bin/env python3
"""Local dev server for the client, with caching turned off.

Browsers cache ES modules aggressively, so after an edit a plain
`python3 -m http.server` can keep serving you yesterday's code.

    python3 serve.py          # http://localhost:8000
    python3 serve.py 9000     # another port
"""
import http.server
import os
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Serving on http://localhost:{port}  (Ctrl+C to stop)")
    http.server.ThreadingHTTPServer(("", port), NoCache).serve_forever()
