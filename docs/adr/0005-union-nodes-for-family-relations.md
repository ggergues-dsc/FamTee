# 0005 — Union nodes for partnerships and parentage

- **Status**: Accepted
- **Date**: 2026-10-12

## Context
Family relations are not a tree: people have two (or more, with adoption) parents, multiple partners over
time, half-siblings, and pedigree collapse (cousins marrying). Modelling parent→child edges directly loses
*which partnership* a child belongs to.

## Decision
Introduce a `union` node per partnership (married or not, including single-parent units).
`person —partner→ union —child→ person`. Partnership facts (marriage date/place, divorce) live on the union;
child relationship kind (biological/adopted/step/foster) lives on the `child` edge.
This mirrors GEDCOM `FAM` records, making the adapter straightforward.

## Alternatives considered
- **Direct parent→child + spouse edges** — ambiguous half-sibling parentage; partnership data has no home.
- **Hyperedges** — not representable in plain node/edge JSON or SVG without an equivalent helper node anyway.

## Consequences
- + Correctly handles remarriage, step-families, adoption and pedigree collapse.
- + Layout gets a natural anchor point between partners for drawing child lines.
- − One extra node type; UI must hide the mechanics ("Add child" on two selected parents creates/uses a union).
