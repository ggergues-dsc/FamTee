import { test, assert, assertEqual } from './harness.js';
import { createInteraction } from '../src/ui/interaction.js';
import { toWorld } from '../src/ui/viewport.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// An svg with one draggable "card", wired to recording callbacks.
function setup({ k = 1 } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '400');
  svg.setAttribute('height', '300');
  svg.style.cssText = 'position:fixed;left:0;top:0;';
  const card = document.createElementNS(SVG_NS, 'rect');
  Object.entries({ x: 10, y: 10, width: 100, height: 50, 'data-id': 'p-1' }).forEach(([a, v]) => card.setAttribute(a, v));
  svg.append(card);
  document.body.append(svg);
  const log = { moves: [], drops: [], cancels: 0, clicks: 0 };
  let transform = { x: 0, y: 0, k };
  const ix = createInteraction(svg, {
    getTransform: () => transform,
    setTransform: (t) => { transform = t; },
    draggableId: (target) => target.closest?.('[data-id]')?.dataset.id ?? null,
    onDragMove: (id, dx, dy) => log.moves.push([id, dx, dy]),
    onDrop: (id, dx, dy) => log.drops.push([id, dx, dy]),
    onDragCancel: () => log.cancels++,
  });
  svg.addEventListener('click', () => log.clicks++);
  const rect = svg.getBoundingClientRect();
  const fire = (type, target, x, y, extra = {}) => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0,
    clientX: rect.left + x, clientY: rect.top + y, ...extra,
  }));
  const click = (target) => target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return { svg, card, log, ix, fire, click, get transform() { return transform; },
    done() { ix.destroy(); svg.remove(); } };
}

test('dragging the background pans and swallows the click', () => {
  const s = setup();
  s.fire('pointerdown', s.svg, 200, 200);
  s.fire('pointermove', s.svg, 250, 230);
  s.fire('pointerup', s.svg, 250, 230);
  assertEqual(s.transform, { x: 50, y: 30, k: 1 });
  s.click(s.svg);
  assertEqual(s.log.clicks, 0);
  s.done();
});

test('a press without movement stays a click', () => {
  const s = setup();
  s.fire('pointerdown', s.card, 50, 30);
  s.fire('pointermove', s.svg, 52, 31);
  s.fire('pointerup', s.svg, 52, 31);
  s.click(s.card);
  assertEqual(s.log.clicks, 1);
  assertEqual([s.log.moves.length, s.log.drops.length], [0, 0]);
  assertEqual(s.transform, { x: 0, y: 0, k: 1 });
  s.done();
});

test('dragging a card reports world-space offsets and drops once', () => {
  const s = setup({ k: 2 });
  s.fire('pointerdown', s.card, 50, 30);
  s.fire('pointermove', s.svg, 70, 30);
  s.fire('pointermove', s.svg, 90, 50);
  s.fire('pointerup', s.svg, 90, 50);
  assertEqual(s.log.moves.at(-1), ['p-1', 20, 10]);
  assertEqual(s.log.drops, [['p-1', 20, 10]]);
  assertEqual(s.transform, { x: 0, y: 0, k: 2 }, 'no pan while dragging');
  s.click(s.card);
  assertEqual(s.log.clicks, 0, 'drop does not also select');
  s.done();
});

test('Escape or pointercancel abandons a drag', () => {
  const s = setup();
  s.fire('pointerdown', s.card, 50, 30);
  s.fire('pointermove', s.svg, 90, 30);
  assert(s.ix.dragging);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  s.fire('pointerup', s.svg, 90, 30);
  assertEqual([s.log.cancels, s.log.drops.length], [1, 0]);

  s.fire('pointerdown', s.card, 50, 30);
  s.fire('pointermove', s.svg, 90, 30);
  s.fire('pointercancel', s.svg, 90, 30);
  assertEqual([s.log.cancels, s.log.drops.length], [2, 0]);
  s.done();
});

test('two pointers pinch-zoom around their midpoint', () => {
  const s = setup();
  s.fire('pointerdown', s.svg, 100, 100, { pointerId: 1, pointerType: 'touch' });
  s.fire('pointerdown', s.svg, 200, 100, { pointerId: 2, pointerType: 'touch' });
  const anchor = toWorld(s.transform, 150, 100);
  s.fire('pointermove', s.svg, 50, 100, { pointerId: 1, pointerType: 'touch' });
  s.fire('pointermove', s.svg, 250, 100, { pointerId: 2, pointerType: 'touch' });
  assert(Math.abs(s.transform.k - 2) < 1e-9, `k=${s.transform.k}`);
  const after = toWorld(s.transform, 150, 100);
  assert(Math.abs(after.x - anchor.x) < 1e-9 && Math.abs(after.y - anchor.y) < 1e-9);
  s.fire('pointerup', s.svg, 50, 100, { pointerId: 1, pointerType: 'touch' });
  s.fire('pointermove', s.svg, 270, 120, { pointerId: 2, pointerType: 'touch' });
  s.fire('pointerup', s.svg, 270, 120, { pointerId: 2, pointerType: 'touch' });
  assertEqual(s.log.drops.length, 0);
  s.done();
});

test('wheel zooms around the cursor', () => {
  const s = setup();
  const rect = s.svg.getBoundingClientRect();
  const before = toWorld(s.transform, 120, 80);
  s.svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, clientX: rect.left + 120, clientY: rect.top + 80, cancelable: true }));
  assert(s.transform.k > 1);
  const after = toWorld(s.transform, 120, 80);
  assert(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
  s.done();
});

test('right button does nothing', () => {
  const s = setup();
  s.fire('pointerdown', s.svg, 100, 100, { button: 2 });
  s.fire('pointermove', s.svg, 200, 200, { button: 2 });
  assertEqual(s.transform, { x: 0, y: 0, k: 1 });
  s.done();
});
