import { test, assert, assertEqual } from './harness.js';
import { layoutGraph, resolveRow, LAYOUT_DEFAULTS } from '../src/layout/layout.js';
import { addPerson, addUnion, addChild, addGraph, addGraphRef, addGroup, updateNodeAttrs } from '../src/store/model.js';
import { smallFamily } from './fixtures.js';

const near = (a, b, eps = 0.5) => Math.abs(a - b) <= eps;
const rowHeight = LAYOUT_DEFAULTS.cardHeight + LAYOUT_DEFAULTS.rankGap;

// No two cards in the same row may overlap.
function assertNoOverlap(layout) {
  const rows = new Map();
  for (const [id, n] of Object.entries(layout.nodes)) {
    if (n.kind !== 'card') continue;
    if (!rows.has(n.y)) rows.set(n.y, []);
    rows.get(n.y).push({ id, x0: n.x - n.width / 2, x1: n.x + n.width / 2 });
  }
  for (const row of rows.values()) {
    row.sort((a, b) => a.x0 - b.x0);
    for (let i = 1; i < row.length; i++) {
      assert(row[i].x0 >= row[i - 1].x1 - 0.01, `${row[i - 1].id} overlaps ${row[i].id}`);
    }
  }
}

// Four generations: every couple has three children, every child marries an outsider.
function bigFamily() {
  const { doc, g, union } = smallFamily();
  let unions = [union];
  for (let gen = 0; gen < 3; gen++) {
    const next = [];
    for (const u of unions) {
      for (let i = 0; i < 3; i++) {
        const kid = addPerson(doc, g);
        addChild(doc, g, u, kid);
        if (gen < 2) next.push(addUnion(doc, g, [kid, addPerson(doc, g)]));
      }
    }
    unions = next;
  }
  return { doc, g };
}

test('empty graph lays out to nothing', () => {
  const g = { nodes: {}, edges: [] };
  assertEqual(layoutGraph(g).nodes, {});
  assertEqual(layoutGraph(g).bounds, { x: 0, y: 0, width: 0, height: 0 });
});

test('partners share a row with the union between them; child below, centred', () => {
  const { doc, g, mum, dad, union, kid } = smallFamily();
  const { nodes } = layoutGraph(doc.graphs[g]);
  assertEqual([nodes[mum].y, nodes[dad].y, nodes[union].y], [0, 0, 0]);
  const [left, right] = [nodes[mum], nodes[dad]].sort((a, b) => a.x - b.x);
  assert(left.x < nodes[union].x && nodes[union].x < right.x, 'union between partners');
  assertEqual(nodes[kid].y, rowHeight);
  assert(near(nodes[kid].x, nodes[union].x), 'only child centred under union');
});

test('siblings are centred as a group under their parents', () => {
  const { doc, g, union, kid } = smallFamily();
  const kids = [kid, addPerson(doc, g), addPerson(doc, g)];
  kids.slice(1).forEach((k) => addChild(doc, g, union, k));
  const layout = layoutGraph(doc.graphs[g]);
  const xs = kids.map((k) => layout.nodes[k].x);
  assert(near((Math.min(...xs) + Math.max(...xs)) / 2, layout.nodes[union].x));
  assertNoOverlap(layout);
});

test('in-laws without parents share their partner\'s generation', () => {
  const { doc, g, kid } = smallFamily();
  const spouse = addPerson(doc, g);
  const u = addUnion(doc, g, [kid, spouse]);
  const grandkid = addPerson(doc, g);
  addChild(doc, g, u, grandkid);
  const { nodes } = layoutGraph(doc.graphs[g]);
  assertEqual(nodes[spouse].y, nodes[kid].y);
  assertEqual(nodes[grandkid].y, 2 * rowHeight);
});

test('a parentless single parent sits just above their child, not at the top', () => {
  const { doc, g, kid } = smallFamily();
  const grandkid = addPerson(doc, g);
  addChild(doc, g, addUnion(doc, g, [kid]), grandkid);
  const other = addPerson(doc, g);
  addChild(doc, g, addUnion(doc, g, [other]), grandkid);
  const { nodes } = layoutGraph(doc.graphs[g]);
  assertEqual(nodes[other].y, rowHeight);
});

test('someone with two partners sits between them', () => {
  const { doc, g, kid } = smallFamily();
  const p1 = addPerson(doc, g);
  const p2 = addPerson(doc, g);
  const u1 = addUnion(doc, g, [kid, p1]);
  const u2 = addUnion(doc, g, [kid, p2]);
  const { nodes } = layoutGraph(doc.graphs[g]);
  const order = [p1, p2, kid, u1, u2].sort((a, b) => nodes[a].x - nodes[b].x);
  assertEqual(order[2], kid);
  assert([order[1], order[3]].every((id) => id === u1 || id === u2), 'unions flank the shared partner');
});

