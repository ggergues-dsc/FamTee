# FamTee Documentation

FamTee is a lightweight, portable family-tree application: graph data and its visualization live together
in a single HTML file that opens in any modern browser on any OS, with no install, server or network.

## Documents

| Document | Purpose |
|---|---|
| [architecture.md](architecture.md) | The architecture outcome: goals, constraints, components, repo layout |
| [data-model.md](data-model.md) | The native JSON format (compound / multi-graph) |
| [development.md](development.md) | Building, testing, code layout and the supported module syntax |
| [options-considered.md](options-considered.md) | All options surveyed during the architecture session and how they scored |
| [adr/](adr/) | Architecture Decision Records — one file per decision, with rationale |

## Decision log

| # | Decision | Status |
|---|---|---|
| [0001](adr/0001-hybrid-single-file-packaging.md) | Hybrid packaging: single HTML with embedded data + external JSON import/export | Accepted |
| [0002](adr/0002-no-framework-vanilla-es-modules-with-inline-build.md) | No framework; vanilla ES modules inlined by a tiny build | Accepted (tooling amended by 0011) |
| [0003](adr/0003-svg-layered-rendering.md) | SVG rendering organised in named layers | Accepted |
| [0004](adr/0004-compound-multi-graph-json-data-model.md) | Compound multi-graph JSON data model | Accepted |
| [0005](adr/0005-union-nodes-for-family-relations.md) | Union nodes for partnerships / parentage | Accepted |
| [0006](adr/0006-persistence-file-system-access-with-download-fallback.md) | Save via File System Access API, download fallback, local autosave | Superseded by 0017 |
| [0007](adr/0007-vendored-micro-dependencies-d3.md) | Vendored micro-dependencies (d3 modules) only | Accepted (d3-zoom superseded by 0012) |
| [0008](adr/0008-custom-generational-layout.md) | Custom generational layout with manual overrides | Accepted |
| [0009](adr/0009-overlay-layer-for-future-graphic-design.md) | Reserved overlay layer for future graphic design | Accepted |
| [0010](adr/0010-gedcom-interop-as-import-export-only.md) | GEDCOM as import/export adapter, not native format | Accepted |
| [0011](adr/0011-python-build-and-browser-tests.md) | Python build script and in-browser tests (no Node.js); amends 0002 tooling | Accepted |
| [0012](adr/0012-hand-written-pointer-events-pan-zoom-drag.md) | Hand-written pan/zoom and drag on Pointer Events; drags stored as offsets | Accepted |
| [0013](adr/0013-embedded-photos.md) | Embedded photos: shrunk JPEGs in a shared, append-only media store | Accepted |
| [0014](adr/0014-disposable-container-tests.md) | Disposable container-based testing with Docker Compose (devops/) | Accepted |
| [0015](adr/0015-local-cicd-pipeline.md) | Local CI/CD pipeline and merge gate in the container (no GitHub Actions) | Accepted |
| [0016](adr/0016-local-uat-environment.md) | Local UAT environment: read-only web server on the LAN, deployed on merge | Accepted |
| [0017](adr/0017-browser-first-sessions-and-simple-mode.md) | Browser-first sessions, download-only saving, versioned files, simple mode | Accepted |
| [0018](adr/0018-privacy-filter-for-sharing.md) | Privacy filter: shared copies without living people's details | Accepted |
| [0019](adr/0019-layout-push-aside-and-orientation.md) | Layout: moved cards push others aside; left-to-right orientation | Accepted |
| [0020](adr/0020-versions-and-release-labels.md) | Versions and release labels | Accepted |

New decisions: copy [adr/0000-adr-template.md](adr/0000-adr-template.md), take the next number, add a row above.
A decision is never edited away — supersede it with a new ADR and mark the old one `Superseded by NNNN`.
