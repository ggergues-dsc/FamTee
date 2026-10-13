# 0004 — Compound multi-graph JSON data model

- **Status**: Accepted
- **Date**: 2026-10-12

## Context
The data is graph-shaped, and multiple graphs must interconnect **at different levels**: e.g. separate family
graphs linked by marriages or shared people, and an overview graph whose nodes stand for whole families.
The format must be human-readable, diff-friendly, embeddable in HTML, and evolvable.

## Decision
A JSON document with (full spec in [../data-model.md](../data-model.md)):

- `graphs: { [graphId]: { title, nodes: { [id]: node }, edges: [edge] } }`
- Node types: `person`, `union`, `group`, `graphRef`; open `attrs` object (unknown keys preserved).
- **Vertical connection**: `graphRef` node → another graph (drill-down; hierarchy must be acyclic).
- **Horizontal connection**: document-level `links` between `graphId:nodeId` endpoints, incl. `same-as` identity.
- IDs are **ULIDs** — globally unique, so files/graphs can be merged without renumbering.
- `schemaVersion` integer + forward migrations.

## Alternatives considered
- **Nested tree JSON** — cannot express multiple partners, pedigree collapse or cross-graph links.
- **Flat person list with parentIds** — no partnership entity, no graph boundaries.
- **GEDCOM native** — see ADR 0010.
- **GraphML / JSON Graph Format** — similar; GraphML is XML (verbose), JGF lacks our compound semantics.
  We borrow their node/edge conventions.
- **Embedded SQLite (sql.js)** — ~1 MB WASM and binary blob; overkill for ~100 records.
- **Single graph with "graph" property per node** — makes hierarchy levels implicit and drill-down awkward.

## Consequences
- + One model covers single trees, linked families and multi-level overviews.
- + Readable/diffable; safe merges thanks to ULIDs.
- − Store must enforce integrity (endpoints exist, no ancestry cycles, acyclic graphRefs).
- − `same-as` identity requires UI care (show it is "the same person" in two graphs).

## Implementation notes (2026-10-12)

Added while building the links and groups UI:

- **Links must join two different graphs** (new validation rule `link-same-graph`). A relation inside one graph
  is an edge, so allowing both would give two ways to say the same thing. Duplicate links (same type and
  endpoints, either direction) are refused when they are added.
- **"Copy into another graph"** is the main way a person ends up in two graphs. It copies the person's details
  (not their layout offset) and links the copy with `same-as`. A person is never copied into a graph where their
  same-as identity already appears; identity is followed transitively through same-as links.
- **Empty groups are deleted.** An empty group has no members to draw a hull around, so it would be invisible
  and impossible to select.
