// Forward migrations between schema versions (ADR 0004, docs/data-model.md "Versioning").
// MIGRATIONS[n] upgrades a version-n document to version n+1.

import { CURRENT_SCHEMA_VERSION } from './schema.js';

export const MIGRATIONS = {
  // 2 adds pets (node and edge type "pet") and person occupation/employer. A version-1
  // document is already valid version 2; the bump makes older apps open new files read-only.
  1: (doc) => doc,
};

// Returns { doc, readOnly, migratedFrom }. A document newer than this app opens
// read-only so saving cannot silently drop data the app does not understand.
export function migrate(doc, { migrations = MIGRATIONS, current = CURRENT_SCHEMA_VERSION } = {}) {
  const from = doc?.schemaVersion;
  if (!Number.isInteger(from) || from < 1) throw new Error(`Unsupported schemaVersion: ${from}`);
  if (from > current) return { doc, readOnly: true, migratedFrom: null };

  let result = doc;
  for (let v = from; v < current; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`No migration from schemaVersion ${v} to ${v + 1}`);
    result = step(result);
    result.schemaVersion = v + 1;
  }
  return { doc: result, readOnly: false, migratedFrom: from === current ? null : from };
}
