import { test, assert, assertEqual, assertThrows } from './harness.js';
import { migrate } from '../src/store/migrate.js';

test('current documents pass through unchanged', () => {
  const doc = { schemaVersion: 1 };
  const result = migrate(doc);
  assertEqual(result, { doc, readOnly: false, migratedFrom: null });
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
