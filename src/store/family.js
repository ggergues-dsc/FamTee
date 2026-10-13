// Family-level editing operations built on the model helpers. These are what the
// editing UI calls (inside Store.apply), so it never manipulates unions directly.

import { getGraph, getNode, addPerson, addUnion, addChild, addEdge, removeNode } from './model.js';

// --- queries --------------------------------------------------------------

export function partnersOfUnion(graph, unionId) {
  return graph.edges.filter((e) => e.type === 'partner' && e.to === unionId).map((e) => e.from);
}

export function childrenOfUnion(graph, unionId) {
  return graph.edges.filter((e) => e.type === 'child' && e.from === unionId).map((e) => e.to);
}

// Unions the person is a partner in, each with the other partners and the children.
export function unionsOfPerson(graph, personId) {
  return graph.edges
    .filter((e) => e.type === 'partner' && e.from === personId)
    .map((e) => ({
      unionId: e.to,
      partners: partnersOfUnion(graph, e.to).filter((p) => p !== personId),
      children: childrenOfUnion(graph, e.to),
    }));
}

// Unions the person is a child of.
export function parentUnionsOf(graph, personId) {
  return graph.edges.filter((e) => e.type === 'child' && e.to === personId).map((e) => e.from);
}

// --- edits ----------------------------------------------------------------

// Adds a new person as a partner of `personId`. Returns { personId, unionId }.
export function addPartnerTo(doc, graphId, personId, attrs = {}) {
  getNode(doc, graphId, personId);
  const partnerId = addPerson(doc, graphId, attrs);
  const unionId = addUnion(doc, graphId, [personId, partnerId], { kind: 'married' });
  return { personId: partnerId, unionId };
}

// Adds a new child of `personId`. `unionId` picks the partnership; null creates a
// single-parent union. Returns { personId, unionId }.
export function addChildTo(doc, graphId, personId, unionId = null, attrs = {}) {
  const graph = getGraph(doc, graphId);
  getNode(doc, graphId, personId);
  let union = unionId;
  if (union === null) {
    union = addUnion(doc, graphId, [personId], { kind: 'single' });
  } else if (!partnersOfUnion(graph, union).includes(personId)) {
    throw new Error(`${personId} is not a partner in ${union}`);
  }
  const childId = addPerson(doc, graphId, attrs);
  addChild(doc, graphId, union, childId);
  return { personId: childId, unionId: union };
}

// Adds a new parent of `childId`: joins the existing parent union when it has room
// for a second partner, otherwise creates one. Returns { personId, unionId }.
export function addParentTo(doc, graphId, childId, attrs = {}) {
  const graph = getGraph(doc, graphId);
  getNode(doc, graphId, childId);
  const existing = parentUnionsOf(graph, childId).find((u) => partnersOfUnion(graph, u).length < 2);
  if (!existing && parentUnionsOf(graph, childId).length) {
    throw new Error('This person already has two parents');
  }
  const parentId = addPerson(doc, graphId, attrs);
  if (existing) {
    addEdge(doc, graphId, { type: 'partner', from: parentId, to: existing });
    const union = getNode(doc, graphId, existing);
    if (union.attrs.kind === 'single') union.attrs.kind = 'married';
    return { personId: parentId, unionId: existing };
  }
  const unionId = addUnion(doc, graphId, [parentId]);
  addChild(doc, graphId, unionId, childId);
  return { personId: parentId, unionId };
}

// Removes a person, then any union left with no children and at most one partner.
export function removePerson(doc, graphId, personId) {
  const graph = getGraph(doc, graphId);
  const unions = [...unionsOfPerson(graph, personId).map((u) => u.unionId), ...parentUnionsOf(graph, personId)];
  removeNode(doc, graphId, personId);
  for (const u of new Set(unions)) {
    if (graph.nodes[u] && !childrenOfUnion(graph, u).length && partnersOfUnion(graph, u).length <= 1) {
      removeNode(doc, graphId, u);
    }
  }
}

// Replaces the whole document in place (used by import, so it is undoable).
export function replaceDocument(doc, next) {
  for (const key of Object.keys(doc)) delete doc[key];
  Object.assign(doc, structuredClone(next));
}
