import { test, assert, assertEqual, assertThrows } from './harness.js';
import { Store, ValidationError } from '../src/store/store.js';
import { addPerson, addUnion, addChild } from '../src/store/model.js';
import { smallFamily } from './fixtures.js';

const people = (store, g) => Object.values(store.doc.graphs[g].nodes).filter((n) => n.type === 'person').length;

test('apply, undo and redo', () => {
  const { doc, g } = smallFamily();
  const store = new Store(doc);
  const id = store.apply('add person', (d) => addPerson(d, g, { name: { given: 'Dee' } }));
  assert(id.startsWith('p-'));
  assertEqual(people(store, g), 4);
  assert(store.dirty && store.canUndo && !store.canRedo);
  store.undo();
  assertEqual(people(store, g), 3);
  store.redo();
  assertEqual(people(store, g), 4);
  assertEqual(store.doc.graphs[g].nodes[id].attrs.name.given, 'Dee');
});

test('a new change clears the redo stack', () => {
  const { doc, g } = smallFamily();
  const store = new Store(doc);
  store.apply('a', (d) => addPerson(d, g));
  store.undo();
  store.apply('b', (d) => addPerson(d, g));
  assert(!store.canRedo);
});

test('changes that break integrity are rolled back', () => {
  const { doc, g, mum, kid } = smallFamily();
  const store = new Store(doc);
  const before = JSON.stringify(store.doc);
  const err = assertThrows(() => store.apply('cycle', (d) => addChild(d, g, addUnion(d, g, [kid]), mum)), /ancestry cycle/);
  assert(err instanceof ValidationError);
  assertEqual(JSON.stringify(store.doc), before);
  assert(!store.canUndo && !store.dirty);
});

test('exceptions inside apply are rolled back', () => {
  const { doc, g } = smallFamily();
  const store = new Store(doc);
  assertThrows(() => store.apply('half', (d) => { addPerson(d, g); throw new Error('boom'); }), /boom/);
  assertEqual(people(store, g), 3);
});

test('read-only stores refuse changes', () => {
  const { doc, g } = smallFamily();
  const store = new Store(doc, { readOnly: true });
  assertThrows(() => store.apply('x', (d) => addPerson(d, g)), /read-only/);
});

test('subscribers are notified and markSaved clears dirty', () => {
  const { doc, g } = smallFamily();
  const store = new Store(doc);
  let calls = 0;
  const off = store.subscribe(() => calls++);
  store.apply('a', (d) => addPerson(d, g));
  store.markSaved();
  assert(!store.dirty);
  off();
  store.undo();
  assertEqual(calls, 2);
});
