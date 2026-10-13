# 0019 — Layout: moved cards push others aside; left-to-right orientation

- **Status**: Accepted (amends [0008](0008-custom-generational-layout.md) and [0012](0012-hand-written-pointer-events-pan-zoom-drag.md))
- **Date**: 2026-10-13

## Context
Two layout limitations were listed in the development guide:
- a card moved by hand (`attrs.nudge`, ADR 0012) was placed on top of whatever was there, because the automatic
  layout didn't make room;
- only top-down layout existed.

While fixing the first, a third problem showed up: a partnership dot followed a moved partner to the **midpoint of
its partners**, which for a single parent put the dot *inside* their card.

## Decision
- **Push aside.** After manual moves are applied, every card that wasn't moved is checked against the moved cards
  overlapping its row (its column, left to right). Cards in that row are re-placed in their existing order,
  left to right: each keeps its position if free, otherwise it moves forward just past the moved card, with the
  usual gap, and never onto the card before it. Moved cards stay exactly where the user put them.
  - Pushing aside is layout only: nothing is stored on the cards that moved out of the way, so they return when
    the moved card is moved back or its position is reset.
- **Partnership dots follow by displacement.** Every card's displacement (manual move plus push-aside) is
  recorded. A dot that wasn't moved itself moves by the **average displacement of its partners**, so it stays
  between two partners and beside a single one.
- **Orientation** is a per-graph setting saved in the file: `graphs[id].layout.orientation`, `"TB"` (default) or
  `"LR"`, chosen in the graph panel (*Generations top to bottom / left to right*), undoable and validated.
  - The core layout always runs top-down. For `LR` it runs with each card's width and height swapped, and the
    result is rotated, so all the ordering and placement logic is shared.
  - Manual moves and push-aside are applied after the rotation, in screen coordinates.
  - The renderer draws partner links vertically, child connectors going right, and connector lanes per column.
  - Changing orientation re-fits the view.

## Alternatives considered
- **Re-run the automatic layout with moved cards as fixed constraints** — the best result in theory, but it makes
  the whole layout constraint-based. Pushing along the row is simple, predictable and enough for 50–100 people.
- **Push both ways to minimise displacement** — less movement, but less predictable; one direction keeps order and
  is easy to reason about.
- **A separate left-to-right algorithm** — duplicates the generational logic; swap-and-rotate shares it.

## Consequences
- + Dragging a card never hides another; the tests confirm no overlaps after drops, in both orientations.
- + Left-to-right suits wide families on tall screens and printing.
- − Pushing only goes forward, so a crowded row can get longer than strictly necessary.
- − Moved cards can still overlap *each other* (both placed by the user), and push-aside works within a row; it
  doesn't move generations apart.
