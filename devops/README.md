# DevOps

Container-based testing and the local CI/CD cycle for FamTee, without GitHub Actions. Decision records:
[ADR 0014](../docs/adr/0014-disposable-container-tests.md) (disposable container) and
[ADR 0015](../docs/adr/0015-local-cicd-pipeline.md) (pipeline and merge gate).

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

`merge.sh` runs the pipeline on **what main will contain after the merge** (computed with `git merge-tree`). It merges
only when that is green, pinned to the tested PR head, then releases the new `main` commit. Run records are in
`.ci/runs/` (last 20 kept); both `.ci/` and `releases/` are git-ignored.

Merging with GitHub's own button bypasses the gate: merge with `devops/merge.sh` instead.

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
| `merge.sh` | Merge gate: pipeline on the PR's merge result → merge → release |

## Housekeeping

The cached image is the only thing that stays on the machine. To remove it:

```bash
docker compose -f devops/compose.test.yaml down --rmi local
```
