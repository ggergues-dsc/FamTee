import { test, assert, assertEqual } from './harness.js';
import { layoutGraph, LAYOUT_DEFAULTS } from '../src/layout/layout.js';
import { createRenderer } from '../src/render/renderer.js';
import { addPerson, addUnion, addChild, updateNodeAttrs } from '../src/store/model.js';
import { validate } from '../src/store/validate.js';
import { smallFamily } from './fixtures.js';

const near = (a, b, eps = 0.5) => Math.abs(a - b) <= eps;

// No two cards overlap (with the layout gap) anywhere: checks every pair.
function assertNoCardOverlap(nodes, except = new Set()) {
  const cards = Object.entries(nodes).filter(([id, n]) => n.kind === 'card' && !except.has(id));
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const [ia, a] = cards[i];
      const [ib, b] = cards[j];
      const overlapX = Math.abs(a.x - b.x) < (a.width + b.width) / 2;
      const overlapY = Math.abs(a.y - b.y) < (a.height + b.height) / 2;
      assert(!(overlapX && overlapY), `${ia} overlaps ${ib}`);
    }
  }
}

function threeKids() {
  const { doc, g, union, kid } = smallFamily();
  const kids = [kid, addPerson(doc, g), addPerson(doc, g)];
  kids.slice(1).forEach((k) => addChild(doc, g, union, k));
  return { doc, g, union, kids };
}

test('left to right: generations along x, partners stacked, children to the right', () => {
  const { doc, g, mum, dad, union, kid } = smallFamily();
  const { nodes, options } = layoutGraph(doc.graphs[g], { orientation: 'LR' });
  assertEqual(options.orientation, 'LR');
  assertEqual([nodes[mum].x, nodes[dad].x, nodes[union].x], [0, 0, 0], 'same generation, same column');
  const [top, bottom] = [nodes[mum], nodes[dad]].sort((a, b) => a.y - b.y);
  assert(top.y < nodes[union].y && nodes[union].y < bottom.y, 'dot between stacked partners');
  assert(nodes[kid].x > nodes[mum].x + LAYOUT_DEFAULTS.cardWidth, 'child in the next column');
  assert(near(nodes[kid].y, nodes[union].y), 'only child level with the dot');
  assertEqual([nodes[mum].width, nodes[mum].height], [LAYOUT_DEFAULTS.cardWidth, LAYOUT_DEFAULTS.cardHeight], 'cards keep their shape');
  assertNoCardOverlap(nodes);
  const three = threeKids();
  assertNoCardOverlap(layoutGraph(three.doc.graphs[three.g], { orientation: 'LR' }).nodes);
});

test('unknown orientations fall back to top-down', () => {
  const { doc, g } = smallFamily();
  assertEqual(layoutGraph(doc.graphs[g], { orientation: 'diagonal' }).options.orientation, 'TB');
});

test('a card dropped onto its sibling pushes the sibling (and the rest) aside', () => {
  const { doc, g, kids } = threeKids();
  const auto = layoutGraph(doc.graphs[g]).nodes;
  const [a, b, c] = [...kids].sort((x, y) => auto[x].x - auto[y].x);
  const dx = auto[b].x - auto[a].x; // drop a exactly onto b
  updateNodeAttrs(doc, g, a, { nudge: { dx, dy: 0 } });
  const { nodes } = layoutGraph(doc.graphs[g]);
  assertEqual(nodes[a].x, auto[b].x, 'the moved card stays where it was put');
  assert(nodes[b].x > nodes[a].x && nodes[c].x > nodes[b].x, 'order kept');
  assertNoCardOverlap(nodes);
  assert(!doc.graphs[g].nodes[b].attrs.nudge, 'pushing aside is layout, not a stored move');
});

test('left to right: push-aside works along the column', () => {
  const { doc, g, kids } = threeKids();
  doc.graphs[g].layout = { orientation: 'LR' };
  const auto = layoutGraph(doc.graphs[g], { orientation: 'LR' }).nodes;
  const [a, b] = [...kids].sort((x, y) => auto[x].y - auto[y].y);
  updateNodeAttrs(doc, g, a, { nudge: { dx: 0, dy: auto[b].y - auto[a].y } });
  assertNoCardOverlap(layoutGraph(doc.graphs[g], { orientation: 'LR' }).nodes);
});

