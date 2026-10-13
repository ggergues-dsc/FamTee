// Pan/zoom transform math (ADR 0012). A transform {x, y, k} maps world (layout)
// coordinates to screen pixels inside the <svg>: screen = world × k + (x, y).

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export const IDENTITY = Object.freeze({ x: 0, y: 0, k: 1 });

export function clampZoom(k) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

// Zooms to `k` while keeping the world point under screen point (px, py) fixed.
export function zoomAt(t, k, px, py) {
  const k2 = clampZoom(k);
  return { k: k2, x: px - ((px - t.x) * k2) / t.k, y: py - ((py - t.y) * k2) / t.k };
}

export function toWorld(t, px, py) {
  return { x: (px - t.x) / t.k, y: (py - t.y) / t.k };
}

// Centres `bounds` in a width × height screen, shrinking to fit but never above `maxK`.
export function fitTransform(bounds, width, height, { margin = 40, maxK = 1 } = {}) {
  if (!width || !height) return { ...IDENTITY };
  const bw = Math.max(bounds.width, 1);
  const bh = Math.max(bounds.height, 1);
  const k = clampZoom(Math.min(maxK, (width - 2 * margin) / bw, (height - 2 * margin) / bh));
  return {
    k,
    x: width / 2 - (bounds.x + bounds.width / 2) * k,
    y: height / 2 - (bounds.y + bounds.height / 2) * k,
  };
}

export function transformAttr(t) {
  const r = (v) => Math.round(v * 1000) / 1000;
  return `translate(${r(t.x)} ${r(t.y)}) scale(${r(t.k)})`;
}
