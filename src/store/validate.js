// Document integrity checks (docs/data-model.md, "Integrity rules").
// Returns a list of problems; an empty list means the document is valid.

import { FORMAT, NODE_TYPES, EDGE_TYPES, LINK_TYPES, endpoint, parseEndpoint } from './schema.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validate(doc) {
  const errors = [];
  const fail = (code, message) => errors.push({ code, message });

  if (!isObject(doc)) return [{ code: 'not-object', message: 'Document is not an object' }];
  if (doc.format !== FORMAT) fail('format', `format must be "${FORMAT}"`);
  if (!Number.isInteger(doc.schemaVersion)) fail('schema-version', 'schemaVersion must be an integer');
  if (!isObject(doc.meta)) fail('meta', 'meta must be an object');
  if (!isObject(doc.graphs)) return [...errors, { code: 'graphs', message: 'graphs must be an object' }];
  if (!Array.isArray(doc.links)) fail('links', 'links must be an array');
  if (isObject(doc.meta) && !doc.graphs[doc.meta.rootGraph]) {
    fail('root-graph', `meta.rootGraph "${doc.meta?.rootGraph}" is not a graph`);
  }

  const seen = new Set();
  const unique = (id, where) => {
    if (typeof id !== 'string' || id === '') fail('id', `${where}: id must be a non-empty string`);
    else if (seen.has(id)) fail('duplicate-id', `${where}: duplicate id "${id}"`);
    else seen.add(id);
  };

  for (const [graphId, graph] of Object.entries(doc.graphs)) {
    unique(graphId, 'graph');
    if (graphId.includes(':')) fail('graph-id', `graph "${graphId}": id must not contain ":"`);
    if (!isObject(graph) || !isObject(graph.nodes) || !Array.isArray(graph.edges)) {
      fail('graph-shape', `graph "${graphId}" must have a nodes object and an edges array`);
      continue;
    }

    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      const where = `${graphId}:${nodeId}`;
      unique(nodeId, `node ${where}`);
      if (!isObject(node) || !NODE_TYPES.includes(node.type)) {
        fail('node-type', `node ${where}: type must be one of ${NODE_TYPES.join(', ')}`);
        continue;
      }
      if (!isObject(node.attrs)) {
        fail('node-attrs', `node ${where}: attrs must be an object`);
        continue;
      }
      if (node.type === 'graphRef' && !doc.graphs[node.attrs.graph]) {
        fail('graph-ref', `node ${where}: refers to unknown graph "${node.attrs.graph}"`);
      }
      if (node.type === 'group') {
        const members = node.attrs.members;
        if (!Array.isArray(members)) fail('group-members', `node ${where}: members must be an array`);
        else for (const m of members) {
          if (!graph.nodes[m]) fail('group-members', `node ${where}: unknown member "${m}"`);
        }
      }
    }

    for (const edge of graph.edges) {
      const where = `edge ${graphId}/${edge?.id}`;
      if (!isObject(edge)) { fail('edge-shape', `${where}: must be an object`); continue; }
      unique(edge.id, where);
      if (!EDGE_TYPES.includes(edge.type)) fail('edge-type', `${where}: unknown type "${edge.type}"`);
      const from = graph.nodes[edge.from];
      const to = graph.nodes[edge.to];
      if (!from || !to) { fail('dangling-edge', `${where}: endpoint missing`); continue; }
      if (edge.type === 'partner' && (from.type !== 'person' || to.type !== 'union')) {
        fail('edge-endpoints', `${where}: partner edges go person → union`);
      }
      if (edge.type === 'child' && (from.type !== 'union' || to.type !== 'person')) {
        fail('edge-endpoints', `${where}: child edges go union → person`);
      }
    }
  }

  for (const link of Array.isArray(doc.links) ? doc.links : []) {
    const where = `link ${link?.id}`;
    if (!isObject(link)) { fail('link-shape', `${where}: must be an object`); continue; }
    unique(link.id, where);
    if (!LINK_TYPES.includes(link.type)) fail('link-type', `${where}: unknown type "${link.type}"`);
    const nodes = [link.from, link.to].map((value) => {
      const ep = parseEndpoint(value);
      const node = ep && doc.graphs[ep.graphId]?.nodes?.[ep.nodeId];
      if (!node) fail('dangling-link', `${where}: endpoint "${value}" not found`);
      return node;
    });
    const [a, b] = [parseEndpoint(link.from), parseEndpoint(link.to)];
    if (a && b && a.graphId === b.graphId) fail('link-same-graph', `${where}: links must join two different graphs`);
    if (link.type === 'same-as' && nodes.every(Boolean) && nodes.some((n) => n.type !== 'person')) {
      fail('same-as', `${where}: same-as links must join two persons`);
    }
  }

  if (errors.length === 0) {
    checkAncestryCycles(doc, fail);
    checkGraphRefCycles(doc, fail);
  }
  return errors;
}

// Nobody may be their own ancestor. Persons joined by same-as links are one identity.
function checkAncestryCycles(doc, fail) {
  const parent = new Map();
  const find = (k) => {
    while (parent.has(k) && parent.get(k) !== k) k = parent.get(k);
    return k;
  };
  for (const link of doc.links) {
    if (link.type === 'same-as') {
      const a = find(link.from);
      const b = find(link.to);
      if (a !== b) parent.set(a, b);
    }
  }

  const children = new Map(); // identity → Set of child identities
  for (const [graphId, graph] of Object.entries(doc.graphs)) {
    const partners = new Map();
    const kids = new Map();
    for (const e of graph.edges) {
      const bucket = e.type === 'partner' ? partners : e.type === 'child' ? kids : null;
      if (!bucket) continue;
      const unionId = e.type === 'partner' ? e.to : e.from;
      const personId = e.type === 'partner' ? e.from : e.to;
      if (!bucket.has(unionId)) bucket.set(unionId, []);
      bucket.get(unionId).push(find(endpoint(graphId, personId)));
    }
    for (const [unionId, ps] of partners) {
      for (const p of ps) {
        if (!children.has(p)) children.set(p, new Set());
        for (const c of kids.get(unionId) ?? []) children.get(p).add(c);
      }
    }
  }

  const cycle = findCycle(children);
  if (cycle) fail('ancestry-cycle', `ancestry cycle: ${cycle.join(' → ')}`);
}

function checkGraphRefCycles(doc, fail) {
  const refs = new Map();
  for (const [graphId, graph] of Object.entries(doc.graphs)) {
    const targets = new Set();
    for (const node of Object.values(graph.nodes)) {
      if (node.type === 'graphRef') targets.add(node.attrs.graph);
    }
    refs.set(graphId, targets);
  }
  const cycle = findCycle(refs);
  if (cycle) fail('graph-ref-cycle', `graph reference cycle: ${cycle.join(' → ')}`);
}

// Depth-first search over Map<key, Iterable<key>>; returns the first cycle as a path, or null.
function findCycle(adjacency) {
  const state = new Map(); // undefined = unvisited, 1 = on stack, 2 = done
  const stack = [];
  const visit = (k) => {
    state.set(k, 1);
    stack.push(k);
    for (const next of adjacency.get(k) ?? []) {
      if (state.get(next) === 1) return [...stack.slice(stack.indexOf(next)), next];
      if (!state.get(next)) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(k, 2);
    return null;
  };
  for (const k of adjacency.keys()) {
    if (!state.get(k)) {
      const found = visit(k);
      if (found) return found;
    }
  }
  return null;
}
