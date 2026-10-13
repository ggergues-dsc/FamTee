# 0012 — Hand-written pan/zoom and drag on Pointer Events (no d3-zoom)

- **Status**: Accepted (supersedes the d3-zoom plan in [0007](0007-vendored-micro-dependencies-d3.md))
- **Date**: 2026-10-12

## Context
ADR 0007 planned vendored `d3-zoom` (plus d3-selection, d3-drag and their dependencies, ~9 UMD files, ~45 KB) for
pan/zoom, mainly because touch and pinch handling are fiddly to write. In the meantime:

- The build has no support for vendored scripts (ADR 0011's bundler handles only our own modules), and
  vendoring means downloading third-party code and keeping it updated.
- The canvas also needs **drag-to-move** for cards. Pan, pinch and card-drag compete for the same pointer, so
  they are easiest to arbitrate in one handler. With d3 that would be d3-zoom plus d3-drag plus filters.
- Pointer Events now unify mouse, touch and pen in every target browser, which removes most of the
  difficulty that motivated d3-zoom.

## Decision
- `src/ui/viewport.js`: pure transform math. A transform `{x, y, k}` maps layout coordinates to screen pixels.
  It provides zoom-around-a-point, fit-to-window (never above 1:1), and screen→world conversion.
- `src/ui/interaction.js`: one Pointer Events handler on the `<svg>`:
  - drag on empty canvas → pan
  - two pointers → pinch-zoom and pan
  - wheel or trackpad pinch → zoom at the cursor
  - drag on an editable card → move it
  - a press that moves less than 4 px is still a click; a pan or drag swallows its click
  - Escape or `pointercancel` abandons a drag
- The renderer stops fitting via `viewBox` and applies the transform to the viewport `<g>`. Each graph keeps its
  own transform while you navigate. A graph is fitted on its first visit, and edits never move the view.
- **Drags are stored as offsets**: `attrs.nudge = {dx, dy}` relative to the automatic layout position, replacing
  the absolute `attrs.pos` from ADR 0008 (no files used `pos` yet). The layout shifts whenever someone is added on
  the left; with absolute positions a moved card would stay put while its family moved away. With offsets it
  travels with them.
- During a drag, the offset is a render-only preview. One undoable "Move person" edit is stored on drop, so
  dragging never floods the undo history.
- Zoom controls (+ / − / Fit) sit in the canvas corner. Keyboard: `+`, `-`, `0`.

## Alternatives considered
- **Vendored d3-zoom + d3-drag** — proven gestures and inertia, but needs downloads, licence tracking, build
  changes, and coordination between two libraries over one pointer.
- **Absolute positions (`attrs.pos`)** — simpler to explain, but they drift away from family members whenever
  the automatic layout shifts (see above).
- **Store every move during the drag** — gives live persistence, but one drag would create dozens of undo
  steps and autosaves.

## Consequences
- + Zero dependencies remain; ADR 0007's dependency budget is unused for now.
- + One small, fully tested module (synthetic pointer-event tests, plus an end-to-end drag in the built app).
- − No inertia/momentum panning; can be added later if missed.
- − Nudged cards are not avoided by the automatic layout, so a card can be moved on top of another.
  "Reset position" (person) and "Reset layout" (graph) undo moves.
