# 0017 — Browser-first sessions, download-only saving, versioned files, simple mode

- **Status**: Accepted (supersedes the in-place saving of [0006](0006-persistence-file-system-access-with-download-fallback.md))
- **Date**: 2026-10-13

## Context
The first editing release saved like a desktop app: on Chrome/Edge, Save silently overwrote the file you picked;
elsewhere it downloaded a copy. Drafts were backed up in the browser but presented as a "Restore" notice, and the
toolbar said "All changes saved" when nothing had reached the disk. Every feature (groups, sub-graphs, cross-graph
links, layout tools) was always visible. We want a simpler, more honest first iteration:

1. clicking a node shows all of its attributes;
2. work is kept in the browser periodically, and the user is told plainly that nothing reaches their disk until
   they download the final version;
3. every session starts by asking what to work on;
4. each saved file carries a content hash and a save time, to avoid collisions and accidental overwrites;
5. one tree by default, with advanced controls collapsed.

The choices made: side panel (not a pop-up) for attributes; browser cache + Download only, the same in every
browser; the start screen every time; hash and time both inside the file and in its name.

## Decision
- **Start screen every session** (`src/ui/start.js`). It explains the save model in one sentence and offers:
  - *Open "<family in this file>"*: people count, last save time and fingerprint, with a warning if the file was
    changed outside FamTee.
  - *Continue your unsaved session*: with a warning if that session started from a different saved version.
  - *Start a new tree*, with an optional name.
  - *Open another file…*: `.html`, `.famtee.json` or `.ged`. A GEDCOM file becomes the one tree of a new family.

  `#start=file|new|continue` and deep links (`#g=`, `#sel=`) skip the screen.
- **Browser-first saving.** Work is kept in `localStorage` about 1 s after each change, every 30 s while there are
  changes, and when the page is hidden or closed. Each draft records the hash of the version it started from
  (`baseHash`); the last 5 drafts are kept. The toolbar always says where changes are:
  - *Kept in this browser HH:MM · not downloaded*
  - *Not backed up · download to keep your work*, if storage refused
  - *Downloaded HH:MM*
  - *No unsaved changes*
- **Download is the only disk write.** The File System Access API in-place overwrite is removed. Download (and
  Export ▸ FamTee data) stamps the document with `meta.revision = { hash, savedAt, parent }`:
  - `hash` is a SHA-256 of the content, excluding `meta.revision`.
  - `parent` is the hash of the version the session started from, so files form a chain.
  - The file is named `<family>-<YYYY-MM-DD-HHMMSS>-<hash6>.<ext>`, so downloads never overwrite each other.

  SHA-256 is implemented in `src/persist/sha256.js` (checked against the standard test vectors), because the
  browser's `crypto.subtle` is unavailable on plain-http pages such as the UAT server.
- **Identity checks on open:**
  - content that no longer matches its fingerprint is reported as *changed outside FamTee*;
  - a draft whose `baseHash` differs from the file's hash is reported as *diverged*;
  - if this browser downloaded a newer version of the same family, opening an older file says so.
- **All attributes** (`attributeRows` in `src/ui/panel.js`): the side panel lists every stored attribute of the
  selected node, read-only, below the editable fields. That includes fields without a form (e.g. a GEDCOM name
  suffix or unknown imported keys), the photo's size, any manual position, the node ID and links to other graphs.
- **Simple mode.** One tree by default. A collapsed **Advanced** section (its open state remembered during the
  session) holds cross-graph links, groups, position reset, the graph title, sub-graphs, adding a GEDCOM file as a
  sub-graph, layout reset, the group list and graph deletion. The merged GEDCOM export appears in Export ▾ only when
  more than one graph has people. Toolbar: **Download** (Ctrl/⌘+S), **Export ▾**, **Open…** (replaces the family;
  undoable).

## Alternatives considered
- **Keep Chrome's in-place save** — convenient there, but it behaves differently in other browsers, and it can
  silently overwrite a file another copy depends on. Download-only is one model everywhere, and nothing is
  overwritten.
- **A pop-up box next to the node** — quicker to glance at, but it duplicates the panel and covers the tree.
- **Start screen only for an empty app** — fewer clicks, but the explicit choice every session is where the save
  model is explained and where diverged sessions are surfaced.
- **IndexedDB for drafts** — more space, but more code; `localStorage` plus a clear "not backed up" state was
  judged enough for 50–100 people (photos are the only large part; ADR 0013).
- **`crypto.subtle`** — native and fast, but async and missing on plain-http pages.

## Consequences
- + One honest save model in every browser. The status and the start screen say exactly where the work is.
- + Downloaded files are self-identifying (fingerprint, time, parent) and never collide by name.
- + A first-time user sees only one tree and family editing; nothing was removed for experienced users.
- − Every download is a new file, so users manage their own versions (the names sort by time).
- − Opening always takes one extra click, except with `#start=` or a deep link.
- − Browser storage is per browser and per device, and can be cleared by the user or the browser. The start screen
  and status make that visible, but only Download is durable.
