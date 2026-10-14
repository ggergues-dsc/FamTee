import { test, assert, assertEqual, assertThrows } from './harness.js';
import { parseGedcom, writeTag, child } from '../src/io/gedcom/lines.js';
import { dateFromGedcom, dateToGedcom, nameFromGedcom, nameToGedcom } from '../src/io/gedcom/convert.js';
import { importGedcom, addImportedGraph, looksLikeGedcom } from '../src/io/gedcom/import.js';
import { exportGedcom } from '../src/io/gedcom/export.js';
import { createDocument, addPerson, addUnion, addChild, addGroup, addGraph, addLink, updateNodeAttrs } from '../src/store/model.js';
import { addPartnerTo, partnersOfUnion, childrenOfUnion } from '../src/store/family.js';
import { Store } from '../src/store/store.js';
import { validate } from '../src/store/validate.js';
import { displayName } from '../src/render/format.js';

// A small but awkward 5.5.1 file: BOM, CRLF, CONC/CONT, GIVN/SURN, ABT dates, an
// adopted child, a divorce and a remarriage, a shared NOTE record, a dangling
// reference, unsupported tags and one malformed line.
const SAMPLE = '\uFEFF' + [
  '0 HEAD', '1 SOUR TEST', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8',
  '0 @I1@ INDI', '1 NAME John /Smith/ Jr.', '1 SEX M', '1 BIRT', '2 DATE 14 MAR 1950', '2 PLAC Cairo, Egypt',
  '1 DEAT', '2 DATE ABT 2010', '1 NOTE First line', '2 CONC  continues', '2 CONT Second line', '1 FAMS @F1@', '1 FAMS @F2@',
  '1 OCCU Engineer', '1 SOUR @S1@',
  '0 @I2@ INDI', '1 NAME Mary /Jones/', '2 GIVN Mary Ann', '1 SEX F', '1 BIRT', '2 DATE MAR 1952', '1 FAMS @F1@', '1 NOTE @N1@',
  '0 @I3@ INDI', '1 NAME Ann /Lee/', '1 SEX F', '1 FAMS @F2@',
  '0 @I4@ INDI', '1 NAME Tom /Smith/', '1 SEX M', '1 BIRT', '2 DATE 1975', '1 FAMC @F1@',
  '0 @I5@ INDI', '1 NAME Kim /Smith/', '1 FAMC @F2@', '2 PEDI adopted', '1 NOTE email kim@@example.com',
  '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I4@', '1 MARR', '2 DATE 1 JUN 1972', '2 PLAC Alexandria', '1 DIV', '2 DATE 1980',
  '0 @F2@ FAM', '1 HUSB @I1@', '1 WIFE @I3@', '1 CHIL @I5@', '1 CHIL @I99@',
  '0 @N1@ NOTE Shared note', '1 CONT with two lines',
  '0 @S1@ SOUR', '1 TITL Census',
  'this line is broken',
  '0 TRLR',
].join('\r\n');

const people = (graph) => Object.fromEntries(Object.entries(graph.nodes)
  .filter(([, n]) => n.type === 'person').map(([id, n]) => [displayName(n.attrs), { id, ...n.attrs }]));

test('parser builds the tree, folds CONC/CONT and reports bad lines', () => {
  const { records, warnings } = parseGedcom(SAMPLE);
  assertEqual(records.map((r) => r.tag), ['HEAD', 'INDI', 'INDI', 'INDI', 'INDI', 'INDI', 'FAM', 'FAM', 'NOTE', 'SOUR', 'TRLR']);
  assertEqual(child(records[1], 'NOTE').value, 'First line continues\nSecond line');
  assertEqual(child(child(records[1], 'BIRT'), 'PLAC').value, 'Cairo, Egypt');
  assertEqual(warnings, ['Line 63 is not valid GEDCOM and was skipped']);
  assert(looksLikeGedcom(SAMPLE) && !looksLikeGedcom('{"format":"famtee"}'));
});

