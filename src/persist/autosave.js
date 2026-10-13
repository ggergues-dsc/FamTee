// Browser-first saving (ADR 0006, 0017). While you edit, the document is kept in this
// browser's storage; the disk is only written when you download. Storage access can
// throw (private mode, blocked site data, quota), so every call is guarded.
//
// Keys:
//   famtee:draft:<doc id>   { savedAt, baseHash, doc }  unsaved work for one family
//   famtee:last-session     doc id of the most recently edited family
//   famtee:downloads:<id>   { hash, savedAt, filename }  the last download of that family

import { withoutUnusedMedia } from '../store/media.js';

const DRAFT = 'famtee:draft:';
const LAST = 'famtee:last-session';
const DOWNLOADS = 'famtee:downloads:';
const KEEP_DRAFTS = 5;

export function draftKey(doc) {
  return DRAFT + doc.meta.id;
}

function read(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Keeps doc as the unsaved work for its family. baseHash is the revision hash of the
// version the work started from (null for a new tree). Returns false if storage
// refused (e.g. full).
export function saveDraft(storage, doc, { baseHash = null, now = new Date() } = {}) {
  try {
    storage.setItem(draftKey(doc), JSON.stringify({ savedAt: now.toISOString(), baseHash, doc: withoutUnusedMedia(doc) }));
    storage.setItem(LAST, doc.meta.id);
    pruneDrafts(storage);
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(storage, docId) {
  const draft = docId ? read(storage, DRAFT + docId) : null;
  return draft?.doc?.meta ? draft : null;
}

// The draft of the most recently edited family, if any.
export function lastSessionDraft(storage) {
  let id = null;
  try {
    id = storage.getItem(LAST);
  } catch {
    return null;
  }
  return loadDraft(storage, id);
}

// How a stored draft relates to the file being opened:
//   'none'       no unsaved work for this family
//   'continues'  the work started from exactly this file's version
//   'diverged'   the work started from a different version (older or newer copy)
export function draftRelation(storage, fileDoc) {
  const draft = loadDraft(storage, fileDoc.meta.id);
  if (!draft) return { relation: 'none', draft: null };
  const fileHash = fileDoc.meta.revision?.hash ?? null;
  return { relation: draft.baseHash === fileHash ? 'continues' : 'diverged', draft };
}

export function clearDraft(storage, doc) {
  try {
    storage.removeItem(draftKey(doc));
  } catch {
    // nothing to clean up
  }
}

function pruneDrafts(storage) {
  const drafts = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(DRAFT)) drafts.push([key, read(storage, key)?.savedAt ?? '']);
  }
  drafts.sort((a, b) => b[1].localeCompare(a[1]));
  for (const [key] of drafts.slice(KEEP_DRAFTS)) storage.removeItem(key);
}

export function recordDownload(storage, doc, filename) {
  try {
    const { hash, savedAt } = doc.meta.revision;
    storage.setItem(DOWNLOADS + doc.meta.id, JSON.stringify({ hash, savedAt, filename }));
  } catch {
    // only informational
  }
}

export function lastDownload(storage, docId) {
  return read(storage, DOWNLOADS + docId);
}

// Calls fn after `delay` ms of quiet; each call restarts the timer.
export function debounce(fn, delay) {
  let timer = null;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  debounced.flush = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  return debounced;
}
