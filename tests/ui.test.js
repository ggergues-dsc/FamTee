import { test, assert, assertEqual } from './harness.js';
import { createPanel } from '../src/ui/panel.js';
import { createToolbar } from '../src/ui/toolbar.js';
import { h, confirmButton, menuButton } from '../src/ui/dom.js';
import { Store } from '../src/store/store.js';
import { unionsOfPerson, parentUnionsOf, groupsOf } from '../src/store/family.js';
import { addGraph, addPerson } from '../src/store/model.js';
import { smallFamily } from './fixtures.js';

// A panel wired to a real Store, with the same ctx contract main.js provides.
function setup({ readOnly = false } = {}) {
  const fam = smallFamily();
  const store = new Store(fam.doc, { readOnly });
  const view = { path: [fam.g], selection: new Set() };
  const errors = [];
  const notices = [];
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
    notify: (message, kind) => notices.push([kind, message]),
    openNode(graphId, nodeId) { if (view.path.at(-1) !== graphId) view.path.push(graphId); ctx.select(nodeId); },
    back() { view.path.pop(); panel.render(); },
  };
  const panel = createPanel(container, ctx);
  store.subscribe(() => panel.render());
  panel.render();
  return { ...fam, store, view, ctx, panel, container, errors, notices };
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
  const controls = [...s.container.querySelectorAll('.panel-body :is(input, select, textarea, button:not(.link))')];
  assert(controls.length > 5);
  assert(controls.every((c) => c.disabled), controls.filter((c) => !c.disabled).map((c) => c.outerHTML).join());
  assert(s.container.querySelectorAll('button.link:not(:disabled)').length > 0);
  s.container.remove();
});

test('detail panel collapses to a strip, and remembers it', () => {
  const s = setup();
  let saved = 0;
  s.ctx.savePanelPrefs = () => { saved++; };
  const collapse = s.container.querySelector('.panel-collapse');
  assertEqual(collapse.getAttribute('aria-expanded'), 'true');
  collapse.click();
  assert(s.view.panelCollapsed && s.container.classList.contains('collapsed'));
  assert(s.container.querySelector('.panel-body').hidden, 'details hidden');
  assertEqual([collapse.getAttribute('aria-expanded'), collapse.title], ['false', 'Show details']);
  assert(s.container.querySelector('.panel-mode').hidden, 'only the expand control shows');
  s.ctx.select(s.mum); // selecting while collapsed doesn't reopen it
  assert(s.container.querySelector('.panel-body').hidden);
  collapse.click();
  assert(!s.view.panelCollapsed && field(s.container, 'given'), 'reopens on the selected person');
  assertEqual(saved, 2);
  s.container.remove();
});

test('View mode shows the details read-only; Edit brings the form back', () => {
  const s = setup();
  s.ctx.savePanelPrefs = () => {};
  s.ctx.select(s.mum);
  button(s.container, 'View').click();
  assertEqual(s.view.panelMode, 'view');
  const body = s.container.querySelector('.panel-body');
  assert(body.classList.contains('view-mode'));
  assert(field(s.container, 'given').disabled && field(s.container, 'given').value === 'Ann', 'fields read as text');
  assert(body.querySelector('[name="given"]').closest('label').classList.contains('empty') === false);
  assert(body.querySelector('[name="notes"]').closest('label').classList.contains('empty'), 'empty fields are left out');
  assert([...body.querySelectorAll('button:not(.link)')].every((b) => b.disabled), 'no editing buttons');
  const link = [...body.querySelectorAll('button.link')].find((b) => b.textContent === 'Cid');
  assert(link && !link.disabled, 'relatives can still be opened');
  link.click();
  assertEqual([...s.view.selection], [s.kid]);
  assert(field(s.container, 'given').disabled, 'still View on the next person');
  assertEqual(button(s.container, 'View').getAttribute('aria-pressed'), 'true');
  button(s.container, 'Edit').click();
  assert(!field(s.container, 'given').disabled && !body.classList.contains('view-mode'));
  s.container.remove();
});

test('a read-only family has no Edit switch', () => {
  const s = setup({ readOnly: true });
  assert(s.container.querySelector('.panel-mode').hidden);
  s.container.remove();
});

