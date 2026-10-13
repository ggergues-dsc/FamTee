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

## Implementation notes (2026-10-12)

Implemented in `src/io/gedcom/` (`lines.js` parser/writer, `convert.js` dates and names, `import.js`, `export.js`).

- **Import adds a graph; it doesn't replace the document.** A `.ged` file becomes a new graph, with a tile in the
  graph you imported from. This fits the multi-graph model (several GEDCOM files can sit side by side and be
  linked with `same-as`), and one Undo removes it. The result goes through `Store.apply`, so files with impossible
  data (e.g. someone who is their own ancestor) are refused and nothing changes.
- **Mapping:**
  - INDI → person: NAME (with GIVN/SURN), SEX, BIRT and DEAT (DATE, PLAC), NOTE. NOTE records referenced by
    pointer are resolved.
  - FAM → union: HUSB/WIFE as partner edges, CHIL as child edges. FAMC.PEDI adopted/foster becomes the child
    edge's kind. MARR gives a start date and place, DIV gives the divorced kind and an end date.
  - A family **without** a MARR record imports as `partner`, not `married`: the file doesn't say they married.
- **Dates:** exact GEDCOM dates become ISO-style (`14 MAR 1950` → `1950-03-14`, `MAR 1950` → `1950-03`). Approximate
  and range dates (`ABT`, `BET … AND …`) are kept as written. On export, free text becomes a date phrase `(…)`,
  so every value round-trips.
- **Nothing is dropped silently.** Unsupported tags are counted and reported after import ("Not imported: 2 × SOUR,
  1 × OCCU"), as are dangling references, malformed lines, non-UTF-8 character sets and newer GEDCOM versions.
- **Export is per graph** (the one on screen), GEDCOM 5.5.1, UTF-8, CRLF line endings:
  - HUSB/WIFE are assigned by sex, then by order. Long or multi-line values are split with CONC/CONT, never at
    a space. `@` is escaped as `@@`.
  - Anything GEDCOM can't hold (groups, sub-graph tiles, custom relations, cross-graph links, card positions,
    step-child and "widowed" kinds) is listed in the notice.
  - A GEDCOM export never marks the document saved.
- **Deferred:** merged export of several graphs (collapsing `same-as` people into one INDI), GEDCOM 7-specific
  structures, and ANSEL decoding.
