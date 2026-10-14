import { test, assert, assertEqual } from './harness.js';
import { treeStructure, treeFamilies } from '../src/render/tree.js';
import { createRenderer } from '../src/render/renderer.js';
import { createDocument, addPerson, addUnion, addChild } from '../src/store/model.js';
import { addPetTo } from '../src/store/family.js';

// Two families joined by a marriage: the Smiths' Sarah marries the Garcias' Luis.
function twoFamilies() {
  const doc = createDocument({ title: 'Two families' });
  const g = doc.meta.rootGraph;
  const p = (given, surname, sex) => addPerson(doc, g, { name: { given, surname }, sex });
  const john = p('John', 'Smith', 'M'); const anne = p('Anne', 'Smith', 'F');
  const carlos = p('Carlos', 'Garcia', 'M'); const elena = p('Elena', 'Garcia', 'F');
  const sarah = p('Sarah', 'Smith', 'F'); const david = p('David', 'Smith', 'M'); const luis = p('Luis', 'Garcia', 'M');
  const mia = p('Mia', 'Garcia', 'F'); const kim = p('Kim', 'Lee', 'F');
  const smiths = addUnion(doc, g, [john, anne]);
  const garcias = addUnion(doc, g, [carlos, elena]);
  addChild(doc, g, smiths, sarah); addChild(doc, g, smiths, david); addChild(doc, g, garcias, luis);
  const graft = addUnion(doc, g, [sarah, luis]);
  addChild(doc, g, graft, mia);
  addUnion(doc, g, [david, kim]); // Kim married in
  return { doc, g, john, anne, carlos, sarah, david, luis, mia, kim, smiths, garcias, graft };
}

test('tree: founding couples are trunks; everyone belongs to the trunks they descend from', () => {
  const f = twoFamilies();
  const s = treeStructure(f.doc.graphs[f.g]);
  assertEqual(s.trunks.sort(), [f.smiths, f.garcias].sort());
  assertEqual([...s.familiesOf(f.sarah)], [f.smiths]);
  assertEqual([...s.familiesOf(f.luis)], [f.garcias]);
  assertEqual([...s.familiesOf(f.mia)].sort(), [f.smiths, f.garcias].sort(), 'a grafted couple’s child belongs to both');
  assertEqual([...s.familiesOf(f.kim)], [f.smiths], 'someone who married in belongs to their partner’s family');
  assertEqual([s.hasChildren(f.sarah), s.hasChildren(f.david)], [true, false]);
  assertEqual(s.grows(f.john), 4, 'John, Sarah, David and Mia');
  assertEqual(treeFamilies(f.doc.graphs[f.g], s).map((x) => x.name).sort(), ['Garcia', 'Smith']);
});

test('tree: drawing shows trunks, forks, leaves, a graft and pets', () => {
  const f = twoFamilies();
  addPetTo(f.doc, f.g, f.sarah, f.graft, { name: 'Biscuit', species: 'dog' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  try {
    const result = createRenderer(svg).render(f.doc, f.g, { mode: 'tree', selection: new Set([f.mia]) });
    assertEqual(result.mode, 'tree');
    assertEqual(result.families.length, 2);
    assertEqual(svg.querySelectorAll('.tree-person').length, 9);
    assert(svg.querySelector(`.tree-person.tree-leaf[data-id="${f.mia}"]`), 'Mia has no children: a leaf');
    assert(svg.querySelector(`.tree-person.tree-fork[data-id="${f.sarah}"]`), 'Sarah has a child: a fork');
    assertEqual(svg.querySelectorAll('.tree-graft').length, 1, 'Sarah and Luis join two families');
    assertEqual(svg.querySelectorAll('.tree-pet').length, 1);
    assertEqual(svg.querySelectorAll('.tree-family').length, 2);
    assert(svg.querySelector('.selection'), 'the selected person is ringed');
    assert(svg.querySelectorAll('.tree-limb').length > 10, 'branches drawn');
    assert(!svg.querySelector('rect.card'), 'no cards');
    const y = (id) => result.nodes[id].y;
    assert(y(f.mia) < y(f.sarah) && y(f.sarah) < y(f.john), 'descendants grow upward');
    assert(result.bounds.width > 0 && result.bounds.height > 0);
  } finally {
    svg.remove();
  }
});

test('tree: hiding a family hides its people but keeps a grafted couple’s children', () => {
  const f = twoFamilies();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  try {
    const renderer = createRenderer(svg);
    renderer.render(f.doc, f.g, { mode: 'tree', hidden: new Set([f.garcias]) });
    const ids = () => [...svg.querySelectorAll('.tree-person')].map((n) => n.dataset.id);
    assert(!ids().includes(f.luis) && !ids().includes(f.carlos), 'the Garcias are hidden');
    assert(ids().includes(f.mia) && ids().includes(f.sarah), 'Mia stays with her Smith side');
    assertEqual(svg.querySelectorAll('.tree-graft').length, 0, 'no graft with one side hidden');
    assertEqual(svg.querySelectorAll('.tree-family').length, 1);
  } finally {
    svg.remove();
  }
});

test('tree: the same family always looks the same', () => {
  const f = twoFamilies();
  const draw = () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    createRenderer(svg).render(f.doc, f.g, { mode: 'tree' });
    return [...svg.querySelectorAll('.tree-limb')].map((p) => p.getAttribute('d') ?? p.getAttribute('r')).join('|');
  };
  assertEqual(draw(), draw());
});
