import { test, assert, assertEqual } from './harness.js';
import { addGraph, addPerson, addUnion, addChild, addGraphRef, addLink } from '../src/store/model.js';
import { validate } from '../src/store/validate.js';
import { smallFamily } from './fixtures.js';

const codes = (doc) => validate(doc).map((e) => e.code);

test('rejects non-documents', () => {
  assertEqual(codes(null), ['not-object']);
  assert(codes({ format: 'other', schemaVersion: 1, meta: {}, graphs: {}, links: [] }).includes('format'));
});

test('detects a missing root graph', () => {
  const { doc } = smallFamily();
  doc.meta.rootGraph = 'g-missing';
  assertEqual(codes(doc), ['root-graph']);
});

test('detects dangling and mistyped edges', () => {
  const { doc, g, mum, kid } = smallFamily();
  doc.graphs[g].edges.push({ id: 'e-x', type: 'child', from: mum, to: kid, attrs: {} });
  doc.graphs[g].edges.push({ id: 'e-y', type: 'partner', from: mum, to: 'p-ghost', attrs: {} });
  assertEqual(codes(doc), ['edge-endpoints', 'dangling-edge']);
});

test('detects duplicate ids across graphs', () => {
  const { doc, g, mum } = smallFamily();
  const other = addGraph(doc);
  doc.graphs[other].nodes[mum] = structuredClone(doc.graphs[g].nodes[mum]);
  assertEqual(codes(doc), ['duplicate-id']);
});

test('detects bad links', () => {
  const { doc, g, mum, union } = smallFamily();
  const other = addGraph(doc);
  const p = addPerson(doc, other);
  doc.links.push({ id: 'l-1', type: 'same-as', from: `${g}:${union}`, to: `${other}:${p}`, attrs: {} });
  doc.links.push({ id: 'l-2', type: 'custom', from: `${g}:${mum}`, to: `${other}:p-ghost`, attrs: {} });
  assertEqual(codes(doc), ['same-as', 'dangling-link']);
});

test('detects someone being their own ancestor', () => {
  const { doc, g, mum, kid } = smallFamily();
  const u = addUnion(doc, g, [kid]);
  addChild(doc, g, u, mum);
  assertEqual(codes(doc), ['ancestry-cycle']);
});

test('detects ancestry cycles through same-as links across graphs', () => {
  const { doc, g, mum, kid } = smallFamily();
  const other = addGraph(doc);
  const kid2 = addPerson(doc, other);
  const mum2 = addPerson(doc, other);
  addChild(doc, other, addUnion(doc, other, [kid2]), mum2);
  assertEqual(validate(doc), []);
  addLink(doc, { type: 'same-as', from: `${g}:${kid}`, to: `${other}:${kid2}` });
  assertEqual(validate(doc), []);
  addLink(doc, { type: 'same-as', from: `${g}:${mum}`, to: `${other}:${mum2}` });
  assertEqual(codes(doc), ['ancestry-cycle']);
});

test('allows pedigree collapse (cousins marrying)', () => {
  const { doc, g, union } = smallFamily();
  const kid2 = addPerson(doc, g);
  addChild(doc, g, union, kid2);
  const [kid1] = doc.graphs[g].edges.filter((e) => e.type === 'child').map((e) => e.to);
  const s1 = addPerson(doc, g);
  const s2 = addPerson(doc, g);
  const c1 = addPerson(doc, g);
  const c2 = addPerson(doc, g);
  addChild(doc, g, addUnion(doc, g, [kid1, s1]), c1);
  addChild(doc, g, addUnion(doc, g, [kid2, s2]), c2);
  addChild(doc, g, addUnion(doc, g, [c1, c2]), addPerson(doc, g));
  assertEqual(validate(doc), []);
});

test('detects graphRef cycles and unknown targets', () => {
  const { doc, g } = smallFamily();
  const a = addGraph(doc);
  addGraphRef(doc, g, a);
  addGraphRef(doc, a, g);
  assertEqual(codes(doc), ['graph-ref-cycle']);
  doc.graphs[a].nodes['ref-x'] = { type: 'graphRef', attrs: { graph: 'g-ghost' } };
  assert(codes(doc).includes('graph-ref'));
});

test('preserves unknown attrs (forward compatibility)', () => {
  const { doc, g, mum } = smallFamily();
  doc.graphs[g].nodes[mum].attrs.futureField = { anything: true };
  doc.graphs[g].futureGraphField = 1;
  assertEqual(validate(doc), []);
});
