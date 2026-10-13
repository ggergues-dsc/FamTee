# 0011 — Python build script and in-browser tests (no Node.js)

- **Status**: Accepted (amends the tooling part of [0002](0002-no-framework-vanilla-es-modules-with-inline-build.md))
- **Date**: 2026-10-12

## Context
ADR 0002 assumed a Node.js build (esbuild) and `node --test`. The development machine has no JavaScript runtime
other than a browser (Firefox), but has Python 3. Python is preinstalled on Linux and macOS and is a single
installer on Windows; a browser is installed everywhere the app runs.

## Decision
- **Build**: `build/build.py`, Python 3 standard library only. It bundles the ES modules into one classic script
  (each module wrapped in a function, imports rewritten to `__require`), inlines stylesheets and optionally
  embeds a data document. It supports a **documented subset** of module syntax (named imports/exports, namespace
  and side-effect imports) and fails the build on anything else (default exports, re-exports, dynamic `import()`,
  circular imports) instead of producing broken output.
- **JS tests**: a ~60-line harness (`tests/harness.js`) running in the browser. `tests/run.py` runs them in
  headless Firefox **twice**: as native ES modules over http (development mode) and as the bundled single file
  from `file://` (distribution mode). The second run also proves the bundler output is correct.
- **Build tests**: Python `unittest` (`tests/test_build.py`).
- **End-to-end** (added with the editing UI): `tests/e2e.html` loads the built app (with a sample) in a
  same-origin iframe over http. It edits through the real panel, saves through a stubbed File System Access
  picker, reopens the saved output, re-saves it (must be byte-identical), and checks draft recovery and
  JSON export/import.

## Alternatives considered
- **Install Node.js + esbuild** — the standard route, but adds a runtime and npm dependency to every
  contributor's machine for what is a ~250-line job.
- **Hand-concatenate files without modules** — loses module boundaries; name collisions between files.
- **Testing only in the bundled form** — slower to debug; testing both modes catches bundler bugs separately.

## Consequences
- + Zero third-party build or test dependencies; `python3` + a browser is the whole toolchain.
- + Tests run in a real browser engine, the actual target platform.
- − The regex-based bundler accepts only the syntax subset; import/export statements must start a line.
  This is enforced by build errors and documented in `build/build.py` and [../development.md](../development.md).
- − Imported bindings are copies (no live `let` bindings); export getters keep functions/classes/consts correct.
- If the codebase outgrows the subset, swap in esbuild (single binary, no npm needed); module sources stay unchanged.
