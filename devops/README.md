# DevOps

Container-based testing, the local CI/CD cycle and a UAT environment for FamTee, without GitHub Actions. Decision
records: [ADR 0014](../docs/adr/0014-disposable-container-tests.md) (disposable container),
[ADR 0015](../docs/adr/0015-local-cicd-pipeline.md) (pipeline and merge gate) and
[ADR 0016](../docs/adr/0016-local-uat-environment.md) (UAT).

## The CI/CD cycle

```bash
devops/merge.sh 12                  # test the merge result of PR #12; merge and release only if green
devops/merge.sh 12 --dry-run        # just the gate: is PR #12 safe to merge?
devops/ci.sh                        # test + build the current commit (HEAD)
devops/ci.sh --ref <commit> --release   # ... and deliver releases/<version>/
```

| Stage | What happens |
|---|---|
| export source | `git archive` of the exact commit/tree; uncommitted edits are never tested |
| prepare image | cached `famtee-test:local` image (Python + Firefox ESR) |
| test | full suite in the disposable container |
| build | `famtee.html` + every sample, with `SHA256SUMS` (byte-for-byte reproducible) |
| deliver | `releases/<YYYY.MM.DD>-<sha7>/` with artifacts, `ci.log`, `manifest.json`; `releases/latest` |
| devops self-test (merge, if `devops/` changed) | the PR's own `devops/selftest.sh`, run from the merge result |
| UAT (merge only) | deploy the release to the UAT server and verify what it serves |

`merge.sh` runs the pipeline on **what main will contain after the merge** (computed with `git merge-tree`). It merges
only when that is green, pinned to the tested PR head, then releases the new `main` commit. Run records are in
`.ci/runs/` (last 20 kept); both `.ci/` and `releases/` are git-ignored.

Merging with GitHub's own button bypasses the gate: merge with `devops/merge.sh` instead.

## UAT: user acceptance testing on the local network

Every merge through `devops/merge.sh` ends by deploying the new release to a **UAT web server** that anyone on your
local network can open ([ADR 0016](../docs/adr/0016-local-uat-environment.md)):

```bash
devops/uat.sh status      # what's deployed, and the URLs (this computer + local network)
devops/uat.sh deploy      # deploy releases/latest (or a given release folder), then verify it
devops/uat.sh down        # stop and remove the UAT server
devops/selftest.sh        # test the devops scripts on a throwaway UAT (the merge gate runs it for devops/ changes)
```

The landing page shows the version, commit and test result, with links to open the app, the sample families,
checksums and the pipeline log. Deploys are atomic (no interruption for testers) and verified: UAT must serve the
release's exact version and checksum. The server is unprivileged nginx with a read-only filesystem, keeps running
until `down` (it restarts after a reboot), and listens on all interfaces at port 8080. Set
`FAMTEE_UAT_BIND=127.0.0.1` to keep it to this computer.

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
| Your files are never written to | The repo (or the pipeline's exported commit) is bind-mounted **read-only** at `/src`; only the pipeline's build stage writes, to its own run folder |
| Each run starts clean | Tests run on a fresh copy in `/work` (tmpfs). Local `dist/`, `.cache/` and `.git` are not copied |
| Nothing persists | Read-only container filesystem; every writable path is tmpfs; no volumes; `--rm` |
| Hermetic | `network_mode: none`: the tests only use loopback, so no network access at all |
| Least privilege | Non-root user, all capabilities dropped, `no-new-privileges` |

The image holds only the toolchain, not the source, so it is rebuilt only when `devops/docker/` changes.

## Files

| File | Purpose |
|---|---|
| `docker/Dockerfile.test` | Test image: `python:3.13-slim-trixie` + `firefox-esr` + a font |
| `docker/famtee-ci.sh` | Entry point: copies `/src` into tmpfs, then `test` (runs `tests/run.py`) or `build` (writes `/out`) |
| `compose.test.yaml` | The disposable, read-only, offline service definition |
| `test.sh` | One-command wrapper: test the working copy in the container, return the test status |
| `ci.sh` | The pipeline: export → test → build → (deliver) for an exact commit or tree |
| `merge.sh` | Merge gate: pipeline on the PR's merge result → merge → release → UAT |
| `uat.sh` | UAT server: deploy (atomic + verified), status, up, down, logs |
| `compose.uat.yaml`, `uat/nginx.conf` | Hardened, read-only nginx serving `.uat/current` on port 8080 |
| `uat/landing.py` | Generates the UAT landing page from a release's manifest |
| `selftest.sh` | Tests the devops scripts on a throwaway UAT (port 18080), never touching live UAT |
| `gate-selftest.sh` | Runs a given tree's own `selftest.sh` from a `git archive` export (used by `merge.sh`) |

## Housekeeping

The cached image is the only thing that stays on the machine. To remove it:

```bash
docker compose -f devops/compose.test.yaml down --rmi local
```
