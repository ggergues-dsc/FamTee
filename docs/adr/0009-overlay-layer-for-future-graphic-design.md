# 0009 — Reserved overlay layer for future graphic design

- **Status**: Accepted
- **Date**: 2026-10-12

## Context
A graphic-design overlay (decorative frames, illustrated tree art, branding, printed-poster styling) may be
added in the future. It must not require reworking the graph model or renderer.

## Decision
- Reserve the `overlay` SVG layer (ADR 0003) and the `meta.overlay` data slot (and per-graph
  `graphs[id].overlay`) for design elements: shapes, paths, text, images (data URIs) and style tokens.
- Overlay elements may **anchor** to node IDs (follow the node when layout changes) or to absolute coordinates.
- Themes are CSS custom-property sets; a design can ship a theme + overlay together.
- Until implemented, the app preserves overlay data untouched on load/save.

## Alternatives considered
- **Decorate exported SVG in Inkscape/Figma** — supported via SVG export, but no round-trip back into FamTee.
- **Background image only** — cannot follow nodes or sit above them.
- **Separate design file** — breaks single-file portability.

## Consequences
- + Design work can start independently later; no schema break needed.
- − Large embedded images grow the file; recommend WebP/SVG assets and size warnings.
