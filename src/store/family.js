// Family-level editing operations built on the model helpers. These are what the
// editing UI calls (inside Store.apply), so it never manipulates unions directly.

import { getGraph, getNode, addPerson, addPet, addUnion, addChild, addEdge, addLink, removeNode } from './model.js';
import { endpoint, parseEndpoint } from './schema.js';

// --- queries --------------------------------------------------------------

export function partnersOfUnion(graph, unionId) {
  return graph.edges.filter((e) => e.type === 'partner' && e.to === unionId).map((e) => e.from);
}

export function childrenOfUnion(graph, unionId) {
  return graph.edges.filter((e) => e.type === 'child' && e.from === unionId).map((e) => e.to);
}

export function petsOfUnion(graph, unionId) {
  return graph.edges.filter((e) => e.type === 'pet' && e.from === unionId).map((e) => e.to);
}

// The partnerships a pet belongs to, and their partners (its owners).
export function ownersOfPet(graph, petId) {
  return graph.edges.filter((e) => e.type === 'pet' && e.to === petId).flatMap((e) => partnersOfUnion(graph, e.from));
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

// Groups in the graph that contain the node.
export function groupsOf(graph, nodeId) {
  return Object.entries(graph.nodes)
    .filter(([, n]) => n.type === 'group' && n.attrs.members?.includes(nodeId))
    .map(([id]) => id);
}

// --- cross-graph links ------------------------------------------------------

// Links touching graphId:nodeId, each with the endpoint on the other side.
export function linksOf(doc, graphId, nodeId) {
  const self = endpoint(graphId, nodeId);
  return doc.links
    .filter((l) => l.from === self || l.to === self)
    .map((link) => ({ link, other: parseEndpoint(link.from === self ? link.to : link.from) }));
}

// Every "graphId:nodeId" that is the same person as the given one (same-as links are
// transitive), including itself.
export function sameAsIdentity(doc, graphId, nodeId) {
  const seen = new Set([endpoint(graphId, nodeId)]);
  const queue = [...seen];
  while (queue.length) {
    const current = queue.pop();
    for (const l of doc.links) {
      if (l.type !== 'same-as') continue;
      const next = l.from === current ? l.to : l.to === current ? l.from : null;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

// Graphs where this person already appears (directly or through same-as links).
export function graphsContaining(doc, graphId, nodeId) {
  return new Set([...sameAsIdentity(doc, graphId, nodeId)].map((e) => parseEndpoint(e).graphId));
}

// Places a copy of a person into another graph, linked to the original as the same
// person. Layout offsets are not copied. Returns the new person's id.
export function copyPersonTo(doc, graphId, personId, targetGraphId) {
  const person = getNode(doc, graphId, personId);
  if (person.type !== 'person') throw new Error('Only people can be copied to another graph');
  getGraph(doc, targetGraphId);
  if (graphsContaining(doc, graphId, personId).has(targetGraphId)) {
    throw new Error('This person is already in that graph');
  }
  const attrs = structuredClone(person.attrs);
  delete attrs.nudge;
  const copyId = addPerson(doc, targetGraphId, attrs);
  addLink(doc, { type: 'same-as', from: endpoint(graphId, personId), to: endpoint(targetGraphId, copyId) });
  return copyId;
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

// Adds a pet of `personId`: of the partnership `unionId`, or (null) of the person
// alone, through a single-owner union. Returns { petId, unionId }.
export function addPetTo(doc, graphId, personId, unionId = null, attrs = {}) {
  const graph = getGraph(doc, graphId);
  if (getNode(doc, graphId, personId).type !== 'person') throw new Error('Only people can have pets');
  let union = unionId;
  if (union === null) {
    // Reuse the person's own single-owner union (from an earlier pet or child alone).
    union = unionsOfPerson(graph, personId).find((u) => !u.partners.length && graph.nodes[u.unionId].attrs.kind === 'single')?.unionId
      ?? addUnion(doc, graphId, [personId], { kind: 'single' });
  } else if (!partnersOfUnion(graph, union).includes(personId)) {
    throw new Error(`${personId} is not a partner in ${union}`);
  }
  const petId = addPet(doc, graphId, attrs);
  addEdge(doc, graphId, { type: 'pet', from: union, to: petId });
  return { petId, unionId: union };
}

// Removes a pet, and the owner's single-owner union if nothing else uses it.
export function removePet(doc, graphId, petId) {
  const graph = getGraph(doc, graphId);
  if (getNode(doc, graphId, petId).type !== 'pet') throw new Error('Not a pet');
  const unions = graph.edges.filter((e) => e.type === 'pet' && e.to === petId).map((e) => e.from);
  removeNode(doc, graphId, petId);
  for (const u of unions) {
    if (graph.nodes[u] && !childrenOfUnion(graph, u).length && !petsOfUnion(graph, u).length && partnersOfUnion(graph, u).length <= 1) {
      removeNode(doc, graphId, u);
    }
  }
}

// Removes a person, then any union left with no children or pets and at most one partner.
export function removePerson(doc, graphId, personId) {
  const graph = getGraph(doc, graphId);
  const unions = [...unionsOfPerson(graph, personId).map((u) => u.unionId), ...parentUnionsOf(graph, personId)];
  removeNode(doc, graphId, personId);
  for (const u of new Set(unions)) {
    if (graph.nodes[u] && !childrenOfUnion(graph, u).length && !petsOfUnion(graph, u).length && partnersOfUnion(graph, u).length <= 1) {
      removeNode(doc, graphId, u);
    }
  }
}

// Replaces the whole document in place (used by import, so it is undoable).
export function replaceDocument(doc, next) {
  for (const key of Object.keys(doc)) delete doc[key];
  Object.assign(doc, structuredClone(next));
  doc.media ??= {}; // keep undo snapshots sharing one media object (ADR 0013)
}

// --- connecting people who are already in the graph ----------------------------
// Used when someone was added on their own and is connected later (drag from one
// card to another, then choose how they are related). Each returns the union or edge
// it used. Store.apply validates afterwards, so e.g. making someone their own
// ancestor is still rejected.

function expectTwoPeople(doc, graphId, a, b) {
  for (const id of [a, b]) {
    if (getNode(doc, graphId, id).type !== 'person') throw new Error('Only people can be connected');
  }
  if (a === b) throw new Error('A person can’t be connected to themselves');
}

export function arePartners(graph, a, b) {
  return unionsOfPerson(graph, a).some((u) => u.partners.includes(b));
}

// a and b become partners in a new union.
export function connectPartners(doc, graphId, a, b, attrs = { kind: 'married' }) {
  expectTwoPeople(doc, graphId, a, b);
  if (arePartners(getGraph(doc, graphId), a, b)) throw new Error('They are already partners');
  return addUnion(doc, graphId, [a, b], attrs);
}

// parentId becomes a parent of childId: joins the child's parent union when it has
// room for a second partner, otherwise starts a single-parent union.
export function connectParent(doc, graphId, parentId, childId) {
  expectTwoPeople(doc, graphId, parentId, childId);
  const graph = getGraph(doc, graphId);
  const unions = parentUnionsOf(graph, childId);
  if (unions.some((u) => partnersOfUnion(graph, u).includes(parentId))) throw new Error('Already a parent of this person');
  const existing = unions.find((u) => partnersOfUnion(graph, u).length < 2);
  if (!existing && unions.length) throw new Error('This person already has two parents');
  if (existing) {
    addEdge(doc, graphId, { type: 'partner', from: parentId, to: existing });
    const union = getNode(doc, graphId, existing);
    if (union.attrs.kind === 'single') union.attrs.kind = 'married';
    return existing;
  }
  const unionId = addUnion(doc, graphId, [parentId], { kind: 'single' });
  addChild(doc, graphId, unionId, childId);
  return unionId;
}

// childId becomes a child of parentId's partnership `unionId` (null: of parentId alone).
export function connectChild(doc, graphId, parentId, childId, unionId = null) {
  if (unionId === null) return connectParent(doc, graphId, parentId, childId);
  expectTwoPeople(doc, graphId, parentId, childId);
  const graph = getGraph(doc, graphId);
  if (!partnersOfUnion(graph, unionId).includes(parentId)) throw new Error(`${parentId} is not a partner in ${unionId}`);
  if (parentUnionsOf(graph, childId).length) throw new Error('This person already has parents');
  addChild(doc, graphId, unionId, childId);
  return unionId;
}

// siblingId joins personId's parents as their child.
export function connectSibling(doc, graphId, personId, siblingId) {
  expectTwoPeople(doc, graphId, personId, siblingId);
  const graph = getGraph(doc, graphId);
  const [unionId] = parentUnionsOf(graph, personId);
  if (!unionId) throw new Error('Add their parents first');
  if (parentUnionsOf(graph, siblingId).length) throw new Error('This person already has parents');
  addChild(doc, graphId, unionId, siblingId);
  return unionId;
}

// Any other relation ("godparent"): a labelled custom edge, outside the family lines.
export function connectRelated(doc, graphId, a, b, label = '') {
  expectTwoPeople(doc, graphId, a, b);
  return addEdge(doc, graphId, { type: 'custom', from: a, to: b, attrs: label ? { label } : {} });
}
