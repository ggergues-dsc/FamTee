import { test, assert, assertEqual, assertThrows } from './harness.js';
import {
  addPartnerTo, addChildTo, addParentTo, removePerson, replaceDocument,
  unionsOfPerson, parentUnionsOf, partnersOfUnion, childrenOfUnion,
  connectPartners, connectParent, connectChild, connectSibling, connectRelated,
} from '../src/store/family.js';
import { addPerson, createDocument } from '../src/store/model.js';
import { validate } from '../src/store/validate.js';
import { smallFamily } from './fixtures.js';

test('addPartnerTo creates a person and a union', () => {
  const { doc, g, kid } = smallFamily();
  const { personId, unionId } = addPartnerTo(doc, g, kid, { name: { given: 'Pat' } });
  const graph = doc.graphs[g];
  assertEqual(partnersOfUnion(graph, unionId).sort(), [kid, personId].sort());
  assertEqual(unionsOfPerson(graph, kid).map((u) => u.partners), [[personId]]);
  assertEqual(validate(doc), []);
});

test('addChildTo uses the chosen union or a new single-parent union', () => {
  const { doc, g, mum, union } = smallFamily();
  const graph = doc.graphs[g];
  const a = addChildTo(doc, g, mum, union);
  assertEqual(a.unionId, union);
  assertEqual(childrenOfUnion(graph, union).length, 2);
  const b = addChildTo(doc, g, mum, null);
  assert(b.unionId !== union);
  assertEqual(graph.nodes[b.unionId].attrs.kind, 'single');
  assertEqual(partnersOfUnion(graph, b.unionId), [mum]);
  assertThrows(() => addChildTo(doc, g, b.personId, union), /not a partner/);
  assertEqual(validate(doc), []);
});

test('addParentTo fills the parent union up to two partners', () => {
  const { doc, g, mum, kid } = smallFamily();
  const graph = doc.graphs[g];
  assertThrows(() => addParentTo(doc, g, kid), /already has two parents/);

  const orphan = addPerson(doc, g);
  const first = addParentTo(doc, g, orphan);
  assertEqual(parentUnionsOf(graph, orphan), [first.unionId]);
  const second = addParentTo(doc, g, orphan);
  assertEqual(second.unionId, first.unionId);
  assertEqual(partnersOfUnion(graph, first.unionId).length, 2);

  const solo = addChildTo(doc, g, mum, null);
  const joined = addParentTo(doc, g, solo.personId);
  assertEqual(joined.unionId, solo.unionId);
  assertEqual(graph.nodes[solo.unionId].attrs.kind, 'married', 'single union becomes a couple');
  assertEqual(validate(doc), []);
});

test('removePerson drops unions that become meaningless', () => {
  const { doc, g, mum, dad, union, kid } = smallFamily();
  const graph = doc.graphs[g];
  const { personId: partner, unionId: u2 } = addPartnerTo(doc, g, kid);
  removePerson(doc, g, partner);
  assert(!graph.nodes[u2], 'childless union with one partner left is removed');
  removePerson(doc, g, dad);
  assert(graph.nodes[union], 'union with a child is kept');
  assertEqual(partnersOfUnion(graph, union), [mum]);
  removePerson(doc, g, kid);
  assert(!graph.nodes[union], 'union with one partner and no children is removed');
  assertEqual(validate(doc), []);
});

test('replaceDocument swaps content in place', () => {
  const { doc } = smallFamily();
  const other = createDocument({ title: 'Other' });
  const ref = doc;
  replaceDocument(doc, other);
  assert(ref === doc);
  assertEqual(doc, other);
  doc.meta.title = 'changed';
  assertEqual(other.meta.title, 'Other', 'deep copy');
});

test('connecting people already in the graph', () => {
  const { doc, g, mum, dad, union, kid } = smallFamily();
  const graph = doc.graphs[g];
  const rosa = addPerson(doc, g, { name: { given: 'Rosa' } });
  const u = connectPartners(doc, g, kid, rosa, { kind: 'partner', start: '2001' });
  assertEqual(partnersOfUnion(graph, u).sort(), [kid, rosa].sort());
  assertEqual(graph.nodes[u].attrs, { kind: 'partner', start: '2001' });
  assertThrows(() => connectPartners(doc, g, rosa, kid), /already partners/);
  assertThrows(() => connectPartners(doc, g, kid, kid), /themselves/);
  assertThrows(() => connectPartners(doc, g, kid, union), /Only people/);

  const sib = addPerson(doc, g);
  assertEqual(connectSibling(doc, g, kid, sib), union);
  assertEqual(childrenOfUnion(graph, union).sort(), [kid, sib].sort());
  assertThrows(() => connectSibling(doc, g, kid, sib), /already has parents/);
  assertThrows(() => connectSibling(doc, g, rosa, addPerson(doc, g)), /parents first/);

  const baby = addPerson(doc, g);
  assertEqual(connectChild(doc, g, rosa, baby, u), u);
  assertThrows(() => connectChild(doc, g, mum, addPerson(doc, g), u), /not a partner/);
  assertThrows(() => connectChild(doc, g, kid, baby, u), /already has parents/);
  assertThrows(() => connectParent(doc, g, dad, kid), /Already a parent/);
  assertThrows(() => connectParent(doc, g, addPerson(doc, g), kid), /already has two parents/);
  assertEqual(validate(doc), []);
});

test('connectParent fills a parent union, or starts one', () => {
  const { doc, g } = smallFamily();
  const graph = doc.graphs[g];
  const [child, p1, p2] = [addPerson(doc, g), addPerson(doc, g), addPerson(doc, g)];
  const u = connectChild(doc, g, p1, child, null); // "child of p1 alone"
  assertEqual(graph.nodes[u].attrs.kind, 'single');
  assertThrows(() => connectParent(doc, g, p1, child), /Already a parent/);
  assertEqual(connectParent(doc, g, p2, child), u, 'joins the union with room');
  assertEqual(partnersOfUnion(graph, u).sort(), [p1, p2].sort());
  assertEqual(graph.nodes[u].attrs.kind, 'married');
  assertEqual(validate(doc), []);
});

test('connectRelated draws a labelled link outside the family lines', () => {
  const { doc, g, mum, kid } = smallFamily();
  const id = connectRelated(doc, g, mum, kid, 'godparent');
  const edge = doc.graphs[g].edges.find((e) => e.id === id);
  assertEqual([edge.type, edge.from, edge.to, edge.attrs], ['custom', mum, kid, { label: 'godparent' }]);
  assertEqual(validate(doc), []);
});
