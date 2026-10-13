#!/usr/bin/env python3
"""Run all FamTee tests (ADR 0011).

1. Python unit tests for the build script.
2. JS tests as native ES modules over http (development mode).
3. JS tests bundled by build.py and opened from file:// (distribution mode).

JS tests run in headless Firefox; results come back via POST to a local server.
Usage: python3 tests/run.py [--browser firefox]
"""

from __future__ import annotations

import argparse
import http.server
import json
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "build"))
import build  # noqa: E402

TIMEOUT = 90
sys.stdout.reconfigure(line_buffering=True)


def run_python_tests() -> bool:
    print("== Python: build script")
    suite = unittest.defaultTestLoader.discover(str(ROOT / "tests"), pattern="test_*.py")
    return unittest.TextTestRunner(verbosity=1).run(suite).wasSuccessful()


def start_server(results: queue.Queue) -> http.server.ThreadingHTTPServer:
    class Handler(http.server.SimpleHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            self.send_response(204)
            self.end_headers()
            results.put(json.loads(body))

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def run_in_browser(browser: str, url: str, results: queue.Queue) -> dict | None:
    # Snap-packaged Firefox can only use profile directories inside $HOME, so keep it in the repo.
    cache = ROOT / ".cache"
    cache.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=cache, prefix="profile-") as profile:
        proc = subprocess.Popen(
            [browser, "--headless", "--no-remote", "--profile", profile, url],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            return results.get(timeout=TIMEOUT)
        except queue.Empty:
            return None
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()


def report(name: str, summary: dict | None) -> bool:
    print(f"== Browser: {name}")
    if summary is None:
        print(f"   no results within {TIMEOUT}s (page failed to load or crashed)")
        return False
    for r in summary["results"]:
        if not r["ok"]:
            print(f"   FAIL {r['name']}\n        {r['error']}")
    print(f"   {summary['total'] - summary['failed']}/{summary['total']} passed")
    return summary["failed"] == 0 and summary["total"] > 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run FamTee tests")
    parser.add_argument("--browser", default="firefox")
    args = parser.parse_args()

    ok = run_python_tests()

    if not shutil.which(args.browser):
        print(f"{args.browser} not found; skipping browser tests")
        return 1

    bundled = ROOT / "dist" / "tests.html"
    bundled.parent.mkdir(exist_ok=True)
    bundled.write_text(build.build_html(ROOT / "tests" / "index.html"), encoding="utf-8")

    results: queue.Queue = queue.Queue()
    server = start_server(results)
    report_url = f"http://127.0.0.1:{server.server_port}/__results"
    try:
        dev = run_in_browser(args.browser, f"http://127.0.0.1:{server.server_port}/tests/index.html?report={report_url}", results)
        ok = report("ES modules over http", dev) and ok
        dist = run_in_browser(args.browser, f"{bundled.as_uri()}?report={report_url}", results)
        ok = report("bundled from file://", dist) and ok
    finally:
        server.shutdown()

    print("\nALL PASSED" if ok else "\nFAILURES")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
