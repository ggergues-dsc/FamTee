import { test, assert, assertEqual, assertThrows } from './harness.js';
import { possibleTwins, twinsOf, setTwin, clearTwin, setTwinsIdentical } from '../src/store/family.js';
import { createDocument, addPerson, addUnion, addChild } from '../src/store/model.js';
import { validate } from '../src/store/validate.js';
import { createRenderer } from '../src/render/renderer.js';
import { personSummary } from '../src/ui/snapshot.js';
import { exportGedcom } from '../src/io/gedcom/export.js';
import { importGedcom } from '../src/io/gedcom/import.js';

// Parents with four children: Leo, Noah, Lily and Ava; and a cousin from another family.
function family() {
  const doc = createDocument({ title: 'Twins' });
  const g = doc.meta.rootGraph;
  const p = (given, sex = 'U') => addPerson(doc, g, { name: { given, surname: 'Hanna' }, sex, birth: { date: '2006' } });
  const mum = p('Emma', 'F'); const dad = p('Mark', 'M');
  const u = addUnion(doc, g, [mum, dad]);
  const [leo, noah, lily, ava] = ['Leo', 'Noah', 'Lily', 'Ava'].map((n) => { const id = p(n); addChild(doc, g, u, id); return id; });
  const cousin = p('Sam');
  addChild(doc, g, addUnion(doc, g, [p('Rami', 'M')]), cousin);
  return { doc, g, graph: doc.graphs[g], leo, noah, lily, ava, cousin, mum };
}

test('twins: only brothers and sisters with the same parents; groups, identical and undoing', () => {
  const f = family();
  assertEqual(possibleTwins(f.graph, f.noah).sort(), [f.leo, f.lily, f.ava].sort());
  assertThrows(() => setTwin(f.doc, f.g, f.noah, f.cousin), /same parents/);
  assertThrows(() => setTwin(f.doc, f.g, f.noah, f.noah), /own twin/);
  setTwin(f.doc, f.g, f.noah, f.lily);
  assertEqual(twinsOf(f.graph, f.noah), { group: twinsOf(f.graph, f.lily).group, identical: false, twins: [f.lily] });
  setTwinsIdentical(f.doc, f.g, f.lily, true);
  assertEqual(twinsOf(f.graph, f.noah).identical, true, 'identical applies to the group');
  setTwin(f.doc, f.g, f.noah, f.ava); // a third: triplets
  assertEqual(twinsOf(f.graph, f.noah).twins.sort(), [f.lily, f.ava].sort());
  assertEqual(twinsOf(f.graph, f.ava).identical, true, 'joins as identical');
  assertEqual(validate(f.doc), []);
  clearTwin(f.doc, f.g, f.ava);
  assertEqual(twinsOf(f.graph, f.ava), null);
  clearTwin(f.doc, f.g, f.lily);
  assertEqual(twinsOf(f.graph, f.noah), null, 'a group of one dissolves');
  assertEqual(f.graph.edges.filter((e) => e.attrs?.birthGroup || e.attrs?.identical).length, 0, 'nothing left behind');
  assertEqual(twinsOf(f.graph, f.mum), null, 'someone without parents is never a twin');
});

test('twins: validation keeps a birth group within one family', () => {
  const f = family();
  setTwin(f.doc, f.g, f.noah, f.lily);
  const group = twinsOf(f.graph, f.noah).group;
  f.graph.edges.find((e) => e.type === 'child' && e.to === f.cousin).attrs.birthGroup = group;
  assert(validate(f.doc).some((e) => e.code === 'twins'));
});

test('twins on cards: one point on the family line, a V; a bar for identical twins', () => {
  const f = family();
  setTwin(f.doc, f.g, f.noah, f.lily);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  try {
    const renderer = createRenderer(svg);
    renderer.render(f.doc, f.g);
    const twinPaths = [...svg.querySelectorAll('.edge-child.twin')].map((e) => e.getAttribute('d'));
    assertEqual(twinPaths.length, 2);
    const meet = twinPaths.map((d) => d.split(' ').slice(0, 7).join(' '));
    assertEqual(meet[0], meet[1], 'both leave the family line from the same point');
    assert(twinPaths.every((d) => / L /.test(d)), 'then split diagonally');
    assertEqual(svg.querySelectorAll('.twin-bar').length, 0, 'fraternal: no bar');
    setTwinsIdentical(f.doc, f.g, f.noah, true);
    renderer.render(f.doc, f.g);
    assertEqual(svg.querySelectorAll('.twin-bar').length, 1, 'identical: a bar across the V');
  } finally {
    svg.remove();
  }
});

test('twins in the tree: identical fork level and linked; fraternal fork unevenly', () => {
  const f = family();
  setTwin(f.doc, f.g, f.noah, f.lily);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  try {
    const renderer = createRenderer(svg);
    let r = renderer.render(f.doc, f.g, { mode: 'tree' });
    assert(r.nodes[f.noah].y !== r.nodes[f.lily].y, 'fraternal twins sit at different heights');
    assertEqual(svg.querySelectorAll('.tree-twin-link').length, 0);
    setTwinsIdentical(f.doc, f.g, f.noah, true);
    r = renderer.render(f.doc, f.g, { mode: 'tree' });
    assertEqual(r.nodes[f.noah].y, r.nodes[f.lily].y, 'identical twins sit level');
    assertEqual(svg.querySelectorAll('.tree-twin-link').length, 1, 'and are linked');
    assertEqual(svg.querySelectorAll('.tree-twin-knot').length, 1);
  } finally {
    svg.remove();
  }
});

test('twins in the hover card', () => {
  const f = family();
  setTwin(f.doc, f.g, f.noah, f.lily);
  const twinRow = (id) => Object.fromEntries(personSummary(f.doc, f.g, id).rows).Twin;
  assertEqual(twinRow(f.noah), 'Twin of Lily Hanna');
  setTwinsIdentical(f.doc, f.g, f.noah, true);
  assertEqual(twinRow(f.lily), 'Identical twin of Noah Hanna');
  setTwin(f.doc, f.g, f.noah, f.ava);
  assertEqual(twinRow(f.ava), 'Identical triplets with Noah Hanna and Lily Hanna');
  assertEqual(twinRow(f.leo), undefined, 'not a twin: no row');
});

test('twins in GEDCOM: written as an association, read back as twins', () => {
  const f = family();
  setTwin(f.doc, f.g, f.noah, f.lily);
  setTwinsIdentical(f.doc, f.g, f.noah, true);
  const { text } = exportGedcom(f.doc, f.g);
  assertEqual(text.match(/1 ASSO @I\d+@\r?\n2 RELA Identical twin/g)?.length, 2, 'each twin names the other');
  const { graph, warnings } = importGedcom(text, { title: 'Back' });
  const id = (given) => Object.keys(graph.nodes).find((k) => graph.nodes[k].attrs.name?.given === given);
  assertEqual(twinsOf(graph, id('Noah')), { group: twinsOf(graph, id('Lily')).group, identical: true, twins: [id('Lily')] });
  assert(!warnings.some((w) => w.includes('ASSO')), warnings.join('; '));
});
