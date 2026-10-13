# 0001 — Hybrid packaging: single HTML with embedded data + external JSON import/export

- **Status**: Accepted
- **Date**: 2026-10-12

## Context
FamTee must be portable and media/OS indifferent: open in any browser, offline, straight from disk, USB, email
attachment or a synced folder. Data and visualization should travel together. The open question was whether
data lives *inside* the HTML or in a *separate file in the same folder*.

Key technical fact: under `file://`, Chromium blocks `fetch()`/XHR of sibling files and ES-module imports.
A "UI + data.json in a folder" design therefore does not work by double-clicking the HTML.

## Decision
- The shippable artifact is **one file**, `famtee.html`, containing the app (inlined JS/CSS) and the document in
  `<script type="application/json" id="famtee-data">`.
- The app can **export** the document to `<name>.famtee.json` and **import** one (and GEDCOM, ADR 0010).
- "Save" rewrites the HTML with the updated data block (ADR 0006); "Export data" writes JSON only.
- An empty `famtee.html` (no data) acts as the blank app / template.

## Alternatives considered
- **HTML + `data.json` folder** — broken on `file://` in Chromium (fetch blocked). Rejected.
- **HTML + `data.js` folder** (`window.FAMTEE = …` via `<script src>`) — works on `file://`, but two files
  must stay together and the browser cannot write back to `data.js` outside Chromium. Kept as optional fallback only.
- **Single file only, no external format** — loses backup, diffing (git), sharing data without the app and
  upgrading the app independently of data.
- **Data picked by the user every launch** — friction on every open.

## Consequences
- + One file to share; works identically on every OS/browser.
- + External JSON enables version control, backups, merging and app upgrades ("open new app, import old data").
- − The app code is duplicated in each saved family file (~100–300 KB) — acceptable.
- − Upgrading the app inside an existing file requires "import into newer famtee.html"; document this flow.
- Follow-up: show app version and schemaVersion in the UI; offer "Update app" guidance.
