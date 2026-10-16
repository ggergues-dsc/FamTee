import { test, assert, assertEqual } from './harness.js';
import { treeStructure, treeFamilies } from '../src/render/tree.js';
import { createRenderer } from '../src/render/renderer.js';
import { createDocument, addPerson, addUnion, addChild, addGraph, addGroup, addEdge, addLink } from '../src/store/model.js';
import { endpoint } from '../src/store/schema.js';
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
    const trunkX = (fam) => Math.min(...[...svg.querySelectorAll('.tree-family')].filter((t) => t.textContent === fam.name).map((t) => Number(t.getAttribute('x'))));
    assert(trunkX(result.families[0]) < trunkX(result.families[1]), 'families listed left to right');
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

test('tree: groups, other relations and links to other graphs', () => {
  const f = twoFamilies();
  const g2 = addGraph(f.doc, { title: 'Garcia family' });
  const copy = addPerson(f.doc, g2, { name: { given: 'Mia' } });
  addLink(f.doc, { type: 'same-as', from: endpoint(f.g, f.mia), to: endpoint(g2, copy) });
  addGroup(f.doc, f.g, [f.sarah, f.luis, f.mia], { label: 'Household' });
  addEdge(f.doc, f.g, { type: 'custom', from: f.david, to: f.mia, attrs: { label: 'godparent' } });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  try {
    const renderer = createRenderer(svg);
    renderer.render(f.doc, f.g, { mode: 'tree' });
    assertEqual(svg.querySelectorAll('.tree-group').length, 1);
    assertEqual(svg.querySelector('.group-label').textContent, 'Household');
    assertEqual(svg.querySelectorAll('.tree-relation').length, 1);
    assertEqual(svg.querySelector('.tree-relation-label').textContent, 'godparent');
    const badge = svg.querySelector('.link-badge');
    assert(badge && badge.dataset.linkGraph === g2 && badge.dataset.linkNode === copy, 'Mia links to her copy in the other graph');
    renderer.render(f.doc, f.g, { mode: 'tree', hidden: new Set([f.smiths]) });
    assertEqual(svg.querySelectorAll('.tree-relation').length, 0, 'David hidden: no relation line to him');
    assertEqual(svg.querySelectorAll('.tree-group').length, 1, 'the group outlines the members still shown');
  } finally {
    svg.remove();
  }
});

test('tree: couples’ branches meet above them, and every branch climbs', () => {
  const f = twoFamilies();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  try {
    const result = createRenderer(svg).render(f.doc, f.g, { mode: 'tree' });
    const graft = svg.querySelector('.tree-graft');
    const forkY = Number(graft.getAttribute('cy'));
    assert(forkY < result.nodes[f.sarah].y && forkY < result.nodes[f.luis].y, 'the fork is above the couple');
    assert(forkY > result.nodes[f.mia].y, 'and below their child');
    // No sideways runs: along each branch's outline, the top edge never stays level for long.
    for (const path of svg.querySelectorAll('path.tree-limb')) {
      const pts = path.getAttribute('d').match(/-?[\d.]+ -?[\d.]+/g).map((p) => p.split(' ').map(Number));
      const half = pts.slice(0, Math.floor(pts.length / 2));
      const span = Math.abs(half.at(-1)[1] - half[0][1]);
      if (span < 20) continue; // root flares are short and low by design
      const flat = half.slice(1).filter(([x, y], i) => Math.abs(y - half[i][1]) < 0.5 && Math.abs(x - half[i][0]) > 8).length;
      assert(flat === 0, `a branch runs sideways: ${path.getAttribute('d').slice(0, 60)}…`);
    }
  } finally {
    svg.remove();
  }
});

test('tree: founders sit on their trunk; no branch ever grows downward', () => {
  const f = twoFamilies();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  try {
    const r = createRenderer(svg).render(f.doc, f.g, { mode: 'tree' });
    const [john, anne] = [r.nodes[f.john], r.nodes[f.anne]];
    assertEqual(john.y, anne.y, 'level, either side of the trunk');
    const trunkX = (john.x + anne.x) / 2;
    assertEqual(Math.round(trunkX - john.x), Math.round(anne.x - trunkX), 'the same distance out on each side');
    assert(anne.x - john.x > 4 * 20, 'clear of the trunk, not stuck onto it');
    assert(john.y > r.nodes[f.sarah].y + 60, 'low down, well below their children');
    // a short twig from the trunk to each founder: a limb that ends at the founder
    const endsAt = (n) => [...svg.querySelectorAll('path.tree-limb')].some((path) => {
      const pts = path.getAttribute('d').match(/-?[\d.]+ -?[\d.]+/g).map((p) => p.split(' ').map(Number));
      const [x, y] = pts[Math.floor(pts.length / 2) - 1];
      return Math.hypot(x - n.x, y - n.y) < 8;
    });
    assert(endsAt(john) && endsAt(anne), 'each founder has a twig to the trunk');
    // Every branch outline climbs from where it starts to where it ends (only roots go down).
    for (const path of svg.querySelectorAll('path.tree-limb')) {
      const pts = path.getAttribute('d').match(/-?[\d.]+ -?[\d.]+/g).map((p) => p.split(' ').map(Number));
      const edge = pts.slice(0, Math.floor(pts.length / 2));
      edge.slice(1).forEach(([, y], i) => assert(y <= edge[i][1] + 0.6, `a branch grows downward: ${path.getAttribute('d').slice(0, 60)}…`));
    }
    assert(svg.querySelectorAll('path.tree-root').length >= 3, 'roots are the only downward parts');
    const label = [...svg.querySelectorAll('.tree-name')].find((t) => t.textContent === 'John Smith');
    assert(Number(label.getAttribute('y')) > john.y && Number(label.getAttribute('x')) === john.x, 'the name sits below the founder');
  } finally {
    svg.remove();
  }
});
