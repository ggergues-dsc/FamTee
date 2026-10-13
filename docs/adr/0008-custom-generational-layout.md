# 0008 — Custom generational layout with manual overrides

- **Status**: Accepted
- **Date**: 2026-10-12

## Context
Family graphs (with union nodes, ADR 0005) are DAGs, not trees, and readers expect generations in rows.
Scale is 50–100 people. Generic layout libraries are either tree-only or heavy.

## Decision
Implement a small layered layout in `src/layout/`:

1. **Rank**: assign generation numbers by longest path from roots through partner/child edges; partners share a
   rank; union nodes sit on their partners' rank.
2. **Order**: within each rank, order nodes to keep partners adjacent and reduce crossings (barycentre heuristic,
   a few sweeps — cheap at this scale).
3. **Place**: x-coordinates with partner spacing and children centred under their union; y = rank × row height.
4. **Overrides**: nodes the user dragged keep their manual position; layout flows around them.
   *(Amended by [0012](0012-hand-written-pointer-events-pan-zoom-drag.md): stored as an offset `attrs.nudge`, not an absolute `attrs.pos`.)*
5. Option per graph: orientation (top-down / left-right) and "auto vs manual".

Overview graphs of `graphRef` tiles can use a simple grid or (later) d3-force.

## Alternatives considered
- **d3-hierarchy** — strict trees only.
- **dagre** — generic Sugiyama, unmaintained, unaware of partners/generations.
- **elkjs** — excellent but ~1 MB+, too heavy for a single portable file.
- **Fully manual placement** — tedious for new trees; we keep it as the override mechanism.

## Consequences
- + Genealogy-appropriate result, small code, deterministic output (stable between saves).
- + Manual positions double as anchors for the future design overlay.
- − We own the algorithm's edge cases (pedigree collapse, very wide generations); add tests with sample files.

## Implementation notes (2026-10-12)

Implemented in `src/layout/layout.js`, with refinements found while testing against `samples/extended.famtee.json`:

- **Ranks** are found by constraint relaxation: partners are raised to a shared rank and children sit at least one
  rank below their union. A person with **no parents** in the graph is pulled down to just above their children,
  so in-laws and single parents don't float to the top row. The loop is capped, because valid but odd data
  (e.g. partnering a grandchild's generation) can keep pushing ranks.
- **Blocks**: each row is made of blocks. A block is a person, their same-generation partners and the union dots
  between them. A block starts at a chain end, so someone with two partners sits between them.
- **Placement** resolves each row with cluster merging: overlapping blocks merge and sit at the mean of their
  desired positions. This centres sibling groups under their parents automatically. The passes run down, up,
  then down again.
- **Pins** are applied after layout rather than having the layout flow around them (simpler). An unpinned union
  follows its pinned partners. Pins became relative offsets (`attrs.nudge`) when dragging was implemented, see ADR 0012.
- **Connector lanes** (renderer): child connectors from different unions in the same row are given separate
  heights where their horizontal spans overlap. Otherwise a remarried parent's two families read as one.
