// Mutation helpers for a FamTee document. They mutate `doc` in place and throw
// on precondition failures; Store wraps them with undo and validation.

import { newId, ulid } from './ids.js';
import { FORMAT, CURRENT_SCHEMA_VERSION, EDGE_TYPES, LINK_TYPES, endpoint, parseEndpoint } from './schema.js';

export function createDocument({ title = 'Untitled family', graphTitle = 'Main' } = {}) {
  const now = new Date().toISOString();
  const rootId = newId('graph');
  return {
    format: FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: {
      id: ulid(),
      title,
      created: now,
      modified: now,
      rootGraph: rootId,
      theme: 'default',
      overlay: { layers: [] },
    },
    graphs: { [rootId]: emptyGraph(graphTitle) },
    links: [],
  };
}

function emptyGraph(title) {
  return { title, nodes: {}, edges: [] };
}

export function getGraph(doc, graphId) {
  const graph = doc.graphs[graphId];
  if (!graph) throw new Error(`Unknown graph: ${graphId}`);
  return graph;
}

export function getNode(doc, graphId, nodeId) {
  const node = getGraph(doc, graphId).nodes[nodeId];
  if (!node) throw new Error(`Unknown node: ${graphId}:${nodeId}`);
  return node;
}

function expectType(doc, graphId, nodeId, type) {
  const node = getNode(doc, graphId, nodeId);
  if (node.type !== type) throw new Error(`${nodeId} is a ${node.type}, expected ${type}`);
  return node;
}

// --- graphs ---------------------------------------------------------------

export function addGraph(doc, { title = 'Untitled graph' } = {}) {
  const id = newId('graph');
  doc.graphs[id] = emptyGraph(title);
  return id;
}

export function removeGraph(doc, graphId) {
  getGraph(doc, graphId);
  if (doc.meta.rootGraph === graphId) throw new Error('Cannot remove the root graph');
  delete doc.graphs[graphId];
  for (const [gid, graph] of Object.entries(doc.graphs)) {
    for (const [nid, node] of Object.entries(graph.nodes)) {
      if (node.type === 'graphRef' && node.attrs.graph === graphId) removeNode(doc, gid, nid);
    }
  }
  doc.links = doc.links.filter(
    (l) => parseEndpoint(l.from).graphId !== graphId && parseEndpoint(l.to).graphId !== graphId,
  );
}

// --- nodes ----------------------------------------------------------------

function addNode(doc, graphId, type, attrs) {
  const graph = getGraph(doc, graphId);
  const id = newId(type);
  graph.nodes[id] = { type, attrs: { ...attrs } };
  return id;
}

export function addPerson(doc, graphId, attrs = {}) {
  return addNode(doc, graphId, 'person', attrs);
}

// Creates a union between the given partners (zero, one or more) and returns its id.
export function addUnion(doc, graphId, partnerIds = [], attrs = {}) {
  for (const pid of partnerIds) expectType(doc, graphId, pid, 'person');
  const unionId = addNode(doc, graphId, 'union', attrs);
  for (const pid of partnerIds) addEdge(doc, graphId, { type: 'partner', from: pid, to: unionId });
  return unionId;
}

export function addChild(doc, graphId, unionId, childId, kind = 'biological') {
  expectType(doc, graphId, unionId, 'union');
  expectType(doc, graphId, childId, 'person');
  return addEdge(doc, graphId, { type: 'child', from: unionId, to: childId, attrs: { kind } });
}

export function addGroup(doc, graphId, memberIds = [], attrs = {}) {
  for (const mid of memberIds) getNode(doc, graphId, mid);
  return addNode(doc, graphId, 'group', { ...attrs, members: [...memberIds] });
}

export function addGraphRef(doc, graphId, targetGraphId, attrs = {}) {
  getGraph(doc, targetGraphId);
  return addNode(doc, graphId, 'graphRef', { ...attrs, graph: targetGraphId });
}

// Shallow-merges `patch` into node attrs; a value of `undefined` deletes the key.
export function updateNodeAttrs(doc, graphId, nodeId, patch) {
  const node = getNode(doc, graphId, nodeId);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete node.attrs[key];
    else node.attrs[key] = value;
  }
}

// Removes a node with its incident edges, cross-graph links and group memberships.
export function removeNode(doc, graphId, nodeId) {
  const graph = getGraph(doc, graphId);
  getNode(doc, graphId, nodeId);
  delete graph.nodes[nodeId];
  graph.edges = graph.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
  for (const node of Object.values(graph.nodes)) {
    if (node.type === 'group') node.attrs.members = node.attrs.members.filter((m) => m !== nodeId);
  }
  const key = endpoint(graphId, nodeId);
  doc.links = doc.links.filter((l) => l.from !== key && l.to !== key);
}

// --- edges ----------------------------------------------------------------

export function addEdge(doc, graphId, { type, from, to, attrs = {} }) {
  if (!EDGE_TYPES.includes(type)) throw new Error(`Unknown edge type: ${type}`);
  const graph = getGraph(doc, graphId);
  getNode(doc, graphId, from);
  getNode(doc, graphId, to);
  const id = newId('edge');
  graph.edges.push({ id, type, from, to, attrs: { ...attrs } });
  return id;
}

export function removeEdge(doc, graphId, edgeId) {
  const graph = getGraph(doc, graphId);
  const before = graph.edges.length;
  graph.edges = graph.edges.filter((e) => e.id !== edgeId);
  if (graph.edges.length === before) throw new Error(`Unknown edge: ${edgeId}`);
}

// --- cross-graph links ----------------------------------------------------

export function addLink(doc, { type, from, to, attrs = {} }) {
  if (!LINK_TYPES.includes(type)) throw new Error(`Unknown link type: ${type}`);
  for (const value of [from, to]) {
    const ep = parseEndpoint(value);
    if (!ep) throw new Error(`Bad link endpoint: ${value}`);
    getNode(doc, ep.graphId, ep.nodeId);
  }
  const id = newId('link');
  doc.links.push({ id, type, from, to, attrs: { ...attrs } });
  return id;
}

export function removeLink(doc, linkId) {
  const before = doc.links.length;
  doc.links = doc.links.filter((l) => l.id !== linkId);
  if (doc.links.length === before) throw new Error(`Unknown link: ${linkId}`);
}
