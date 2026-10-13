# FamTee Data Model (schemaVersion 1)

Decisions behind this format: [ADR 0004](adr/0004-compound-multi-graph-json-data-model.md),
[ADR 0005](adr/0005-union-nodes-for-family-relations.md), [ADR 0009](adr/0009-overlay-layer-for-future-graphic-design.md).

## Overview

A FamTee document is a **compound multi-graph**:

- A document contains any number of **graphs** (e.g. "Smith family", "Garcia family", "Village of X").
- Each graph has its own **nodes** and **edges**.
- Graphs connect at **different levels** in two ways:
  - **Vertical (hierarchy)** — a `graphRef` node inside one graph stands for a whole other graph
    (drill-down / collapse). Example: an overview graph of families, each family a `graphRef`.
  - **Horizontal (peer links)** — document-level `links` connect a node in one graph to a node in another
    (e.g. the same person appearing in two family graphs, or a marriage joining two families).

## Top-level shape

```jsonc
{
  "format": "famtee",
  "schemaVersion": 1,
  "meta": {
    "id": "01J9Z6Q8X1K3V4...",          // document ULID, also the autosave key
    "title": "Gergues Family",
    "created": "2026-10-12T20:00:00Z",
    "modified": "2026-10-12T20:00:00Z",
    "rootGraph": "g-main",
    "theme": "default",
    "overlay": { "layers": [] }          // future graphic design, see ADR 0009
  },
  "graphs": {
    "g-main": { "title": "Main line", "nodes": { }, "edges": [ ] }
  },
  "links": [ ]
}
```

## Nodes

Nodes are stored in a map keyed by ID (IDs are ULIDs: sortable, collision-free when merging files).
Generated IDs carry a type prefix for readability: `g-` graph, `p-` person, `u-` union, `grp-` group,
`ref-` graphRef, `e-` edge, `l-` link. Any unique non-empty string is accepted when loading; graph IDs
must not contain `:` since links use `graphId:nodeId`.

```jsonc
"p-01J9...": {
  "type": "person",
  "attrs": {
    "name": { "given": "Maria", "surname": "Garcia" },   // optional "suffix" (e.g. from GEDCOM "Jr.")
    "sex": "F",
    "birth": { "date": "1950-03-14", "place": "Cairo" },
    "death": null,
    "notes": "",
    "photo": "data:image/webp;base64,...",
    "nudge": { "dx": 40, "dy": 0 }     // optional: offset from the automatic layout, set by dragging (ADR 0012)
  }
}
```

| `type` | Meaning |
|---|---|
| `person` | An individual |
| `union` | A partnership/family unit joining partners and their children (ADR 0005) |
| `group` | Visual grouping inside a graph (household, branch) — has `attrs.members: [nodeId]` |
| `graphRef` | Placeholder for another graph: `attrs.graph: "g-other"` — click to drill down |

`attrs` is open: unknown keys are preserved on load/save so newer files survive older apps.

## Edges (within a graph)

```json
{ "id": "e-01J9...", "type": "partner", "from": "p-A", "to": "u-1", "attrs": { "kind": "married", "start": "1975" } }
{ "id": "e-01J9...", "type": "child",   "from": "u-1", "to": "p-C", "attrs": { "kind": "biological" } }
```

| `type` | from → to | `attrs.kind` examples |
|---|---|---|
| `partner` | person → union | married, partner, divorced, widowed |
| `child` | union → person | biological, adopted, foster, step |
| `custom` | any → any | free label (godparent, guardian, …) |

## Cross-graph links (document level)

```json
"links": [
  { "id": "l-01J9...", "type": "same-as",  "from": "g-smith:p-7", "to": "g-garcia:p-2" },
  { "id": "l-01J9...", "type": "custom",   "from": "g-main:u-4",  "to": "g-village:p-9", "attrs": { "label": "neighbours" } }
]
```

Endpoints are `graphId:nodeId`. `same-as` declares two nodes to be the same real person (identity across
graphs without duplicating edges). The UI shows linked nodes with a marker and lets the user jump across.

## Integrity rules (enforced by Store)

1. Every edge endpoint exists in its graph; every link endpoint exists in the named graph.
2. `partner` edges end at a `union`; `child` edges start at a `union`.
3. No person is their own ancestor (cycle check over partner/child edges, `same-as` collapsed).
4. `graphRef` targets exist; the graphRef hierarchy is acyclic.
5. IDs are unique document-wide.
6. A link joins nodes in **two different graphs** (relations inside one graph are edges). The editing helpers
   also refuse duplicate links (same type, same two endpoints in either direction).

Editing conventions (enforced by the editing helpers, not by validation): a group whose last member is removed
is deleted, and copying a person into another graph creates a `same-as` link to the copy.

## Versioning

`schemaVersion` is an integer. On load, `migrations[n]` upgrades n → n+1 until current. The app refuses
(read-only mode + warning) to save a file whose `schemaVersion` is newer than it understands.

## Embedding in HTML

```html
<script type="application/json" id="famtee-data">{ ...document... }</script>
```

On save, the JSON is serialized with `<` escaped as `\u003c` so the data can never close the script tag.
