import { test, assert, assertEqual } from './harness.js';
import { createPanel } from '../src/ui/panel.js';
import { createToolbar } from '../src/ui/toolbar.js';
import { h, confirmButton } from '../src/ui/dom.js';
import { Store } from '../src/store/store.js';
import { unionsOfPerson, parentUnionsOf } from '../src/store/family.js';
import { smallFamily } from './fixtures.js';

// A panel wired to a real Store, with the same ctx contract main.js provides.
function setup({ readOnly = false } = {}) {
  const fam = smallFamily();
  const store = new Store(fam.doc, { readOnly });
  const view = { path: [fam.g], selection: new Set() };
  const errors = [];
  const container = h('div');
  document.body.append(container);
  const ctx = {
    store, view,
    currentGraph: () => view.path.at(-1),
    edit(label, fn) {
      try { return store.apply(label, fn); } catch (e) { errors.push(e.message); return undefined; }
    },
    editAndSelect(label, fn) { const id = ctx.edit(label, fn); if (id) ctx.select(id); },
    select(id) { view.selection = id ? new Set([id]) : new Set(); panel.render(); },
    open(graphId) { view.path.push(graphId); panel.render(); },
    back() { view.path.pop(); panel.render(); },
  };
  const panel = createPanel(container, ctx);
  store.subscribe(() => panel.render());
  panel.render();
  return { ...fam, store, view, ctx, panel, container, errors };
}

const field = (c, name) => c.querySelector(`[name="${name}"]`);
const button = (c, text) => [...c.querySelectorAll('button')].find((b) => b.textContent === text);
const change = (el, value) => {
  el.value = value;
  el.dispatchEvent(new Event('change'));
};
const node = (s, id) => s.store.doc.graphs[s.g].nodes[id];

test('person form edits nested attributes and removes emptied ones', () => {
  const s = setup();
  s.ctx.select(s.mum);
  assertEqual(field(s.container, 'given').value, 'Ann');
  change(field(s.container, 'surname'), '  Lee ');
  change(field(s.container, 'birth-date'), '1950');
  change(field(s.container, 'sex'), 'F');
  assertEqual(node(s, s.mum).attrs.name, { given: 'Ann', surname: 'Lee' });
  assertEqual(node(s, s.mum).attrs.birth, { date: '1950' });
  assertEqual(node(s, s.mum).attrs.sex, 'F');
  change(field(s.container, 'birth-date'), '');
  assert(!('birth' in node(s, s.mum).attrs));
  assertEqual(s.store.undoStack.length, 4);
  s.container.remove();
});

test('panel keeps its inputs across edits (focus is not lost)', () => {
  const s = setup();
  s.ctx.select(s.mum);
  const surname = field(s.container, 'surname');
  change(field(s.container, 'given'), 'Anna');
  assert(field(s.container, 'surname') === surname, 'same element after edit');
  s.store.undo();
  assertEqual(field(s.container, 'given').value, 'Ann', 'values refresh after undo');
  s.container.remove();
});

test('adding relatives selects the new person', () => {
  const s = setup();
  s.ctx.select(s.kid);
  button(s.container, '+ Partner').click();
  const [partner] = s.view.selection;
  assert(partner !== s.kid && node(s, partner).type === 'person');
  assertEqual(unionsOfPerson(s.store.doc.graphs[s.g], s.kid)[0].partners, [partner]);

  s.ctx.select(s.kid);
  assertEqual(field(s.container, 'child-union').selectedIndex, 0, 'defaults to the first partnership');
  button(s.container, '+ Child').click();
  const [child] = s.view.selection;
  const [union] = unionsOfPerson(s.store.doc.graphs[s.g], s.kid);
  assertEqual(union.children, [child]);

  s.ctx.select(child);
  assert(button(s.container, '+ Parent').disabled, 'already has two parents');
  s.ctx.select(partner);
  assert(!button(s.container, '+ Parent').disabled, 'married-in partner has no parents yet');
  button(s.container, '+ Parent').click();
  assertEqual(parentUnionsOf(s.store.doc.graphs[s.g], partner).length, 1);
  s.container.remove();
});

test('delete needs a second click', () => {
  const s = setup();
  s.ctx.select(s.kid);
  const del = button(s.container, 'Delete person');
  del.click();
  assert(node(s, s.kid), 'first click only arms');
  assertEqual(del.textContent, 'Click again to delete');
  del.click();
  assert(!node(s, s.kid));
  assertEqual(s.view.selection.size, 0);
  s.container.remove();
});

