# DevOps

Container-based testing for FamTee. The decision record is [ADR 0014](../docs/adr/0014-disposable-container-tests.md).

## Run the tests in a disposable container

```bash
devops/test.sh
```

This builds a small image (Python 3 + headless Firefox ESR) on first use, runs the **full suite** (build tests,
browser tests as modules and as the bundled file, end-to-end tests), prints the summary and removes the
container. The exit status is the test result. Arguments are passed through to `tests/run.py`.

Without the wrapper:

```bash
docker compose -f devops/compose.test.yaml run --rm --build tests
```

## What "disposable" means here

| Guarantee | How |
|---|---|
| Your files are never written to | The repo is bind-mounted **read-only** at `/src` |
| Each run starts clean | Tests run on a fresh copy in `/work` (tmpfs). Local `dist/`, `.cache/` and `.git` are not copied |
| Nothing persists | Read-only container filesystem; every writable path is tmpfs; no volumes; `--rm` |
| Hermetic | `network_mode: none`: the tests only use loopback, so no network access at all |
| Least privilege | Non-root user, all capabilities dropped, `no-new-privileges` |

The image holds only the toolchain, not the source, so it is rebuilt only when `devops/docker/` changes.

## Files

| File | Purpose |
|---|---|
| `docker/Dockerfile.test` | Test image: `python:3.13-slim-trixie` + `firefox-esr` + a font |
| `docker/run-tests.sh` | Entry point: copies `/src` into tmpfs and runs `tests/run.py --browser firefox-esr` |
| `compose.test.yaml` | The disposable, read-only, offline service definition |
| `test.sh` | One-command wrapper: build, run, clean up, return the test status |

## Housekeeping

The cached image is the only thing that stays on the machine. To remove it:

```bash
docker compose -f devops/compose.test.yaml down --rmi local
```
