# 0003 — SVG rendering organised in named layers

- **Status**: Accepted
- **Date**: 2026-10-12

## Context
The visualization must be portable (HTML + SVG), printable, exportable, themable, and later accept a
graphic-design overlay. Expected size is 50–100 people per file (≈ 300 SVG elements incl. edges/labels).

## Decision
Render each graph view into one `<svg>` with a viewport `<g>` (pan/zoom transform) containing fixed layers,
bottom to top:

1. `background` — canvas colour, optional background art
2. `edges` — partner / child / custom connectors
3. `nodes` — person cards, union dots, group hulls, graphRef tiles
4. `labels` — names, dates (separate so they can be toggled/styled)
5. `annotations` — user notes, highlights, cross-graph link markers
6. `overlay` — reserved for graphic design (ADR 0009)
7. `ui` — selection outlines, drag handles (never exported)

Styling via CSS classes + custom properties (themes). No visual state hidden in the DOM: the renderer is a
function of Store + Layout.

## Alternatives considered
- **Canvas 2D** — faster at thousands of nodes but no DOM events/CSS, manual hit-testing, raster export/print.
  Unnecessary at 50–100 nodes.
- **WebGL** — overkill.
- **HTML boxes + SVG lines** — two coordinate systems, harder exact export.

## Consequences
- + Crisp at any zoom; print to PDF from the browser; "Export SVG" = serialize layers 1–6.
- + Overlay/design work slots in as a layer without touching graph code.
- − Performance ceiling (~ a few thousand elements); revisit with viewport culling if scale grows.
