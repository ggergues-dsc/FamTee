# 0010 — GEDCOM as import/export adapter, not native format

- **Status**: Accepted
- **Date**: 2026-10-12

## Context
GEDCOM is the genealogy interchange standard (5.5.1 widely supported, 7.0 current). Users will want to bring
data in from / out to other genealogy software. But GEDCOM has no concept of multiple interconnected graphs,
layout positions, overlays, or arbitrary custom relations, and it is awkward to edit and extend.

## Decision
- Native format is FamTee JSON (ADR 0004).
- Provide `io/gedcom.js`: **import** (INDI → person, FAM → union + partner/child edges, into one new graph) and
  **export** (per graph, or merged with `same-as` collapsed). Start with 5.5.1; add 7.0 later.
- Export is explicitly **lossy**; the UI warns which data will not round-trip.

## Alternatives considered
- **GEDCOM as native storage** — loses multi-graph, layout and design data; parsing on every load.
- **No GEDCOM support** — isolates users from the genealogy ecosystem.

## Consequences
- + Interoperability without compromising the model.
- − Round-tripping through other tools loses FamTee-specific data; native JSON remains the backup format.
- Follow-up: decide 5.5.1 vs 7.0 priority (open question in architecture.md).