test('a large family has no overlapping cards and children below parents', () => {
  const { doc, g } = bigFamily();
  const graph = doc.graphs[g];
  const layout = layoutGraph(graph);
  assertNoOverlap(layout);
  for (const e of graph.edges) {
    if (e.type === 'child') assert(layout.nodes[e.to].y > layout.nodes[e.from].y, `${e.to} below its parents`);
  }
  assertEqual(Object.keys(layout.nodes).length, Object.values(graph.nodes).length);
});

test('pedigree collapse and odd generations still lay out', () => {
  const { doc, g, union, kid } = smallFamily();
  const kid2 = addPerson(doc, g);
  addChild(doc, g, union, kid2);
  const c1 = addPerson(doc, g);
  const c2 = addPerson(doc, g);
  addChild(doc, g, addUnion(doc, g, [kid]), c1);
  addChild(doc, g, addUnion(doc, g, [kid2]), c2);
  const gc = addPerson(doc, g);
  addChild(doc, g, addUnion(doc, g, [c1, c2]), gc);
  // Valid but awkward: someone partners with their own grandchild's generation.
  addUnion(doc, g, [kid, gc]);
  const layout = layoutGraph(doc.graphs[g]);
  assertNoOverlap(layout);
  assert(Object.values(layout.nodes).every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
});

test('nudges offset nodes from their automatic position; unions follow', () => {
  const { doc, g, mum, dad, union, kid } = smallFamily();
  const auto = layoutGraph(doc.graphs[g]).nodes;
  updateNodeAttrs(doc, g, mum, { nudge: { dx: 0, dy: -100 } });
  updateNodeAttrs(doc, g, dad, { nudge: { dx: 0, dy: -100 } });
  const { nodes } = layoutGraph(doc.graphs[g]);
  assertEqual([nodes[mum].x, nodes[mum].y, nodes[mum].nudged], [auto[mum].x, auto[mum].y - 100, true]);
  assertEqual([nodes[union].x, nodes[union].y], [auto[union].x, auto[union].y - 100]);
  assertEqual([nodes[kid].x, nodes[kid].y], [auto[kid].x, auto[kid].y], 'others stay put');
});

test('nudged cards travel with the family when the layout shifts', () => {
  const { doc, g, kid, union } = smallFamily();
  updateNodeAttrs(doc, g, kid, { nudge: { dx: 30, dy: 0 } });
  const before = layoutGraph(doc.graphs[g]).nodes;
  const sibling = addPerson(doc, g);
  addChild(doc, g, union, sibling);
  const after = layoutGraph(doc.graphs[g]).nodes;
  const offset = (nodes) => nodes[kid].x - nodes[union].x;
  assert(Math.abs(offset(after) - offset(before)) < 200, 'stays near its parents');
});

test('drag preview offsets add to stored nudges without changing the document', () => {
  const { doc, g, kid } = smallFamily();
  updateNodeAttrs(doc, g, kid, { nudge: { dx: 10, dy: 0 } });
  const base = layoutGraph(doc.graphs[g]).nodes[kid];
  const moved = layoutGraph(doc.graphs[g], { preview: { [kid]: { dx: 5, dy: 7 } } }).nodes[kid];
  assertEqual([moved.x - base.x, moved.y - base.y], [5, 7]);
  assertEqual(doc.graphs[g].nodes[kid].attrs.nudge, { dx: 10, dy: 0 });
});

test('graphRefs and loose persons are placed; groups are not', () => {
  const { doc, g, mum } = smallFamily();
  const other = addGraph(doc);
  const ref = addGraphRef(doc, g, other);
  const loner = addPerson(doc, g);
  const group = addGroup(doc, g, [mum]);
  const layout = layoutGraph(doc.graphs[g]);
  assertEqual(layout.nodes[ref].y, 0);
  assertEqual(layout.nodes[ref].kind, 'card');
  assertEqual(layout.nodes[loner].y, 0);
  assert(!layout.nodes[group]);
  assertNoOverlap(layout);
});

test('layout is deterministic and ignores invalid edges', () => {
  const { doc, g } = bigFamily();
  const graph = doc.graphs[g];
  const mum = Object.keys(graph.nodes)[0];
  assertEqual(layoutGraph(graph), layoutGraph(graph));
  graph.edges.push({ id: 'e-bad', type: 'child', from: mum, to: 'p-ghost', attrs: {} });
  assert(layoutGraph(graph).nodes[mum]);
});

test('resolveRow keeps wishes when free and merges overlapping blocks', () => {
  const blocks = [{ width: 100 }, { width: 100 }, { width: 100 }];
  resolveRow(blocks, [0, 500, 1000], 20);
  assertEqual(blocks.map((b) => b.left), [0, 500, 1000]);
  resolveRow(blocks, [0, 0, 1000], 20);
  assertEqual(blocks.map((b) => b.left), [-60, 60, 1000]);
});
