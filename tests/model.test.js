import { test, assert, assertEqual, assertThrows } from './harness.js';
import {
  createDocument, addGraph, removeGraph, addPerson, addUnion, addChild, addGroup, addGraphRef,
  updateNodeAttrs, removeNode, addEdge, removeEdge, addLink, removeLink,
} from '../src/store/model.js';
import { validate } from '../src/store/validate.js';
import { smallFamily } from './fixtures.js';

test('createDocument produces a valid empty document', () => {
  const doc = createDocument({ title: 'Mine' });
  assertEqual(doc.meta.title, 'Mine');
  assertEqual(Object.keys(doc.graphs), [doc.meta.rootGraph]);
  assertEqual(validate(doc), []);
});

test('family helpers build partner and child edges', () => {
  const { doc, g, mum, dad, union, kid } = smallFamily();
  const edges = doc.graphs[g].edges.map((e) => [e.type, e.from, e.to]);
  assertEqual(edges, [['partner', mum, union], ['partner', dad, union], ['child', union, kid]]);
  assertEqual(doc.graphs[g].edges[2].attrs.kind, 'biological');
  assertEqual(validate(doc), []);
});

test('helpers reject wrong node types and unknown ids', () => {
  const { doc, g, mum, union } = smallFamily();
  assertThrows(() => addUnion(doc, g, [union]), /expected person/);
  assertThrows(() => addChild(doc, g, mum, mum), /expected union/);
  assertThrows(() => addPerson(doc, 'g-nope'), /Unknown graph/);
  assertThrows(() => addEdge(doc, g, { type: 'sibling', from: mum, to: mum }), /Unknown edge type/);
});

test('updateNodeAttrs merges and deletes keys', () => {
  const { doc, g, mum } = smallFamily();
  updateNodeAttrs(doc, g, mum, { sex: 'F', name: undefined });
  assertEqual(doc.graphs[g].nodes[mum].attrs, { sex: 'F' });
});

test('removeNode drops incident edges, links and group membership', () => {
  const { doc, g, mum, dad, kid } = smallFamily();
  const other = addGraph(doc, { title: 'Other' });
  const twin = addPerson(doc, other);
  addLink(doc, { type: 'same-as', from: `${g}:${kid}`, to: `${other}:${twin}` });
  const group = addGroup(doc, g, [mum, kid]);
  removeNode(doc, g, kid);
  assertEqual(doc.graphs[g].edges.length, 2);
  assertEqual(doc.links, []);
  assertEqual(doc.graphs[g].nodes[group].attrs.members, [mum]);
  assert(doc.graphs[g].nodes[dad]);
  assertEqual(validate(doc), []);
});

test('removeGraph drops graphRefs and links that point to it', () => {
  const { doc, g, kid } = smallFamily();
  const other = addGraph(doc);
  const p = addPerson(doc, other);
  addGraphRef(doc, g, other, { label: 'Other' });
  addLink(doc, { type: 'custom', from: `${g}:${kid}`, to: `${other}:${p}` });
  removeGraph(doc, other);
  assert(!doc.graphs[other]);
  assert(Object.values(doc.graphs[g].nodes).every((n) => n.type !== 'graphRef'));
  assertEqual(doc.links, []);
  assertThrows(() => removeGraph(doc, g), /root graph/);
});

test('edges and links can be removed by id', () => {
  const { doc, g, mum, kid } = smallFamily();
  const edge = addEdge(doc, g, { type: 'custom', from: mum, to: kid, attrs: { label: 'godparent' } });
  removeEdge(doc, g, edge);
  assertThrows(() => removeEdge(doc, g, edge), /Unknown edge/);
  const other = addGraph(doc);
  const p = addPerson(doc, other);
  const link = addLink(doc, { type: 'custom', from: `${g}:${mum}`, to: `${other}:${p}` });
  removeLink(doc, link);
  assertEqual(doc.links, []);
  assertThrows(() => addLink(doc, { type: 'custom', from: 'nocolon', to: `${other}:${p}` }), /Bad link endpoint/);
});
