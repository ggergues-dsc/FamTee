import { test, assert, assertEqual } from './harness.js';
import { zoomAt, toWorld, fitTransform, clampZoom, transformAttr, MIN_ZOOM, MAX_ZOOM } from '../src/ui/viewport.js';

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('zoomAt keeps the point under the cursor fixed', () => {
  const t = { x: 30, y: -10, k: 0.8 };
  const before = toWorld(t, 200, 150);
  const z = zoomAt(t, 2, 200, 150);
  const after = toWorld(z, 200, 150);
  assert(near(before.x, after.x) && near(before.y, after.y));
  assertEqual(z.k, 2);
});

test('zoom is clamped', () => {
  assertEqual(clampZoom(100), MAX_ZOOM);
  assertEqual(clampZoom(0), MIN_ZOOM);
  assertEqual(zoomAt({ x: 0, y: 0, k: 1 }, 50, 0, 0).k, MAX_ZOOM);
});

test('fit shrinks large graphs and never enlarges small ones', () => {
  const small = fitTransform({ x: 0, y: 0, width: 200, height: 100 }, 1000, 600);
  assertEqual(small, { k: 1, x: 400, y: 250 });
  const big = fitTransform({ x: -500, y: 0, width: 4000, height: 1000 }, 1000, 600);
  assert(near(big.k, 920 / 4000));
  const centre = toWorld(big, 500, 300);
  assert(near(centre.x, 1500) && near(centre.y, 500), 'graph centre at screen centre');
  assertEqual(fitTransform({ x: 0, y: 0, width: 10, height: 10 }, 0, 0), { x: 0, y: 0, k: 1 });
});

test('transformAttr is compact', () => {
  assertEqual(transformAttr({ x: 1.23456, y: -2, k: 0.5 }), 'translate(1.235 -2) scale(0.5)');
});
