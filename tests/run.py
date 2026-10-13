#!/usr/bin/env python3
"""Run all FamTee tests (ADR 0011).

1. Python unit tests for the build script.
2. JS tests as native ES modules over http (development mode).
3. JS tests bundled by build.py and opened from file:// (distribution mode).
4. End-to-end: the built app with a sample, driven through its UI (edit, save, reopen).

JS tests run in headless Firefox; results come back via POST to a local server.
Usage: python3 tests/run.py [--browser firefox]
"""

from __future__ import annotations

import argparse
import http.server
import json
import queue
import re
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


def is_chromium(browser: str) -> bool:
    return any(name in Path(browser).name for name in ("chrom", "chrome", "msedge"))


def browser_command(browser: str, profile: str, url: str) -> list[str]:
    if is_chromium(browser):
        # --no-sandbox: Chromium's sandbox needs privileges the locked-down test container
        # doesn't grant (ADR 0014); the container itself is the isolation boundary.
        return [browser, "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run",
                "--no-default-browser-check", f"--user-data-dir={profile}", url]
    return [browser, "--headless", "--no-remote", "--profile", profile, url]


def run_in_browser(browser: str, url: str, results: queue.Queue) -> dict | None:
    # Snap-packaged Firefox can only use profile directories inside $HOME, so keep it in the repo.
    cache = ROOT / ".cache"
    cache.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=cache, prefix="profile-") as profile:
        proc = subprocess.Popen(
            browser_command(browser, profile, url),
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


ENGINES = (("Firefox", r"Firefox/(\d+)"), ("Chrome", r"Chrome/(\d+)"))


def engine(user_agent: str) -> str:
    """'Firefox 153' / 'Chrome 155' from a user agent string."""
    for name, pattern in ENGINES:
        m = re.search(pattern, user_agent or "")
        if m:
            return f"{name} {m[1]}"
    return "unknown browser"


def report(name: str, summary: dict | None, browser: str = "") -> bool:
    print(f"== Browser: {name}")
    if summary is None:
        print(f"   no results within {TIMEOUT}s (page failed to load or crashed)")
        return False
    ran_in = engine(summary.get("userAgent", ""))
    print(f"   ran in {ran_in}")
    if browser and ("Chrome" in ran_in) != is_chromium(browser):
        print(f"   FAIL results came from {ran_in}, not from {browser}")
        return False
    for r in summary["results"]:
        if not r["ok"]:
            print(f"   FAIL {r['name']}\n        {r['error']}")
    print(f"   {summary['total'] - summary['failed']}/{summary['total']} passed")
    return summary["failed"] == 0 and summary["total"] > 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run FamTee tests")
    parser.add_argument("--browser", action="append", dest="browsers",
                        help="browser to run the JS suites in (repeat for several; default: firefox)")
    args = parser.parse_args()
    browsers = args.browsers or ["firefox"]

    ok = run_python_tests()

    missing = [b for b in browsers if not shutil.which(b)]
    if missing:
        print(f"not found: {', '.join(missing)}; browser tests can't run")
        return 1

    bundled = ROOT / "dist" / "tests.html"
    bundled.parent.mkdir(exist_ok=True)
    bundled.write_text(build.build_html(ROOT / "tests" / "index.html"), encoding="utf-8")
    e2e_app = ROOT / "dist" / "e2e-app.html"
    e2e_app.write_text(build.build_html(ROOT / "src" / "index.html", ROOT / "samples" / "extended.famtee.json"), encoding="utf-8")

    results: queue.Queue = queue.Queue()
    server = start_server(results)
    base = f"http://127.0.0.1:{server.server_port}"
    report_url = f"{base}/__results"
    try:
        for browser in browsers:
            label = Path(browser).name
            dev = run_in_browser(browser, f"{base}/tests/index.html?report={report_url}", results)
            ok = report(f"{label}: ES modules over http", dev, browser) and ok
            dist = run_in_browser(browser, f"{bundled.as_uri()}?report={report_url}", results)
            ok = report(f"{label}: bundled from file://", dist, browser) and ok
            e2e = run_in_browser(browser, f"{base}/tests/e2e.html?app=/dist/e2e-app.html&report={report_url}", results)
            ok = report(f"{label}: end-to-end (built app)", e2e, browser) and ok
    finally:
        server.shutdown()

    print("\nALL PASSED" if ok else "\nFAILURES")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