test('dates convert both ways; non-standard dates survive', () => {
  assertEqual(dateFromGedcom('14 MAR 1950'), '1950-03-14');
  assertEqual(dateFromGedcom('mar 1952'), '1952-03');
  assertEqual(dateFromGedcom('1975'), '1975');
  assertEqual(dateFromGedcom('ABT 2010'), 'ABT 2010');
  assertEqual(dateFromGedcom('(sometime in spring)'), 'sometime in spring');
  assertEqual(dateToGedcom('1950-03-14'), '14 MAR 1950');
  assertEqual(dateToGedcom('1952-03'), 'MAR 1952');
  assertEqual(dateToGedcom('1975'), '1975');
  assertEqual(dateToGedcom('abt 2010'), 'ABT 2010');
  assertEqual(dateToGedcom('sometime in spring'), '(sometime in spring)');
  for (const d of ['1950-03-14', '1952-03', '1975', 'ABT 2010', 'BET 1900 AND 1910', 'sometime in spring']) {
    assertEqual(dateFromGedcom(dateToGedcom(d)), d, `round trip ${d}`);
  }
});

test('names convert both ways', () => {
  assertEqual(nameFromGedcom('John Paul /Smith/ Jr.'), { given: 'John Paul', surname: 'Smith', suffix: 'Jr.' });
  assertEqual(nameFromGedcom('/Smith/'), { surname: 'Smith' });
  assertEqual(nameFromGedcom('Cher'), { given: 'Cher' });
  assertEqual(nameFromGedcom('M /Jones/', 'Mary Ann', ''), { given: 'Mary Ann', surname: 'Jones' });
  assertEqual(nameToGedcom({ given: 'John', surname: 'Smith', suffix: 'Jr.' }), 'John /Smith/ Jr.');
  assertEqual(nameToGedcom({ given: 'Cher' }), 'Cher');
  assertEqual(nameToGedcom({ surname: 'Smith' }), '/Smith/');
});

test('import maps people, families, kinds, notes and reports what it skipped', () => {
  const { graph, stats, warnings } = importGedcom(SAMPLE, { title: 'Smiths' });
  assertEqual(stats, { people: 5, families: 2 });
  assertEqual(graph.title, 'Smiths');
  const p = people(graph);
  assertEqual(Object.keys(p).sort(), ['Ann Lee', 'John Smith', 'Kim Smith', 'Mary Ann Jones', 'Tom Smith']);
  const john = p['John Smith'];
  assertEqual(john.name, { given: 'John', surname: 'Smith', suffix: 'Jr.' });
  assertEqual(john.birth, { date: '1950-03-14', place: 'Cairo, Egypt' });
  assertEqual(john.death, { date: 'ABT 2010' });
  assertEqual(john.notes, 'First line continues\nSecond line');
  assertEqual(p['Mary Ann Jones'].notes, 'Shared note\nwith two lines', 'NOTE record resolved');
  assertEqual(p['Kim Smith'].notes, 'email kim@example.com', '@@ unescaped');

  const unions = Object.entries(graph.nodes).filter(([, n]) => n.type === 'union');
  const byPartner = (name) => unions.find(([u]) => partnersOfUnion(graph, u).includes(p[name].id));
  const [f1, first] = byPartner('Mary Ann Jones');
  assertEqual(first.attrs, { kind: 'divorced', start: '1972-06-01', place: 'Alexandria', end: '1980' });
  const [f2, second] = byPartner('Ann Lee');
  assertEqual(second.attrs.kind, 'partner', 'no MARR record: partners, not assumed married');
  assertEqual(childrenOfUnion(graph, f1), [p['Tom Smith'].id]);
  assertEqual(graph.edges.find((e) => e.to === p['Kim Smith'].id).attrs.kind, 'adopted');
  assertEqual(childrenOfUnion(graph, f2), [p['Kim Smith'].id], 'unknown child @I99@ skipped');

  assert(warnings.some((w) => w.includes('unknown child @I99@')));
  const skipped = warnings.find((w) => w.startsWith('Not imported'));
  assert(skipped.includes('2 × SOUR') && !skipped.includes('OCCU'), skipped);
  assertEqual(p['John Smith'].occupation, 'Engineer', 'OCCU becomes the job');
  assert(warnings.some((w) => w.includes('Line 63')));
});

