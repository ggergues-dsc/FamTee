import { test, assert, assertEqual, assertThrows } from './harness.js';
import { migrate } from '../src/store/migrate.js';
import { CURRENT_SCHEMA_VERSION } from '../src/store/schema.js';

test('current documents pass through unchanged', () => {
  const doc = { schemaVersion: CURRENT_SCHEMA_VERSION };
  const result = migrate(doc);
  assertEqual(result, { doc, readOnly: false, migratedFrom: null });
});

test('version 1 documents (before pets and jobs) open as version 2 unchanged', () => {
  const doc = { schemaVersion: 1, graphs: { g: { nodes: {}, edges: [] } } };
  const result = migrate(structuredClone(doc));
  assertEqual(result, { doc: { ...doc, schemaVersion: 2 }, readOnly: false, migratedFrom: 1 });
});

test('newer documents open read-only', () => {
  const result = migrate({ schemaVersion: 99 });
  assert(result.readOnly);
});

test('migrations are chained in order', () => {
  const migrations = {
    1: (d) => ({ ...d, steps: [...d.steps, 'to2'] }),
    2: (d) => ({ ...d, steps: [...d.steps, 'to3'] }),
  };
  const result = migrate({ schemaVersion: 1, steps: [] }, { migrations, current: 3 });
  assertEqual(result.doc, { schemaVersion: 3, steps: ['to2', 'to3'] });
  assertEqual(result.migratedFrom, 1);
});

test('missing migrations and bad versions throw', () => {
  assertThrows(() => migrate({ schemaVersion: 1 }, { migrations: {}, current: 2 }), /No migration/);
  assertThrows(() => migrate({ schemaVersion: '1' }), /Unsupported/);
  assertThrows(() => migrate({}), /Unsupported/);
});