test('toolbar says where changes are: browser only until downloaded', () => {
  const { doc, g } = smallFamily();
  const store = new Store(doc);
  const container = h('div');
  let downloads = 0;
  const toolbar = createToolbar(container, {
    undo: () => store.undo(), redo: () => store.redo(), download: () => downloads++,
    exportJson() {}, exportGedcom() {}, exportGedcomMerged() {}, openFile() {},
  });
  const state = () => container.querySelector('.save-state');
  toolbar.render(store, {});
  assert(button(container, 'Undo').disabled);
  assertEqual(state().textContent, 'No unsaved changes');
  assert(button(container, 'GEDCOM: all graphs merged').hidden, 'one tree: no merged export');

  store.apply('Rename', (d) => { d.graphs[g].title = 'x'; });
  toolbar.render(store, { draftAt: '2026-10-13T15:30:00Z', storageOk: true });
  assert(state().textContent.startsWith('Kept in this browser') && state().textContent.endsWith('· not downloaded'), state().textContent);
  assert(state().title.includes('in this browser only'));
  assert(button(container, 'Undo').title.startsWith('Undo Rename'));

  toolbar.render(store, { storageOk: false });
  assertEqual(state().textContent, 'Not backed up · download to keep your work');
  assert(state().classList.contains('error'));

  button(container, 'Download').click();
  assertEqual(downloads, 1);
  store.markSaved();
  toolbar.render(store, { downloadedAt: '2026-10-13T15:31:00Z', downloadName: 'f.html', multiGraph: true });
  assert(state().textContent.startsWith('Downloaded '));
  assertEqual(state().title, 'Saved to your disk as f.html');
  assert(!button(container, 'GEDCOM: all graphs merged').hidden);
  assert(!button(container, 'Save'), 'no in-place Save any more');
});

test('links: copy into another graph, link, label, open and remove', () => {
  const s = setup();
  s.ctx.select(s.mum);
  assert(!s.container.querySelector('.link-form') || s.container.querySelector('.link-form').hidden, 'no other graphs yet');
  let other;
  let stranger;
  s.store.apply('setup', (d) => {
    other = addGraph(d, { title: 'In-laws' });
    stranger = addPerson(d, other, { name: { given: 'Zed' } });
  });
  assert(!s.container.querySelector('.link-form').hidden);
  assertEqual(field(s.container, 'link-graph').value, other);
  s.store.apply('empty graph first', (d) => {
    const { [other]: moved, ...rest } = d.graphs;
    d.graphs = { ...rest, 'g-empty': { title: 'Empty', nodes: {}, edges: [] }, [other]: moved };
  });
  s.ctx.select(null);
  s.ctx.select(s.mum); // fresh panel: no remembered choice
  assertEqual(field(s.container, 'link-graph').options[0].textContent, 'Empty');
  assertEqual(field(s.container, 'link-graph').value, other, 'defaults to a graph with people, not the first one');
  assertEqual([...field(s.container, 'link-person').options].map((o) => o.textContent), ['Zed']);

  button(s.container, 'Copy into that graph').click();
  const copyLink = s.store.doc.links[0];
  assertEqual(copyLink.type, 'same-as');
  assert(button(s.container, 'Copy into that graph').disabled, 'already in that graph');
  assertEqual([...field(s.container, 'link-person').options].map((o) => o.textContent), ['Zed'], 'own copy is not offered');

  change(field(s.container, 'link-type'), 'custom');
  assert(!field(s.container, 'link-label').hidden);
  assertEqual(field(s.container, 'link-person').options.length, 2, 'related-to may target anyone');
  field(s.container, 'link-person').value = stranger;
  field(s.container, 'link-label').value = 'godparent';
  button(s.container, 'Link').click();
  assertEqual(s.store.doc.links[1].attrs, { label: 'godparent' });
  const items = [...s.container.querySelectorAll('.links li')].map((li) => li.querySelector('.link').textContent);
  assertEqual(items, ['Same person in In-laws', 'godparent: Zed (In-laws)']);

  s.container.querySelectorAll('.links li')[1].querySelector('.link').click();
  assertEqual([s.view.path.at(-1), [...s.view.selection][0]], [other, stranger]);
  s.ctx.select(stranger);
  s.container.querySelector('.links li .icon').click();
  assertEqual(s.store.doc.links.length, 1);
  s.container.remove();
});

