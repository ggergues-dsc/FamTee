import { test, assert, assertEqual, assertThrows } from './harness.js';
import { createRenderer, LAYERS } from '../src/render/renderer.js';
import { layoutGraph } from '../src/layout/layout.js';
import { displayName, lifespan, fitText } from '../src/render/format.js';
import {
  addGraph, addPerson, addUnion, addChild, addGraphRef, addGroup, addLink, addEdge, updateNodeAttrs,
} from '../src/store/model.js';
import { smallFamily } from './fixtures.js';

function canvas() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '800');
  svg.setAttribute('height', '600');
  document.body.append(svg);
  return svg;
}

const all = (svg, selector) => [...svg.querySelectorAll(selector)];
const layer = (svg, name) => svg.querySelector(`.layer-${name}`);

test('formatting helpers', () => {
  assertEqual(displayName({ name: { given: 'Ann', surname: 'Lee' } }), 'Ann Lee');
  assertEqual(displayName({ name: 'Ann' }), 'Ann');
  assertEqual(displayName({}), 'Unnamed');
  assertEqual(lifespan({ birth: { date: '1950' }, death: { date: '2010' } }), '1950 – 2010');
  assertEqual(lifespan({ birth: { date: '1950' } }), 'b. 1950');
  assertEqual(lifespan({ death: { date: '2010' } }), 'd. 2010');
  assertEqual(lifespan({}), '');
  assertEqual(fitText('short', 100), 'short');
  assertEqual(fitText('a very long name indeed', 75), 'a very lo…');
});

test('layers exist in the fixed order', () => {
  const svg = canvas();
  createRenderer(svg);
  assertEqual(all(svg, '.viewport > g').map((g) => g.getAttribute('class')), LAYERS.map((l) => `layer layer-${l}`));
  svg.remove();
});

test('renders cards, unions, edges and labels', () => {
  const svg = canvas();
  const { doc, g, mum } = smallFamily();
  updateNodeAttrs(doc, g, mum, { sex: 'F', birth: { date: '1950' } });
  createRenderer(svg).render(doc, g);
  assertEqual(all(svg, '.card.person').length, 3);
  assertEqual(all(svg, '.union').length, 1);
  assertEqual(all(svg, '.edge-partner').length, 2);
  assertEqual(all(svg, '.edge-child').length, 1);
  assert(svg.querySelector(`.person.sex-F[data-id="${mum}"]`));
  const names = all(layer(svg, 'labels'), '.name').map((t) => t.textContent);
  assertEqual(names.sort(), ['Ann', 'Bob', 'Cid']);
  assert(all(layer(svg, 'labels'), '.dates').some((t) => t.textContent === 'b. 1950'));
  assert(!svg.hasAttribute('viewBox'), 'pan/zoom uses a transform, not the viewBox');
  svg.remove();
});

test('setTransform positions the viewport; drag previews mark the card', () => {
  const svg = canvas();
  const { doc, g, kid } = smallFamily();
  const renderer = createRenderer(svg);
  renderer.setTransform({ x: 10, y: -20, k: 0.5 });
  assertEqual(svg.querySelector('.viewport').getAttribute('transform'), 'translate(10 -20) scale(0.5)');
  const plain = renderer.render(doc, g).nodes[kid];
  const moved = renderer.render(doc, g, { preview: { [kid]: { dx: 40, dy: 0 } } }).nodes[kid];
  assertEqual(moved.x - plain.x, 40);
  assert(svg.querySelector(`.card.dragging[data-id="${kid}"]`));
  assertEqual(svg.querySelector('.viewport').getAttribute('transform'), 'translate(10 -20) scale(0.5)', 'render keeps the transform');
  svg.remove();
});

test('re-rendering replaces content instead of appending', () => {
  const svg = canvas();
  const { doc, g } = smallFamily();
  const renderer = createRenderer(svg);
  renderer.render(doc, g);
  renderer.render(doc, g);
  assertEqual(all(svg, '.card').length, 3);
  assertThrows(() => renderer.render(doc, 'g-nope'), /Unknown graph/);
  svg.remove();
});

test('graphRefs, groups, link badges, custom edges and selection', () => {
  const svg = canvas();
  const { doc, g, mum, dad, kid } = smallFamily();
  const other = addGraph(doc, { title: 'In-laws' });
  const twin = addPerson(doc, other);
  addGraphRef(doc, g, other);
  addGroup(doc, g, [mum, dad], { label: 'Household' });
  addLink(doc, { type: 'same-as', from: `${g}:${kid}`, to: `${other}:${twin}` });
  addEdge(doc, g, { type: 'custom', from: mum, to: kid, attrs: { label: 'godparent' } });
  createRenderer(svg).render(doc, g, { selection: new Set([kid]) });

  const ref = svg.querySelector('.graph-ref');
  assertEqual(ref.dataset.refGraph, other);
  assert(all(svg, '.name').some((t) => t.textContent === 'In-laws'), 'graphRef labelled with graph title');
  assertEqual(all(svg, '.group').length, 1);
  assert(all(svg, '.group-label').some((t) => t.textContent === 'Household'));
  const badge = layer(svg, 'annotations').querySelector('.link-badge');
  assertEqual([badge.dataset.linkGraph, badge.dataset.linkNode], [other, twin]);
  assertEqual(all(svg, '.edge-custom').length, 1);
  assertEqual(layer(svg, 'ui').querySelector('.selection').dataset.id, kid);
  svg.remove();
});

test('text is inserted as text, never as markup', () => {
  const svg = canvas();
  const { doc, g, mum } = smallFamily();
  updateNodeAttrs(doc, g, mum, { name: '<img src=x onerror=alert(1)>' });
  createRenderer(svg).render(doc, g);
  assertEqual(svg.querySelectorAll('img').length, 0);
  assert(all(svg, '.name').some((t) => t.textContent.startsWith('<img')));
  svg.remove();
});

test('overlapping child connectors get separate lanes', () => {
  const svg = canvas();
  const { doc, g, mum, union, kid } = smallFamily();
  const u2 = addUnion(doc, g, [mum, addPerson(doc, g)]);
  const kid2 = addPerson(doc, g);
  addChild(doc, g, u2, kid2);
  // Nudge each child beyond the other union so the connectors' horizontal spans overlap.
  const { nodes } = layoutGraph(doc.graphs[g]);
  const side = Math.sign(nodes[u2].x - nodes[union].x);
  const to = (id, x) => ({ nudge: { dx: x - nodes[id].x, dy: 300 - nodes[id].y } });
  updateNodeAttrs(doc, g, kid, to(kid, 900 * side));
  updateNodeAttrs(doc, g, kid2, to(kid2, -900 * side));
  createRenderer(svg).render(doc, g);
  const busY = (childId) => {
    const x = (childId === kid ? 900 : -900) * side;
    const path = all(svg, '.edge-child').find((p) => p.getAttribute('d').endsWith(`H ${x} V 272`));
    return Number(path.getAttribute('d').split(' ')[4]);
  };
  assert(busY(kid) !== busY(kid2), 'different lanes');
  svg.remove();
});
