import { test, assert, assertEqual, assertThrows } from './harness.js';
import {
  addGraph, addPerson, addGroup, addGroupMember, removeGroupMember, removeNode, addLink, updateNodeAttrs,
} from '../src/store/model.js';
import { groupsOf, linksOf, sameAsIdentity, graphsContaining, copyPersonTo } from '../src/store/family.js';
import { validate } from '../src/store/validate.js';
import { smallFamily } from './fixtures.js';

test('group membership: no duplicates; a group left empty is removed', () => {
  const { doc, g, mum, dad, kid } = smallFamily();
  const group = addGroup(doc, g, [mum, mum]);
  assertEqual(doc.graphs[g].nodes[group].attrs.members, [mum]);
  addGroupMember(doc, g, group, dad);
  addGroupMember(doc, g, group, dad);
  assertEqual(groupsOf(doc.graphs[g], dad), [group]);
  assertEqual(doc.graphs[g].nodes[group].attrs.members, [mum, dad]);
  removeGroupMember(doc, g, group, mum);
  assert(doc.graphs[g].nodes[group], 'still has a member');
  removeGroupMember(doc, g, group, dad);
  assert(!doc.graphs[g].nodes[group], 'empty group removed');

  const other = addGroup(doc, g, [kid]);
  removeNode(doc, g, kid);
  assert(!doc.graphs[g].nodes[other], 'deleting the last member removes the group');
  assertThrows(() => addGroupMember(doc, g, mum, dad), /expected group/);
  assertEqual(validate(doc), []);
});

test('links must join two graphs and cannot be duplicated', () => {
  const { doc, g, mum, dad } = smallFamily();
  const other = addGraph(doc);
  const p = addPerson(doc, other);
  assertThrows(() => addLink(doc, { type: 'custom', from: `${g}:${mum}`, to: `${g}:${dad}` }), /two different graphs/);
  addLink(doc, { type: 'same-as', from: `${g}:${mum}`, to: `${other}:${p}` });
  assertThrows(() => addLink(doc, { type: 'same-as', from: `${other}:${p}`, to: `${g}:${mum}` }), /already linked/);
  addLink(doc, { type: 'custom', from: `${g}:${mum}`, to: `${other}:${p}` }); // different type is fine
  doc.links.push({ id: 'l-bad', type: 'custom', from: `${g}:${mum}`, to: `${g}:${dad}`, attrs: {} });
  assertEqual(validate(doc).map((e) => e.code), ['link-same-graph']);
});

test('same-as identity is transitive and tells which graphs a person is in', () => {
  const { doc, g, mum } = smallFamily();
  const a = addGraph(doc);
  const b = addGraph(doc);
  const pa = addPerson(doc, a);
  const pb = addPerson(doc, b);
  addLink(doc, { type: 'same-as', from: `${g}:${mum}`, to: `${a}:${pa}` });
  addLink(doc, { type: 'same-as', from: `${a}:${pa}`, to: `${b}:${pb}` });
  addLink(doc, { type: 'custom', from: `${g}:${mum}`, to: `${b}:${addPerson(doc, b)}` });
  assertEqual([...sameAsIdentity(doc, b, pb)].sort(), [`${g}:${mum}`, `${a}:${pa}`, `${b}:${pb}`].sort());
  assertEqual([...graphsContaining(doc, g, mum)].sort(), [g, a, b].sort());
  assertEqual(linksOf(doc, g, mum).map(({ link, other }) => [link.type, other.graphId]), [['same-as', a], ['custom', b]]);
});

test('copyPersonTo copies details (not layout) and links the copy', () => {
  const { doc, g, mum, union } = smallFamily();
  updateNodeAttrs(doc, g, mum, { sex: 'F', birth: { date: '1950' }, nudge: { dx: 5, dy: 5 } });
  const other = addGraph(doc);
  const copy = copyPersonTo(doc, g, mum, other);
  assertEqual(doc.graphs[other].nodes[copy].attrs, { name: { given: 'Ann' }, sex: 'F', birth: { date: '1950' } });
  assertEqual(doc.links.map((l) => [l.type, l.from, l.to]), [['same-as', `${g}:${mum}`, `${other}:${copy}`]]);
  doc.graphs[other].nodes[copy].attrs.birth.date = 'changed';
  assertEqual(doc.graphs[g].nodes[mum].attrs.birth.date, '1950', 'deep copy');
  assertThrows(() => copyPersonTo(doc, g, mum, other), /already in that graph/);
  assertThrows(() => copyPersonTo(doc, other, copy, g), /already in that graph/);
  assertThrows(() => copyPersonTo(doc, g, union, other), /Only people/);
  assertEqual(validate(doc), []);
});
