import { test, assert, assertEqual } from './harness.js';
import { exportGedcom, exportGedcomMerged, graphOrder } from '../src/io/gedcom/export.js';
import { importGedcom } from '../src/io/gedcom/import.js';
import { parseGedcom, child, childrenOf } from '../src/io/gedcom/lines.js';
import {
  createDocument, addGraph, addGraphRef, addPerson, addUnion, addChild, addGroup, addLink,
} from '../src/store/model.js';
import { copyPersonTo, partnersOfUnion, parentUnionsOf, unionsOfPerson } from '../src/store/family.js';
import { validate } from '../src/store/validate.js';
import { displayName } from '../src/render/format.js';

// Like samples/sample.famtee.json: an overview with two family graphs, and Sarah
// appearing in both (born a Smith, married a Garcia).
function twoFamilies() {
  const doc = createDocument({ title: 'Sample' });
  const root = doc.meta.rootGraph;
  const smith = addGraph(doc, { title: 'Smith family' });
  const garcia = addGraph(doc, { title: 'Garcia family' });
  addGraphRef(doc, root, smith);
  addGraphRef(doc, root, garcia);
  const john = addPerson(doc, smith, { name: { given: 'John', surname: 'Smith' }, sex: 'M', birth: { date: '1948' } });
  const anne = addPerson(doc, smith, { name: { given: 'Anne', surname: 'Smith' }, sex: 'F' });
  const smiths = addUnion(doc, smith, [john, anne], { kind: 'married', start: '1972' });
  const david = addPerson(doc, smith, { name: { given: 'David', surname: 'Smith' }, sex: 'M' });
  const sarah = addPerson(doc, smith, { name: { given: 'Sarah', surname: 'Smith' }, sex: 'F', birth: { date: '1978' } });
  addChild(doc, smith, smiths, david);
  addChild(doc, smith, smiths, sarah);
  const luis = addPerson(doc, garcia, { name: { given: 'Luis', surname: 'Garcia' }, sex: 'M' });
  const sarahG = addPerson(doc, garcia, { name: { given: 'Sarah', surname: 'Garcia' }, sex: 'F', birth: { date: '1978', place: 'Leeds' } });
  const garcias = addUnion(doc, garcia, [luis, sarahG]);
  const mia = addPerson(doc, garcia, { name: { given: 'Mia', surname: 'Garcia' } });
  addChild(doc, garcia, garcias, mia);
  addGroup(doc, garcia, [luis, sarahG, mia], { label: 'Household' });
  addLink(doc, { type: 'same-as', from: `${smith}:${sarah}`, to: `${garcia}:${sarahG}` });
  return { doc, root, smith, garcia, john, anne, sarah, sarahG, smiths };
}

const records = (text, tag) => parseGedcom(text).records.filter((r) => r.tag === tag);
const names = (indi) => childrenOf(indi, 'NAME').map((n) => n.value);
const indiNamed = (text, name) => records(text, 'INDI').find((r) => names(r).includes(name));

test('graph order: root, then tiles breadth-first, then the rest', () => {
  const { doc, root, smith, garcia } = twoFamilies();
  const loose = addGraph(doc, { title: 'Loose' });
  assertEqual(graphOrder(doc), [root, smith, garcia, loose]);
});

test('a person linked across graphs is written once, with both names and both families', () => {
  const { doc } = twoFamilies();
  const { text, stats, warnings } = exportGedcomMerged(doc);
  assertEqual(stats, { people: 6, families: 2, graphs: 3 });
  const sarah = indiNamed(text, 'Sarah /Smith/');
  assertEqual(names(sarah), ['Sarah /Smith/', 'Sarah /Garcia/'], 'first graph’s name first');
  assertEqual(child(child(sarah, 'BIRT'), 'DATE').value, '1978');
  assertEqual(child(child(sarah, 'BIRT'), 'PLAC').value, 'Leeds', 'missing details filled from other graphs');
  const [famc] = childrenOf(sarah, 'FAMC');
  const [fams] = childrenOf(sarah, 'FAMS');
  const fam = (ref) => records(text, 'FAM').find((f) => f.xref === ref.value);
  assert(childrenOf(fam(famc), 'CHIL').some((c) => c.value === sarah.xref), 'child of the Smiths');
  assertEqual(child(fam(fams), 'WIFE').value, sarah.xref, 'wife in the Garcia family');
  const lost = warnings.find((w) => w.startsWith('Not included'));
  assert(lost.includes('1 group(s)') && lost.includes('2 sub-graph tile(s)'), lost);
  assert(!warnings.some((w) => w.includes('differ')), 'no conflicts here');
});