test('groups: create, add, remove, rename and delete from the panels', () => {
  const s = setup();
  const graph = () => s.store.doc.graphs[s.g];
  s.ctx.select(s.mum);
  assertEqual(field(s.container, 'add-group').value, '', 'only "New group" when none exist');
  button(s.container, 'Add to group').click();
  const [group] = groupsOf(graph(), s.mum);
  assertEqual(graph().nodes[group].attrs.label, 'New group');

  s.ctx.select(s.dad);
  assertEqual(field(s.container, 'add-group').value, group, 'existing group offered first');
  button(s.container, 'Add to group').click();
  assertEqual(graph().nodes[group].attrs.members, [s.mum, s.dad]);

  s.ctx.select(group);
  change(field(s.container, 'group-label'), 'Household');
  assertEqual(graph().nodes[group].attrs.label, 'Household');
  assertEqual([...s.container.querySelectorAll('.people li .link')].map((b) => b.textContent), ['Ann', 'Bob']);
  s.container.querySelector('.people li .icon').click();
  assertEqual(graph().nodes[group].attrs.members, [s.dad]);

  s.ctx.select(s.dad);
  s.container.querySelector('.people li .icon[title^="Remove from"]').click();
  assert(!graph().nodes[group], 'removing the last member removes the group');

  s.ctx.select(s.kid);
  button(s.container, 'Add to group').click();
  const [g2] = groupsOf(graph(), s.kid);
  s.ctx.select(null);
  assert([...s.container.querySelectorAll('.people li .link')].some((b) => b.textContent === 'New group'), 'graph panel lists groups');
  s.ctx.select(g2);
  const del = button(s.container, 'Delete group');
  del.click();
  del.click();
  assert(!graph().nodes[g2] && graph().nodes[s.kid], 'group deleted, member kept');
  s.container.remove();
});

test('menu button opens, runs an item, and closes on Escape or an outside click', () => {
  const ran = [];
  const menu = menuButton('Export ▾', [
    { label: 'One', run: () => ran.push(1) },
    { label: 'Two', run: () => ran.push(2) },
  ]);
  document.body.append(menu.element);
  assert(menu.menu.hidden);
  menu.button.click();
  assert(!menu.menu.hidden);
  assertEqual(menu.button.getAttribute('aria-expanded'), 'true');
  button(menu.menu, 'Two').click();
  assertEqual(ran, [2]);
  assert(menu.menu.hidden, 'closes after choosing');

  menu.button.click();
  menu.menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(menu.menu.hidden, 'Escape closes');
  menu.button.click();
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  assert(menu.menu.hidden, 'outside click closes');
  menu.element.remove();
});

test('photo: add from a file, change, remove; bad files are reported', async () => {
  const s = setup();
  s.ctx.select(s.mum);
  const input = field(s.container, 'photo-file');
  const pick = async (file) => {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 150));
  };
  const canvas = Object.assign(document.createElement('canvas'), { width: 600, height: 300 });
  canvas.getContext('2d').fillRect(0, 0, 600, 300);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  assertEqual(button(s.container, 'Add photo…').textContent, 'Add photo…');
  await pick(new File([blob], 'me.png', { type: 'image/png' }));
  const photo = node(s, s.mum).attrs.photo;
  assert(photo && s.store.doc.media[photo].width === 512, 'medium size stored');
  assertEqual([s.store.doc.media[photo].thumb?.width, s.store.doc.media[photo].thumb?.height], [96, 48], 'miniature stored too');
  assert(!s.container.querySelector('img.photo').hidden);
  assert(button(s.container, 'Change…'), 'button relabelled');
  const hint = s.container.querySelector('.photo-section .hint').textContent;
  assert(hint.startsWith('512×256') && hint.includes('miniature 96×48'), hint);
  assertEqual(s.store.undoStack.at(-1).label, 'Add photo');

  await pick(new File(['nope'], 'notes.txt', { type: 'text/plain' }));
  assertEqual(s.notices.at(-1)[0], 'error');
  assert(s.notices.at(-1)[1].includes("notes.txt isn't"));
  assertEqual(node(s, s.mum).attrs.photo, photo, 'unchanged after a bad file');

  button(s.container, 'Remove').click();
  assert(!node(s, s.mum).attrs.photo);
  assert(s.container.querySelector('img.photo').hidden);

  s.ctx.select(null);
  s.store.undo();
  assert(s.container.querySelector('.photo-usage').textContent.startsWith('1 photo embedded'));
  s.container.remove();
});

