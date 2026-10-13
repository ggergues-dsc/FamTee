# Options Considered (architecture session, 2026-10-12)

The survey of options presented during the session, with the choice made and why.
Each choice is recorded formally in [adr/](adr/).

Session inputs from the product owner:
- Packaging → **Hybrid**
- Editing → **Full in-browser editing**
- Dependencies → **Small vendored libraries OK**, no framework
- Scale → **50–100 people per file**

## 1. Packaging (data + UI)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Single self-contained HTML** with embedded JSON (TiddlyWiki style) | One file to share; works on `file://` everywhere | Save-back is awkward outside Chromium; data diffing is harder | Base of chosen option |
| **B1. `index.html` + `data.json` in a folder** | Clean separation | `fetch()` of local files is blocked under `file://` in Chromium → broken | Rejected |
| **B2. `index.html` + `data.js`** (`window.FAMTEE = {...}`) | Works on `file://`; data separate | Two files to keep together; can't write back to `data.js` outside Chromium | Kept only as possible fallback |
| **B3. HTML + user picks data file** via file input / FSA API | Data stays a plain file | Extra step on every open; poor first-run experience | Covered by import feature |
| **C. Hybrid** (A + import/export of external `.famtee.json`) | Portability of A, interoperability/backup of B | Two save targets to explain | **Chosen** — [ADR 0001](adr/0001-hybrid-single-file-packaging.md) |

## 2. UI technology

| Option | Verdict |
|---|---|
| React/Vue/Svelte etc. | Rejected — framework not needed for this size; adds build complexity and weight |
| Web Components + vanilla JS | Possible later for panels; not required |
| **Vanilla ES modules + tiny inline build** | **Chosen** — [ADR 0002](adr/0002-no-framework-vanilla-es-modules-with-inline-build.md) |
| Desktop wrapper (Electron/Tauri) | Rejected — per-OS builds defeat "any browser, any OS" |

## 3. Rendering

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **SVG** | Vector, CSS-themable, DOM events, printable, exportable, layerable for design overlay | Slows beyond several thousand elements | **Chosen** — [ADR 0003](adr/0003-svg-layered-rendering.md) |
| Canvas 2D | Fast for huge graphs | No DOM/CSS, manual hit-testing, raster print/export | Rejected at 50–100 nodes |
| WebGL | Massive scale | Overkill, complexity | Rejected |
| HTML/CSS boxes + SVG connectors | Easy text editing | Two coordinate systems, harder export | Rejected |

## 4. Layout

| Option | Size | Verdict |
|---|---|---|
| d3-hierarchy (tree/cluster) | small | Rejected — strict trees only; families are DAGs with unions |
| dagre | ~100 KB+ | Rejected — generic, unmaintained, not generation-aware |
| elkjs | ~1 MB+ | Rejected — too heavy for single-file app |
| d3-force | small | Rejected for main view — unstable, not generational; maybe for overview graphs later |
| **Custom generational layout + manual overrides** | few hundred lines | **Chosen** — [ADR 0008](adr/0008-custom-generational-layout.md) |

## 5. Data model

| Option | Verdict |
|---|---|
| GEDCOM as native format | Rejected — no multi-graph, awkward to edit/extend → adapter only ([ADR 0010](adr/0010-gedcom-interop-as-import-export-only.md)) |
| Nested tree JSON (parent → children) | Rejected — can't express multiple partners, pedigree collapse, cross-links |
| Flat person list with parent IDs | Rejected — no partnership entity, no multi-graph |
| GraphML / JSON Graph Format | Considered — close fit, but extra generality; our format borrows their node/edge style |
| **Compound multi-graph JSON with union nodes** | **Chosen** — [ADR 0004](adr/0004-compound-multi-graph-json-data-model.md), [ADR 0005](adr/0005-union-nodes-for-family-relations.md) |
| SQLite (sql.js WASM) embedded | Rejected — ~1 MB runtime, binary blob in HTML, overkill for 100 records |

## 6. Persistence / save-back

| Option | Verdict |
|---|---|
| **File System Access API** (Chromium) | **Chosen** primary — overwrite in place |
| **Blob download** of updated HTML/JSON | **Chosen** fallback for Firefox/Safari |
| **localStorage autosave** | **Chosen** for draft recovery only (not source of truth) |
| IndexedDB as primary store | Rejected — data trapped in one browser profile; defeats portability |
| See [ADR 0006](adr/0006-persistence-file-system-access-with-download-fallback.md) | |

## 7. Future graphic-design overlay

| Option | Verdict |
|---|---|
| **Dedicated SVG overlay layer + `meta.overlay` data** | **Chosen** — [ADR 0009](adr/0009-overlay-layer-for-future-graphic-design.md) |
| Export SVG and decorate in external tool (Inkscape/Figma) | Supported anyway via SVG export, but loses round-trip |
| Background image only | Too limited |
