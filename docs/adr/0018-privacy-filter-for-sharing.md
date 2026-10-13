# 0018 — Privacy filter: shared copies without living people's details

- **Status**: Accepted (resolves open question 3 in [../architecture.md](../architecture.md))
- **Date**: 2026-10-13

## Context
Since ADR 0017, downloading a file is how a family is saved and shared. Family trees routinely contain living
people's names, birth dates, places, photos and notes, which shouldn't be passed on without thought. Genealogy
software conventionally offers a "privatized" export for sharing.

## Decision
- **Who is living** (`isLiving` in `src/privacy/living.js`):
  - an explicit **Status** on the person wins (*Living* / *Deceased*, set in the person panel; *Automatic* by
    default);
  - otherwise a person is **deceased** if a death date or place is recorded, or if their birth year (the first
    four-digit year in any date form, e.g. `ABT 1900`) is **more than 100 years ago**;
  - everyone else is **living**, including people with no dates at all: when in doubt, protect.
- **What a shared copy contains** (`privatize`):
  - The **tree's shape is kept**: every person, partnership and relationship stays, so the copy still makes sense.
  - Living people become **"Living"**, keeping only their sex and manual card position. Names, dates, places,
    notes, photos and any other fields are removed.
  - A partnership whose partners are all living loses its dates and place.
  - Photos no longer referenced are dropped from the file.
  - The copy is a **separate document**: it gets a new id, the title "… (shared)", and
    `meta.privacy = { livingHidden, rule, at, sourceHash }`. It never mixes with the original's browser session or
    version chain.
- **Where:** Export ▾ → *Share copy without living people (.html)* and *Share GEDCOM without living people (.ged)*.
  Files are named like downloads (`<family>-shared-<date-time>-<fingerprint>.html`). The notice says how many people
  were hidden and that sharing doesn't save the family itself.

## Alternatives considered
- **Remove living people entirely** — leaks less, but breaks the tree (parents without children, unconnected
  branches) and hides that someone exists at all, which most recipients find confusing.
- **Only an explicit "living" flag** — exact, but it fails open: everyone not marked would be shared. Inferring
  from dates and protecting the unknown fails safe.
- **A fixed cut-off year (e.g. born after 1925)** — goes stale. "More than 100 years ago" moves with the calendar.

## Consequences
- + One click produces a copy that's safe to send, in the app's own format or as GEDCOM.
- + Verified by tests: no name, date, place, note or photo of a living person survives anywhere in the shared file.
- − The rule can be wrong in both directions (e.g. a 101-year-old who is alive). The Status field corrects it.
- − Living people's sex and card positions remain, and the tree shape shows that they exist.
