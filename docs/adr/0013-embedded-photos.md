# 0013 — Embedded photos: shrunk JPEGs in a shared, append-only media store

- **Status**: Accepted (resolves open question 2 in [../architecture.md](../architecture.md))
- **Date**: 2026-10-13

## Context
People want photos on their family tree. The file must stay a single portable HTML file (ADR 0001), so photos
either live inside it (bigger file) or next to it (breaks single-file portability). The target is 50–100 people;
camera photos are 2–10 MB each. Two technical constraints:

- **Undo** snapshots the whole document on every edit (Store). Copying megabytes of image data per edit would
  make editing slow and memory-hungry (up to 200 undo steps).
- **Drafts** are backed up in `localStorage`, which typically holds only about 5 MB per site.

## Decision
- **Embed, shrunk.** On import, an image is decoded, scaled to at most **256 px** on its longer side and
  re-encoded as **JPEG (quality 0.82)**, typically 10–30 KB. That is enough for the card avatar and the 96 px
  panel preview. Re-encoding also strips metadata such as camera GPS location. Accepted input: JPEG, PNG, WebP
  and GIF; SVG is refused.
- **One document-level store.** `doc.media = { [mediaId]: { mime, data, width, height } }`, and a node refers to
  its picture with `attrs.photo = mediaId`. Identical images are stored once, and a person copied into another
  graph (`copyPersonTo`) shares the image instead of duplicating it.
- **Append-only while running.** Entries are added and never changed or removed during a session. Undo
  snapshots deep-copy everything **except** `doc.media`, which they share, so an edit costs the same with or
  without photos. Entries nobody references any more (after Remove, Change or Undo) are dropped when the
  document is written out (Save, Export JSON, drafts). The Store creates `doc.media` up front so every snapshot
  shares the same object.
- **Only inline raster images.** Validation and the renderer both require
  `data:image/(jpeg|png|webp|gif);base64,…`. Anything else (`javascript:`, SVG, HTML) is rejected, so file
  content can't turn a photo into active content.
- **Rendering.** Each image becomes one SVG `<pattern>` that is created once and reused across renders (not
  re-parsed on every frame of a drag). The card shows a circular avatar filled with it, drawn in the labels layer
  so it never intercepts clicks or drags.
- **Transparency** about cost: the graph panel shows how much the photos add to the file. If a draft no longer
  fits in browser storage, a notice says unsaved changes aren't being backed up.
- **GEDCOM** export lists photos as not included (5.5.1 has no portable way to embed them).

## Alternatives considered
- **Photos as separate files next to the HTML** — smaller HTML, but the file is no longer self-contained,
  and pages opened from `file://` can't read neighbouring files anyway (the same reason as ADR 0001).
- **Embed originals** — 100 camera photos would make a 300 MB+ file that is slow to open, save and email.
- **Store photos inside each person's attrs** — simpler, but copies across graphs would duplicate images, and
  every undo snapshot would copy them.
- **WebP output** — smaller, but Safari can't encode WebP from a canvas, so output would differ by browser.
- **IndexedDB for images** — the data would be trapped in one browser profile (rejected in ADR 0006).

## Consequences
- + A 100-person family with photos stays around 1–3 MB and still opens instantly.
- + Undo and editing performance are unaffected by photos.
- − Only a small version is kept; you can't recover the original from the file.
- − With many photos, the draft backup may stop fitting in browser storage (a notice says so).
- − Optional full-resolution originals (e.g. a sidecar folder) remain a possible later addition.
