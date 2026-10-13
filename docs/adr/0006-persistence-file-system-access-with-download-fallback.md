# 0006 — Save via File System Access API, download fallback, local autosave

- **Status**: Superseded by [0017](0017-browser-first-sessions-and-simple-mode.md) for saving (download-only, no in-place overwrite); browser drafts continue there
- **Date**: 2026-10-12

## Context
Full in-browser editing is required, but a web page cannot normally overwrite its own file. Browser support for
writing files differs: Chromium has the File System Access (FSA) API; Firefox and Safari do not.

## Decision
- **Save (Chromium)**: on first save, `showSaveFilePicker` (or `showOpenFilePicker` on the opened file) obtains
  a handle; subsequent saves overwrite in place. The saved HTML is the current page template with the data block
  replaced by the serialized Store.
- **Save (Firefox/Safari)**: generate a Blob and trigger a download of `famtee-<title>-<date>.html`;
  user replaces the old file.
- **Autosave draft**: debounced write of the document to `localStorage` keyed by `meta.id`. On load, if a draft
  is newer than the embedded data, offer "Restore unsaved changes".
- **Dirty indicator** + `beforeunload` warning when unsaved.
- The file is always the source of truth; browser storage is only a safety net.

## Alternatives considered
- **IndexedDB/localStorage as primary store** — data trapped in one browser profile/device; defeats portability.
- **Local helper server** — requires install; breaks "just a browser".
- **TiddlyWiki-style saver extensions** — extra install per browser.

## Consequences
- + Works everywhere; best experience on Chromium.
- − Firefox/Safari users manage file versions manually (downloads folder); document clearly.
- − Safari may evict localStorage after inactivity — acceptable for a draft cache.

## Implementation notes (2026-10-12)

Implemented in `src/persist/` and wired in `src/main.js`:

- **What gets saved.** At startup, before anything renders, the app records `document.documentElement.outerHTML`
  (`captureTemplate`). Save writes that template back with the data block replaced. Because the template is
  captured before rendering, no rendered SVG or panel state ends up in the file. Saving a reopened file with no
  changes produces byte-identical output, and the end-to-end test checks this.
- **Development mode can't save HTML.** A page loaded from separate module/CSS files would save a broken file.
  It shows a message instead; Export JSON still works there.
- **File handles last one session.** A page opened from `file://` can't get a handle to its own file. The first
  Save in a session shows the picker (choose the original file to overwrite it), and later saves reuse that handle.
- **Drafts** are written to `localStorage` 800 ms after the last change (and on `beforeunload`), keyed by
  `meta.id`. They are offered for restore only when newer than the file's `meta.modified`. Saving or exporting
  clears the draft.
- **Import** replaces the document through `Store.apply`, so it can be undone. It accepts `.famtee.json` files
  and FamTee `.html` files (the embedded data is read out).