test('imported graph is added with a tile, validates and can be undone', () => {
  const doc = createDocument();
  const root = doc.meta.rootGraph;
  const store = new Store(doc);
  const { graph } = importGedcom(SAMPLE, { title: 'Smiths' });
  const graphId = store.apply('import', (d) => addImportedGraph(d, root, graph));
  assertEqual(store.doc.graphs[graphId].title, 'Smiths');
  const tile = Object.values(store.doc.graphs[root].nodes).find((n) => n.type === 'graphRef');
  assertEqual(tile.attrs, { label: 'Smiths', graph: graphId });
  assertEqual(validate(store.doc), []);
  store.undo();
  assert(!store.doc.graphs[graphId]);
});

test('import rejects files that are not usable', () => {
  assertThrows(() => importGedcom('0 @I1@ INDI\n1 NAME A'), /no HEAD/);
  assertThrows(() => importGedcom('0 HEAD\n0 TRLR'), /no individuals/);
  const cyclic = ['0 HEAD', '0 @I1@ INDI', '0 @I2@ INDI', '0 @F1@ FAM', '1 HUSB @I1@', '1 CHIL @I2@',
    '0 @F2@ FAM', '1 HUSB @I2@', '1 CHIL @I1@', '0 TRLR'].join('\n');
  const doc = createDocument();
  const store = new Store(doc);
  const { graph } = importGedcom(cyclic);
  assertThrows(() => store.apply('import', (d) => addImportedGraph(d, d.meta.rootGraph, graph)), /ancestry cycle/);
  assertEqual(Object.keys(store.doc.graphs).length, 1, 'nothing added');
});

test('import warns about non-UTF-8 and newer GEDCOM versions', () => {
  const ansel = importGedcom('0 HEAD\n1 CHAR ANSEL\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n0 TRLR');
  assert(ansel.warnings.some((w) => w.includes('ANSEL')));
  assert(ansel.warnings.some((w) => w.includes('GEDCOM 7.0')));
});

// A family with remarriage, divorce, adoption, notes and odd characters.
function richDoc() {
  const doc = createDocument({ title: 'Rich' });
  const g = doc.meta.rootGraph;
  const dad = addPerson(doc, g, { name: { given: 'Omar', surname: 'Saleh' }, sex: 'M', birth: { date: '1950-03-14', place: 'Cairo' } });
  const mum = addPerson(doc, g, { name: { given: 'Nadia', surname: 'Fahmy' }, sex: 'F', death: { date: 'ABT 2010' } });
  const u1 = addUnion(doc, g, [dad, mum], { kind: 'divorced', start: '1972-06', end: '1980' });
  const kid = addPerson(doc, g, { name: { given: 'Lina', surname: 'Saleh' }, notes: 'Line one\nmail: lina@home.example ' + 'x'.repeat(450) });
  addChild(doc, g, u1, kid);
  const { personId: wife2, unionId: u2 } = addPartnerTo(doc, g, dad, { name: { given: 'Helen' }, sex: 'F' });
  const adopted = addPerson(doc, g, { name: 'Sam' });
  addChild(doc, g, u2, adopted, 'adopted');
  addChild(doc, g, u2, addPerson(doc, g, { name: { given: 'Step' } }), 'step');
  return { doc, g, dad, mum, kid, wife2, adopted, u1, u2 };
}

test('export writes valid 5.5.1 structure', () => {
  const { doc, g } = richDoc();
  const { text, stats, warnings } = exportGedcom(doc, g, { now: new Date(Date.UTC(2026, 9, 12)) });
  assertEqual(stats, { people: 6, families: 2 });
  const lines = text.split('\r\n');
  assertEqual(lines.slice(0, 3), ['0 HEAD', '1 SOUR FAMTEE', '2 NAME FamTee']);
  assert(lines.includes('1 DATE 12 OCT 2026') && lines.includes('2 VERS 5.5.1') && lines.includes('1 CHAR UTF-8'));
  assertEqual(lines.at(-2), '0 TRLR');
  assert(lines.every((l) => l === '' || /^\d+ (@[^@]+@ )?[A-Z_0-9]+( .*)?$/.test(l)), 'every line is well formed');
  assert(lines.every((l) => l.length <= 255), 'line length limit');
  assert(lines.includes('1 NAME Omar /Saleh/') && lines.includes('2 GIVN Omar') && lines.includes('2 SURN Saleh'));
  assert(lines.includes('2 DATE 14 MAR 1950') && lines.includes('2 DATE ABT 2010') && lines.includes('2 DATE JUN 1972'));
  assert(lines.includes('1 NAME Sam'), 'plain string names');
  assert(lines.includes('2 PEDI adopted'));
  assert(text.includes('lina@@home.example'), '@ escaped');
  assert(lines.some((l) => l.startsWith('3 CONC ')) || lines.some((l) => l.startsWith('2 CONC ')), 'long note split');
  assert(warnings.some((w) => w.includes('1 step-child relation')));
});

