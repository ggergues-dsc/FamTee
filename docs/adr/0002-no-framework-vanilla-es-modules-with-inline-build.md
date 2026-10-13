# 0002 — No framework; vanilla ES modules inlined by a tiny build

- **Status**: Accepted
- **Date**: 2026-10-12

## Context
The UI is a single interactive diagram plus a few side panels/forms. A full framework is not needed and would
add weight and toolchain complexity. However, ES-module `import` is blocked for `file://` pages in Chromium,
so the distributed file cannot load modules at runtime.

## Decision
- Write the app in **plain modern JavaScript ES modules** (`src/**`), CSS with custom properties, no framework.
- A **tiny build script** (`build/build.mjs`, using esbuild or a ~100-line concatenator) bundles modules to one
  IIFE and inlines JS, CSS and an optional data block into `dist/famtee.html`.
- During development, serve `src/` with any static server so modules load natively — no build needed to iterate.
- Target evergreen browsers (ES2020+); no transpiling to ES5.

## Alternatives considered
- **React / Vue / Svelte / Preact** — unnecessary abstraction for ~1 view; heavier bundle; locks in a toolchain.
- **No build at all (single hand-written HTML)** — workable at first but becomes unmaintainable as code grows.
- **Classic `<script>` globals without modules** — avoids the build but loses module structure and testability.
- **Electron/Tauri desktop app** — per-OS binaries contradict the browser-only, OS-agnostic goal.

## Consequences
- + Small, dependency-light, long-lived code; anyone can read it.
- + Modules are unit-testable with Node's built-in test runner.
- − We hand-write small UI utilities (DOM helpers, form binding, undo stack).
- − One build step before distribution; must keep it trivial and documented.