test('a partnership dot follows its pushed partner and stays beside a single parent', () => {
  const { doc, g, mum, dad, union } = smallFamily();
  const stranger = addPerson(doc, g);
  const auto = layoutGraph(doc.graphs[g]).nodes;
  const target = auto[mum].x < auto[dad].x ? mum : dad;
  updateNodeAttrs(doc, g, stranger, { nudge: { dx: auto[target].x - auto[stranger].x, dy: 0 } });
  const { nodes } = layoutGraph(doc.graphs[g]);
  assertNoCardOverlap(nodes);
  const [l, r] = [nodes[mum], nodes[dad]].sort((x, y) => x.x - y.x);
  assert(l.x < nodes[union].x && nodes[union].x < r.x, 'dot still between the partners');

  const single = smallFamily();
  const lone = addPerson(single.doc, single.g);
  const u = addUnion(single.doc, single.g, [lone]);
  addChild(single.doc, single.g, u, addPerson(single.doc, single.g));
  const before = layoutGraph(single.doc.graphs[single.g]).nodes;
  updateNodeAttrs(single.doc, single.g, lone, { nudge: { dx: 300, dy: 40 } });
  const after = layoutGraph(single.doc.graphs[single.g]).nodes;
  assertEqual([after[u].x - before[u].x, after[u].y - before[u].y], [300, 40], 'dot moves with its single parent…');
  assert(Math.abs(after[u].x - after[lone].x) >= LAYOUT_DEFAULTS.cardWidth / 2, '…and stays outside the card');
});

test('renderer draws left-to-right connectors sideways', () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  const { doc, g } = smallFamily();
  doc.graphs[g].layout = { orientation: 'LR' };
  createRenderer(svg).render(doc, g);
  const child = svg.querySelector('.edge-child').getAttribute('d');
  assert(/^M \S+ \S+ H \S+ V \S+ H \S+$/.test(child), `child connector goes right first: ${child}`);
  const partner = svg.querySelector('.edge-partner').getAttribute('d');
  const [, x0, , , , , x1] = partner.split(' ');
  assert(/^M \S+ \S+ V \S+ H \S+$/.test(partner), `partner link leaves the card vertically: ${partner}`);
  assertEqual(x0, x1, 'partner link is vertical');
  svg.remove();
});

test('partner links meet a moved card square on, in both orientations', () => {
  for (const orientation of ['TB', 'LR']) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.append(svg);
    const { doc, g, mum } = smallFamily();
    doc.graphs[g].layout = { orientation };
    doc.graphs[g].nodes[mum].attrs.nudge = { dx: 23, dy: 37 };
    const layout = createRenderer(svg).render(doc, g);
    const card = layout.nodes[mum];
    const d = [...svg.querySelectorAll('.edge-partner')].map((p) => p.getAttribute('d'))
      .find((path) => {
        const [, x, y] = path.split(' ').map(Number);
        return orientation === 'TB'
          ? y === card.y && Math.abs(Math.abs(x - card.x) - card.width / 2) < 1e-6
          : x === card.x && Math.abs(Math.abs(y - card.y) - card.height / 2) < 1e-6;
      });
    assert(d, `${orientation}: a partner link starts at the middle of the moved card's edge`);
    assert(orientation === 'TB' ? /^M \S+ \S+ H \S+ V \S+$/.test(d) : /^M \S+ \S+ V \S+ H \S+$/.test(d),
      `${orientation}: right angles only: ${d}`);
    svg.remove();
  }
});

test('graph layout is validated', () => {
  const { doc, g } = smallFamily();
  doc.graphs[g].layout = { orientation: 'LR' };
  assertEqual(validate(doc), []);
  doc.graphs[g].layout = { orientation: 'sideways' };
  assertEqual(validate(doc).map((e) => e.code), ['graph-layout']);
});
