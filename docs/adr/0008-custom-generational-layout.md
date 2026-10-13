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
4. **Overrides**: nodes with `attrs.pos` keep their manual position (user dragged them); layout flows around them.
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
