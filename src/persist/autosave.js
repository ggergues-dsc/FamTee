// Draft recovery in browser storage (ADR 0006). The file stays the source of truth;
// drafts only protect unsaved edits from a closed tab or a crash. Storage access
// can throw (private mode, blocked site data), so every call is guarded.

const PREFIX = 'famtee:draft:';

export function draftKey(doc) {
  return PREFIX + doc.meta.id;
}

export function saveDraft(storage, doc) {
  try {
    storage.setItem(draftKey(doc), JSON.stringify({ savedAt: new Date().toISOString(), doc }));
    return true;
  } catch {
    return false;
  }
}

// Returns the stored draft for this document if it is newer than `doc`, else null.
export function findNewerDraft(storage, doc) {
  try {
    const raw = storage.getItem(draftKey(doc));
    if (!raw) return null;
    const draft = JSON.parse(raw);
    const draftModified = draft?.doc?.meta?.modified ?? '';
    return draftModified > (doc.meta.modified ?? '') ? draft : null;
  } catch {
    return null;
  }
}

export function clearDraft(storage, doc) {
  try {
    storage.removeItem(draftKey(doc));
  } catch {
    // nothing to clean up
  }
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