test('export puts men as HUSB and women as WIFE', () => {
  const doc = createDocument();
  const g = doc.meta.rootGraph;
  const wife = addPerson(doc, g, { name: { given: 'W' }, sex: 'F' });
  const husband = addPerson(doc, g, { name: { given: 'H' }, sex: 'M' });
  addUnion(doc, g, [wife, husband]);
  const lines = exportGedcom(doc, g).text.split('\r\n');
  const ref = (name) => lines[lines.indexOf(`1 NAME ${name}`) - 1].split(' ')[1];
  assert(lines.includes(`1 HUSB ${ref('H')}`) && lines.includes(`1 WIFE ${ref('W')}`));
});

test('export warns about everything GEDCOM cannot hold', () => {
  const { doc, g, dad, mum, kid } = richDoc();
  addGroup(doc, g, [dad, mum], { label: 'Home' });
  const other = addGraph(doc);
  addLink(doc, { type: 'same-as', from: `${g}:${kid}`, to: `${other}:${addPerson(doc, other)}` });
  updateNodeAttrs(doc, g, kid, { nudge: { dx: 4, dy: 0 } });
  const { warnings } = exportGedcom(doc, g);
  const lost = warnings.find((w) => w.startsWith('Not included'));
  for (const part of ['1 group(s)', '1 link(s) to other graphs', '1 manual card position(s)']) assert(lost.includes(part), part);
});

test('export → import round trip keeps people, families and details', () => {
  const { doc, g } = richDoc();
  const { graph } = importGedcom(exportGedcom(doc, g).text);
  const before = people(doc.graphs[g]);
  const after = people(graph);
  assertEqual(Object.keys(after).sort(), Object.keys(before).sort());
  for (const name of Object.keys(before)) {
    const { id: _a, ...b } = before[name];
    const { id: _b, ...a } = after[name];
    assertEqual(a, typeof b.name === 'string' ? { ...b, name: { given: b.name } } : b, name);
  }
  const kinds = (gr) => Object.values(gr.nodes).filter((n) => n.type === 'union').map((n) => n.attrs.kind).sort();
  assertEqual(kinds(graph), kinds(doc.graphs[g]));
  const childKinds = (gr) => gr.edges.filter((e) => e.type === 'child').map((e) => e.attrs.kind).sort();
  assertEqual(childKinds(graph), ['adopted', 'biological', 'biological'], 'step becomes biological (warned)');
});

test('writeTag splits long and multi-line values', () => {
  const out = [];
  writeTag(out, 1, 'NOTE', 'a'.repeat(450) + '\nsecond');
  assertEqual(out.map((l) => l.slice(0, 7)), ['1 NOTE ', '2 CONC ', '2 CONC ', '2 CONT ']);
  const { records } = parseGedcom(['0 @I1@ INDI', ...out.map((l) => l.replace(/^(\d)/, (d) => String(+d)))].join('\n'));
  assertEqual(child(records[0], 'NOTE').value, 'a'.repeat(450) + '\nsecond');
  const spaced = [];
  const words = 'word '.repeat(100).trim();
  writeTag(spaced, 1, 'NOTE', words);
  assert(spaced.length > 1);
  assert(spaced.slice(0, -1).every((l) => !l.endsWith(' ')), 'no line ends with a space before a CONC');
  assert(spaced.slice(1).every((l) => !l.startsWith('2 CONC  ')), 'no CONC starts with a space');
  assertEqual(child(parseGedcom(['0 @I1@ INDI', ...spaced].join('\n')).records[0], 'NOTE').value, words);
});
