# 0006 — Save via File System Access API, download fallback, local autosave

- **Status**: Accepted
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
