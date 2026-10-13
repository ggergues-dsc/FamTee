# 0007 — Vendored micro-dependencies (d3 modules) only

- **Status**: Accepted
- **Date**: 2026-10-12

## Context
No framework (ADR 0002), but robust pan/zoom (mouse, wheel, touch pinch) and some SVG helpers are fiddly to
hand-write. The app must run offline, so no CDN loading.

## Decision
- Allow **small, focused, permissively licensed** libraries, starting with `d3-selection` and `d3-zoom`
  (plus their tiny deps: d3-dispatch, d3-drag, d3-interpolate, d3-timer, d3-transition, d3-color, d3-ease);
  optionally `d3-shape` for curved connectors.
- Pin exact versions; commit sources and LICENSE files under `vendor/`; inline at build.
- Budget: total vendored code ≤ ~60 KB minified. Any new dependency requires an ADR.

## Alternatives considered
- **Zero dependencies** — feasible, but touch/pinch zoom and inertia are bug-prone to re-implement.
- **Full d3 bundle** (~280 KB) — mostly unused.
- **Cytoscape.js / vis-network / GoJS** — heavy, opinionated rendering that conflicts with our SVG layers and
  overlay plans; GoJS is commercial.

## Consequences
- + Reliable interaction for little weight; still fully offline.
- − Must track upstream security/bug fixes manually (low risk: no network, no user HTML execution).
