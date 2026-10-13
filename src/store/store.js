// The single source of truth for the open document. Every change runs through
// apply(), which snapshots for undo and rolls back changes that break integrity.

import { validate } from './validate.js';

const UNDO_LIMIT = 200;

// Undo snapshot: a deep copy of everything except doc.media, which is append-only
// (ADR 0013) and therefore safe to share. Copying embedded photos on every edit
// would cost megabytes per undo step.
function snapshot(doc) {
  const { media, ...rest } = doc;
  const copy = structuredClone(rest);
  if (media) copy.media = media;
  return copy;
}

export class ValidationError extends Error {
  constructor(errors) {
    super(errors.map((e) => e.message).join('; '));
    this.errors = errors;
  }
}

export class Store {
  constructor(doc, { readOnly = false } = {}) {
    // Created up front so every undo snapshot shares the same media object.
    if (!readOnly) doc.media ??= {};
    this.doc = doc;
    this.readOnly = readOnly;
    this.dirty = false;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
  }

  // Runs fn(doc) as one undoable change and returns its result.
  apply(label, fn) {
    if (this.readOnly) throw new Error('Document is read-only');
    const before = snapshot(this.doc);
    let result;
    try {
      result = fn(this.doc);
      const errors = validate(this.doc);
      if (errors.length) throw new ValidationError(errors);
    } catch (e) {
      this.doc = before;
      throw e;
    }
    this.doc.meta.modified = new Date().toISOString();
    this.undoStack.push({ label, doc: before });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.#changed();
    return result;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push({ label: entry.label, doc: this.doc });
    this.doc = entry.doc;
    this.#changed();
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push({ label: entry.label, doc: this.doc });
    this.doc = entry.doc;
    this.#changed();
  }

  markSaved() {
    this.dirty = false;
    this.#emit();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #changed() {
    this.dirty = true;
    this.#emit();
  }

  #emit() {
    for (const listener of this.listeners) listener(this);
  }
}
