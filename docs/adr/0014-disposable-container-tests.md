# 0014 — Disposable container-based testing (devops/)

- **Status**: Accepted (complements [0011](0011-python-build-and-browser-tests.md))
- **Date**: 2026-10-13

## Context
The suite (ADR 0011) needs Python 3 and Firefox and has only been run on one developer machine, where Firefox is
a snap package with quirks (its profile must live under `$HOME`). The repo has no CI, so merges showed no checks.
We want a test run that:

- works the same on any machine with Docker, and later in CI;
- can't be influenced by local state (stale `dist/`, browser profiles, stray files) or by the network;
- leaves nothing behind and never modifies the working copy.

## Decision
A `devops/` folder with a Docker Compose test service built for **disposable state**:

- **Image** `python:3.13-slim-trixie` + Debian `firefox-esr` + one font. It contains only the toolchain; the
  source is mounted at run time, so code changes never need a rebuild.
- **Read-only source:** the repo is bind-mounted read-only. The entry script copies the committed sources
  (excluding `.git`, `.cache`, `dist`) into a tmpfs work area, and the suite runs there.
- **No persistent state:** the root filesystem is read-only, all writable paths (`/work`, `/tmp`, `$HOME`) are
  tmpfs, there are no volumes, and the container is removed after the run.
- **No network:** `network_mode: none`. The suite only needs loopback (its own result server), so tests can't
  depend on, or reach, anything outside the container.
- **Least privilege:** non-root user, `cap_drop: ALL`, `no-new-privileges`. `shm_size` is raised for Firefox.
- **One command:** `devops/test.sh` builds, runs, tears down and exits with the test status, ready for CI.

## Alternatives considered
- **Bake the source into the image** — also disposable, but every code change rebuilds the image, and the image
  becomes an accidental artifact of a particular commit.
- **Mount the source read-write** — simpler, but tests would write `dist/` and profiles into the working copy, and
  local leftovers could affect results.
- **Selenium/Playwright images** — heavier and add a driver layer; our runner already drives Firefox directly.
- **GitHub Actions without containers** — would test against whatever the runner image provides; the container
  pins the toolchain identically for local runs and CI.

## Consequences
- + Identical, hermetic runs on any Docker host; CI can call `devops/test.sh` directly.
- + The host working copy is provably untouched (read-only mount).
- − Firefox ESR in the container is older than the desktop Firefox used so far, which adds coverage but means
  features must work on ESR.
- − First run downloads about 300 MB of packages for the image; later runs reuse the cached image.
- Follow-ups: a CI workflow calling `devops/test.sh`; adding Chromium to the image once `tests/run.py` supports
  Chromium's command-line flags.

## Addendum (2026-10-13): Chromium alongside Firefox ESR

The image now also contains Debian's `chromium`, and the container runs every JS suite (modules, bundled
`file://`, end-to-end) in **both** Firefox ESR and Chromium. Chrome/Edge are the most common browsers, and until
now downloads, the start screen and the rest of the UI had only been tested in Firefox.

- `tests/run.py` accepts `--browser` more than once and knows Chromium's launch options
  (`--headless=new --user-data-dir=…`).
- Chromium runs with `--no-sandbox`: its own sandbox needs kernel privileges that this container deliberately
  doesn't grant (`cap_drop: ALL`, `no-new-privileges`). The container is the isolation boundary, it has no
  network, and it runs only this repo's code.
- Each test page reports the engine that ran it (from its user agent). The runner prints it and fails the run if
  it doesn't match the browser requested, so a passing result can't silently come from the wrong browser.
- Cost: the image is about 300 MB larger, and a pipeline run takes about twice as long (both engines).