test('a couple recorded in two graphs becomes one family with all their children', () => {
  const { doc, smith, john, anne } = twoFamilies();
  const cousins = addGraph(doc, { title: 'Cousins' });
  const john2 = copyPersonTo(doc, smith, john, cousins);
  const anne2 = copyPersonTo(doc, smith, anne, cousins);
  const u = addUnion(doc, cousins, [john2, anne2], { kind: 'married', place: 'York' });
  addChild(doc, cousins, u, addPerson(doc, cousins, { name: { given: 'Peter', surname: 'Smith' } }));
  const { text, stats } = exportGedcomMerged(doc);
  assertEqual(stats.people, 7);
  const smithsFam = records(text, 'FAM').filter((f) => childrenOf(f, 'CHIL').length === 3);
  assertEqual(smithsFam.length, 1, 'one family with David, Sarah and Peter');
  assertEqual(child(child(smithsFam[0], 'MARR'), 'PLAC').value, 'York', 'details merged');
  assertEqual(stats.families, 2);
});

test('differing details: first graph wins, and the export says so', () => {
  const { doc, smith, john } = twoFamilies();
  const other = addGraph(doc, { title: 'Other' });
  const copy = copyPersonTo(doc, smith, john, other);
  doc.graphs[other].nodes[copy].attrs.birth = { date: '1949' };
  doc.graphs[other].nodes[copy].attrs.sex = 'F';
  const { text, warnings } = exportGedcomMerged(doc);
  assertEqual(child(child(indiNamed(text, 'John /Smith/'), 'BIRT'), 'DATE').value, '1948');
  const note = warnings.find((w) => w.includes('differ between graphs'));
  assert(note && note.startsWith('2 detail(s)') && note.includes('John Smith: birth date') && note.includes('John Smith: sex'), note);
});

test('same-as is followed transitively', () => {
  const doc = createDocument();
  const ids = ['A', 'B', 'C'].map((t) => addGraph(doc, { title: t }));
  const p = ids.map((g) => addPerson(doc, g, { name: { given: 'Pat' } }));
  addLink(doc, { type: 'same-as', from: `${ids[0]}:${p[0]}`, to: `${ids[1]}:${p[1]}` });
  addLink(doc, { type: 'same-as', from: `${ids[2]}:${p[2]}`, to: `${ids[1]}:${p[1]}` });
  assertEqual(exportGedcomMerged(doc).stats.people, 1);
});

test('lone parents merge only when they share a child', () => {
  const doc = createDocument();
  const [a, b] = [addGraph(doc), addGraph(doc)];
  const mum = addPerson(doc, a, { name: { given: 'Mum' } });
  const kid = addPerson(doc, a, { name: { given: 'Kid' } });
  addChild(doc, a, addUnion(doc, a, [mum]), kid);
  const mum2 = copyPersonTo(doc, a, mum, b);
  const kid2 = copyPersonTo(doc, a, kid, b);
  addChild(doc, b, addUnion(doc, b, [mum2]), kid2);
  addChild(doc, b, addUnion(doc, b, [mum2]), addPerson(doc, b, { name: { given: 'Other' } }));
  const { stats, text } = exportGedcomMerged(doc);
  assertEqual(stats.families, 2, 'shared child merged; a different child stays separate');
  assertEqual(records(text, 'FAM').map((f) => childrenOf(f, 'CHIL').length).sort(), [1, 1]);
});

test('"related" links are reported as not included', () => {
  const { doc, garcia, john, smith } = twoFamilies();
  addLink(doc, { type: 'custom', from: `${smith}:${john}`, to: `${garcia}:${addPerson(doc, garcia)}`, attrs: { label: 'godparent' } });
  const lost = exportGedcomMerged(doc).warnings.find((w) => w.startsWith('Not included'));
  assert(lost.includes('1 "related" link(s) between graphs'), lost);
});

test('merged export imports back as one connected tree', () => {
  const { doc } = twoFamilies();
  const { graph, warnings } = importGedcom(exportGedcomMerged(doc).text);
  const byName = Object.fromEntries(Object.entries(graph.nodes)
    .filter(([, n]) => n.type === 'person').map(([id, n]) => [displayName(n.attrs), id]));
  assertEqual(Object.keys(byName).sort(), ['Anne Smith', 'David Smith', 'John Smith', 'Luis Garcia', 'Mia Garcia', 'Sarah Smith']);
  const sarah = byName['Sarah Smith'];
  const [parents] = parentUnionsOf(graph, sarah);
  assertEqual(partnersOfUnion(graph, parents).sort(), [byName['John Smith'], byName['Anne Smith']].sort());
  assertEqual(unionsOfPerson(graph, sarah)[0].partners, [byName['Luis Garcia']]);
  assert(warnings.some((w) => w.includes('1 × NAME (additional names)')), 'second name reported on import');
  const doc2 = createDocument();
  doc2.graphs.imported = graph;
  assertEqual(validate(doc2), []);
});

test('single-graph export is unchanged by links to other graphs', () => {
  const { doc, garcia } = twoFamilies();
  const { stats, warnings } = exportGedcom(doc, garcia);
  assertEqual(stats, { people: 3, families: 1 });
  assert(warnings.some((w) => w.includes('1 link(s) to other graphs')));
});