test('simple by default: advanced controls are collapsed, everything else visible', () => {
  const s = setup();
  const advanced = s.container.querySelector('details.advanced');
  assert(advanced && !advanced.open, 'graph panel: Advanced collapsed');
  assert(advanced.contains(button(s.container, '+ Sub-graph')) && advanced.contains(button(s.container, 'Reset layout')));
  assert(!advanced.contains(button(s.container, '+ Person')), '+ Person stays visible');
  s.ctx.select(s.mum);
  const personAdvanced = s.container.querySelector('details.advanced');
  assert(personAdvanced.contains(button(s.container, 'Add to group')), 'groups are advanced');
  assert(personAdvanced.contains(s.container.querySelector('.links')), 'cross-graph links are advanced');
  assert(!personAdvanced.contains(button(s.container, '+ Partner')), 'family editing stays visible');
  assert(s.container.querySelector('.all-attributes dl').textContent.includes(s.mum), 'all attributes visible');
  personAdvanced.open = true;
  personAdvanced.dispatchEvent(new Event('toggle'));
  s.ctx.select(s.dad);
  assert(s.container.querySelector('details.advanced').open, 'open state remembered while you work');
  s.container.remove();
});

test('all attributes refresh after an edit', () => {
  const s = setup();
  s.ctx.select(s.mum);
  change(field(s.container, 'birth-place'), 'Cairo');
  assert(s.container.querySelector('.all-attributes').textContent.includes('Cairo'));
  s.container.remove();
});

test('layout orientation is a graph setting: undoable and saved in the file', () => {
  const s = setup();
  const select = field(s.container, 'orientation');
  assertEqual(select.value, 'TB');
  change(select, 'LR');
  assertEqual(s.store.doc.graphs[s.g].layout, { orientation: 'LR' });
  assertEqual(s.store.undoStack.at(-1).label, 'Change layout');
  s.store.undo();
  assertEqual(field(s.container, 'orientation').value, 'TB');
  s.container.remove();
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

test('person panel: Twin of lists brothers and sisters; Identical applies to the pair', () => {
  const s = setup();
  const sib = s.store.apply('Add sibling', (d) => {
    const id = addPerson(d, s.g, { name: { given: 'Dee' } });
    d.graphs[s.g].edges.push({ id: 'e-sib', type: 'child', from: s.union, to: id, attrs: { kind: 'biological' } });
    return id;
  });
  s.ctx.select(s.kid);
  const of = field(s.container, 'twin-of');
  assertEqual([...of.options].map((o) => o.textContent), ['Not a twin', 'Dee']);
  assert(field(s.container, 'twin-identical').disabled, 'Identical needs a twin first');
  change(of, sib);
  assertEqual(s.store.undoStack.at(-1).label, 'Mark as twins');
  const identical = field(s.container, 'twin-identical');
  assert(!identical.disabled && !identical.checked);
  identical.checked = true;
  identical.dispatchEvent(new Event('change'));
  const edges = s.store.doc.graphs[s.g].edges.filter((e) => e.attrs?.birthGroup);
  assertEqual(edges.map((e) => e.attrs.identical), [true, true]);
  change(field(s.container, 'twin-of'), '');
  assertEqual(s.store.doc.graphs[s.g].edges.filter((e) => e.attrs?.birthGroup).length, 0, 'Not a twin clears the pair');
  s.ctx.select(s.mum);
  assert(s.container.querySelector('section.twin').hidden, 'no brothers or sisters here: no Twin section');
  s.container.remove();
});
