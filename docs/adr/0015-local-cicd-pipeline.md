# 0015 — Local CI/CD pipeline in the disposable container (no GitHub Actions)

- **Status**: Accepted (builds on [0014](0014-disposable-container-tests.md))
- **Date**: 2026-10-13

## Context
FamTee has a full test suite and a disposable, offline test container (ADR 0014), but nothing ran it
automatically: every PR was merged showing "no checks". We want a CI/CD cycle that runs **locally in the container
rather than on GitHub Actions**. The choices made for this cycle:

- **When:** before every merge (not on every push).
- **Reporting:** results stay local; nothing is posted to GitHub.
- **Delivery:** versioned local release artifacts.

## Decision
Two scripts in `devops/`:

**`ci.sh` — the pipeline.** It works on an **exact commit or tree**, never the working copy:
1. *export source* — `git archive <tree>` into the run folder, so only committed content is tested.
2. *prepare image* — the cached test image (ADR 0014).
3. *test* — the full suite in the disposable container, with the exported tree mounted read-only.
4. *build* — in the same kind of container, build `famtee.html` and every sample into the run's `artifacts/` with
   `SHA256SUMS`. That bind mount is the only host path the pipeline writes to.
5. *deliver* (`--release`, commits only) — copy the artifacts, `ci.log` and a `manifest.json` (version, commit,
   tree, subject, build time, test result) into `releases/<YYYY.MM.DD.HH.MM>-<sha7>/` and point `releases/latest` at it.
   The version is the commit's time in UTC to the minute plus the short commit hash, so a newer release always
   sorts later and the same commit always gets the same version.

Each run is recorded in `.ci/runs/<UTC time>-<sha7>/` (`ci.log`, `status`, `tree`, `artifacts/`); the last 20 are
kept. `--promote <run> --ref <commit>` delivers an earlier green run, but only if the commit has **exactly** the tree
that run tested. Exit codes: 0 green, 1 red, 2 usage error.

**`merge.sh <PR>` — the merge gate.**
- It computes the **merge result** locally with `git merge-tree --write-tree origin/main <PR head>`, without
  touching the working copy, and runs the pipeline on that tree. So it tests what `main` will contain, not just
  the PR branch.
- Only when that is green does it merge, with `gh pr merge --match-head-commit <tested head>`, so a push after
  the test can't slip in untested.
- It then delivers a release for the new `main` commit. If `main`'s tree equals the tested tree (the usual case),
  the tested run is promoted with no second run. If `main` moved in the meantime, the pipeline runs again on
  the real `main`.
- Options: `--dry-run` (gate only), `--delete-branch`, `--method`.

## Alternatives considered
- **GitHub Actions** — explicitly not wanted. It would also test a different toolchain than local runs.
- **Pre-push hook** — offered but not chosen. Gating at merge time covers what reaches `main`.
- **Posting commit statuses to GitHub** — offered but not chosen: results stay local.
- **Testing the working copy** (like `devops/test.sh`) — results would depend on uncommitted files. The pipeline
  tests the exported tree only, and says so when the working copy is dirty.
- **Testing only the PR head** — misses breakage caused by changes on `main` since the branch was cut. The merge
  result is what matters.

## Consequences
- + Every merge through `merge.sh` is tested on exactly what lands on `main`, and every merge to `main` yields
  a reproducible, checksummed release folder.
- + Verified: a failing commit makes the pipeline red (exit 1). Uncommitted edits don't affect a run. Two runs
  of the same commit give byte-identical artifacts. Promote refuses red runs and mismatched trees.
- − It is a convention, not enforcement: merging with the GitHub button bypasses the gate. Branch protection
  that requires a status would need reporting to GitHub, which was deliberately left out.
- − Releases are local folders (git-ignored); sharing them is a manual step.

## Addendum (2026-10-13): devops self-test in the gate

The app's test suite doesn't cover the devops scripts, which is how a UAT pruning bug reached `main` (ADR 0016,
"Incident and fix"). `merge.sh` now has a step 4:

- If the PR changes anything under `devops/` (or with `--selftest`), the gate runs
  `devops/gate-selftest.sh <merge result tree> <run artifacts>`.
- That exports the merge result with `git archive` and runs **that tree's own** `devops/selftest.sh` against the
  artifacts the pipeline just built. It tests the PR's version of the scripts, not the working copy's.
- The scripts find the repo relative to their own location, so they work in an exported tree.
- A red self-test blocks the merge; the log is kept as `.ci/runs/<run>/selftest.log`. Dry runs include the step.

**Verified:** a throwaway commit with the old pruning bug made the gate's self-test fail at exactly the regression
step, even though the working copy held the fixed script. The good tree passed, and live UAT was untouched.

**Not covered:** the gate scripts that do the testing (`merge.sh`, `ci.sh`) run from the working copy, so the code
under review never decides whether it may merge. A change to those scripts is still exercised only by the
self-test's UAT scenarios, not end to end.