test('union panel edits the partnership', () => {
  const s = setup();
  s.ctx.select(s.union);
  change(field(s.container, 'kind'), 'divorced');
  change(field(s.container, 'end'), '1990');
  assertEqual(node(s, s.union).attrs, { kind: 'divorced', end: '1990' });
  assertEqual(s.container.querySelectorAll('.people li').length, 3);
  s.container.remove();
});

test('graph panel renames, adds people and sub-graphs', () => {
  const s = setup();
  assert(!/\bnull\b|undefined/.test(s.container.textContent), 'no stray null/undefined text');
  assert(!button(s.container, 'Delete this graph'), 'root graph cannot be deleted');
  change(field(s.container, 'doc-title'), 'The Lees');
  change(field(s.container, 'graph-title'), 'Main line');
  assertEqual(s.store.doc.meta.title, 'The Lees');
  assertEqual(s.store.doc.graphs[s.g].title, 'Main line');
  button(s.container, '+ Person').click();
  assertEqual(node(s, [...s.view.selection][0]).attrs.name.given, 'New person');
  s.ctx.select(null);
  button(s.container, '+ Sub-graph').click();
  assertEqual(s.view.path.length, 2);
  assertEqual(s.store.doc.graphs[s.view.path[1]].title, 'New family');
  assert(button(s.container, 'Delete this graph'), 'sub-graphs can be deleted');
  s.container.remove();
});

test('Reset layout clears all manual moves in one step', () => {
  const s = setup();
  const reset = button(s.container, 'Reset layout');
  assert(reset.hidden, 'hidden while nothing was moved');
  s.store.apply('move', (d) => {
    d.graphs[s.g].nodes[s.mum].attrs.nudge = { dx: 5, dy: 0 };
    d.graphs[s.g].nodes[s.kid].attrs.nudge = { dx: 0, dy: 9 };
  });
  assert(!reset.hidden);
  reset.click();
  assert(!node(s, s.mum).attrs.nudge && !node(s, s.kid).attrs.nudge);
  assertEqual(s.store.undoStack.at(-1).label, 'Reset layout');
  s.container.remove();
});

test('rejected edits leave the document unchanged and report why', () => {
  const s = setup();
  s.ctx.select(s.kid);
  // Making the child a parent of its own mother would be an ancestry cycle.
  s.ctx.edit('cycle', (doc) => {
    const u = parentUnionsOf(doc.graphs[s.g], s.kid)[0];
    doc.graphs[s.g].edges.push({ id: 'e-bad', type: 'partner', from: s.kid, to: u, attrs: {} });
  });
  assertEqual(s.errors.length, 1);
  assert(/ancestry cycle/.test(s.errors[0]));
  assert(!s.store.canUndo);
  s.container.remove();
});

test('read-only documents disable every control', () => {
  const s = setup({ readOnly: true });
  s.ctx.select(s.mum);
  // Name links in the relatives lists only change the selection, so they stay enabled.
  const controls = [...s.container.querySelectorAll('input, select, textarea, button:not(.link)')];
  assert(controls.length > 5);
  assert(controls.every((c) => c.disabled), controls.filter((c) => !c.disabled).map((c) => c.outerHTML).join());
  assert(s.container.querySelectorAll('button.link:not(:disabled)').length > 0);
  s.container.remove();
});

test('toolbar reflects store state', () => {
  const { doc, g } = smallFamily();
  const store = new Store(doc);
  const container = h('div');
  let saved = 0;
  const toolbar = createToolbar(container, { undo: () => store.undo(), redo: () => store.redo(), save: () => saved++, exportJson() {}, importFile() {} });
  toolbar.render(store);
  assert(button(container, 'Undo').disabled);
  assertEqual(container.querySelector('.save-state').textContent, 'All changes saved');
  store.apply('Rename', (d) => { d.graphs[g].title = 'x'; });
  toolbar.render(store);
  assert(!button(container, 'Undo').disabled);
  assert(button(container, 'Undo').title.startsWith('Undo Rename'));
  assertEqual(container.querySelector('.save-state').textContent, '● Unsaved changes');
  button(container, 'Save').click();
  assertEqual(saved, 1);
});

test('h() treats strings as text, never markup', () => {
  const el = h('p', { class: 'x', dataset: { id: '1' } }, '<b>bold</b>', null, ['a', 'b']);
  assertEqual(el.innerHTML, '&lt;b&gt;bold&lt;/b&gt;ab');
  assertEqual(el.dataset.id, '1');
  let ran = 0;
  const b = confirmButton('Go', 'Sure?', () => ran++);
  b.click();
  assertEqual(ran, 0);
  b.click();
  assertEqual(ran, 1);
});
