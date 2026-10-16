# 0020 — Versions and release labels

- **Status**: Accepted
- **Date**: 2026-10-16

## Context
Releases were named only by commit time and hash (`2026.10.16.02.21.24-7eefa04`) and nothing
in the app said which version it was. That made it hard to tell people apart ("which version
do you have?"), to spot an old cached copy, or to know which version saved a family file.

## Decision
- **Product version** in `VERSION` at the repo root, `MAJOR.MINOR.PATCH`, starting at 1.1.15.
  Every merged PR raises it: patch for a fix, minor for a feature, major for a change older
  apps can't follow (such as a new file format). `CHANGELOG.md` says what each version changed.
- **Build id**: the short hash of the source tree that was built. CI writes it to `BUILD` in
  the exported source; the merge gate tests the merge result before the merge commit exists
  and then promotes that very build, and the tree is the same before and after merging, so
  the tree (not the commit) names the build. A build made by hand says `local`.
- **In the app**: `build/build.py` stamps both into `<meta name="famtee-version">` and
  `<meta name="famtee-build">`; run from source the app says `dev`. A small label in the
  canvas's bottom-right corner shows *FamTee 1.1.15* in View and Edit; clicking it opens an
  About box (version, build, file format, which version last saved this family, Copy details).
- **In files**: each download records `meta.savedWith = { version, build }`; the start screen
  shows it.
- **Release labels**: release folders are `<commit time>-<commit>-v<VERSION>` (still sorted
  by time) and `manifest.json` has `app_version` and `build`. The merge gate refuses a PR that
  doesn't raise `VERSION` (`--same-version` allows it, e.g. for docs-only changes) and tags
  the merged commit `v<VERSION>` on GitHub.

## Alternatives considered
- **Date-based versions only** (the existing release names) — exact, but not something people
  can say or compare at a glance.
- **Version derived from git tags at build time** — the CI container builds from an exported
  tree without git history, and the merge result is tested before it is tagged.
- **Version in the top-right toolbar** — the header is already full on common widths; adding
  to it would wrap the toolbar and resize the canvas.

## Consequences
- Every PR has to bump `VERSION` and add a `CHANGELOG.md` entry; the merge gate enforces the bump.
- Files saved from now on say which version saved them; older files say nothing (and the About
  box says so).
