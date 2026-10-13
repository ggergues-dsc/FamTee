// Pointer interaction on the canvas (ADR 0012), built on Pointer Events so mouse,
// touch and pen behave alike:
//   - drag on empty canvas      → pan
//   - two fingers               → pinch-zoom (and pan)
//   - wheel / trackpad pinch    → zoom around the cursor
//   - drag a card (editable)    → move it; reported live and once on drop
//   - press and release without moving → a tap, reported with what was under the
//     pointer AT PRESS TIME (opts.describe), so a redraw between press and release
//     (e.g. a field committing as it loses focus) can't redirect it
// The browser's own click events on the canvas are swallowed; taps replace them.

import { zoomAt } from './viewport.js';

const CLICK_SLOP = 4; // px of movement before a press becomes a drag/pan
const WHEEL_SPEED = 0.0015;

export function createInteraction(svg, opts) {
  const { getTransform, setTransform, draggableId, onDragMove, onDrop, onDragCancel } = opts;
  const describe = opts.describe ?? (() => null);
  const onTap = opts.onTap ?? (() => {});
  const pointers = new Map(); // pointerId → { x, y } in svg-local px
  let gesture = null;
  let swallowClickUntil = 0;

  const local = (event) => {
    const rect = svg.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  function startPan(point, tap = null) {
    gesture = { type: 'pan', start: point, t0: getTransform(), moved: false, tap };
  }

  function startPinch() {
    const [a, b] = [...pointers.values()];
    if (gesture?.type === 'drag') onDragCancel(gesture.id);
    gesture = { type: 'pinch', d0: distance(a, b) || 1, m0: midpoint(a, b), t0: getTransform(), moved: true };
  }

  function onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const point = local(event);
    pointers.set(event.pointerId, point);
    try {
      svg.setPointerCapture(event.pointerId); // keep receiving moves outside the svg
    } catch {
      // pointer already gone (or synthetic); moves still arrive while over the svg
    }
    if (pointers.size === 2) return startPinch();
    if (pointers.size > 2) return;
    const tap = describe(event.target);
    const id = draggableId(event.target);
    if (id) gesture = { type: 'press', id, start: point, t0: getTransform(), moved: false, tap };
    else startPan(point, tap);
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId) || !gesture) return;
    const point = local(event);
    pointers.set(event.pointerId, point);
    if (gesture.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const m = midpoint(a, b);
      const zoomed = zoomAt(gesture.t0, gesture.t0.k * (distance(a, b) / gesture.d0), gesture.m0.x, gesture.m0.y);
      setTransform({ ...zoomed, x: zoomed.x + m.x - gesture.m0.x, y: zoomed.y + m.y - gesture.m0.y });
      return;
    }
    const dx = point.x - gesture.start.x;
    const dy = point.y - gesture.start.y;
    if (!gesture.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    gesture.moved = true;
    if (gesture.type === 'pan') {
      setTransform({ ...gesture.t0, x: gesture.t0.x + dx, y: gesture.t0.y + dy });
    } else if (gesture.type === 'press' || gesture.type === 'drag') {
      gesture.type = 'drag';
      onDragMove(gesture.id, dx / gesture.t0.k, dy / gesture.t0.k);
    }
  }

  function onPointerEnd(event) {
    if (!pointers.has(event.pointerId)) return;
    const point = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (!gesture) return;
    // Taps and drags both replace the browser's click on the canvas.
    swallowClickUntil = performance.now() + 400;
    if (!gesture.moved && (gesture.type === 'press' || gesture.type === 'pan') && event.type === 'pointerup' && pointers.size === 0) {
      onTap(gesture.tap);
    }
    if (gesture.type === 'drag') {
      const dx = (point.x - gesture.start.x) / gesture.t0.k;
      const dy = (point.y - gesture.start.y) / gesture.t0.k;
      if (event.type === 'pointercancel') onDragCancel(gesture.id);
      else onDrop(gesture.id, dx, dy);
    }
    // Lifting one finger of a pinch continues as a pan with the other.
    if (gesture.type === 'pinch' && pointers.size === 1) {
      startPan([...pointers.values()][0]);
      gesture.moved = true;
    } else if (pointers.size === 0) {
      gesture = null;
    }
  }

  function onWheel(event) {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    const t = getTransform();
    const point = local(event);
    setTransform(zoomAt(t, t.k * Math.exp(-event.deltaY * unit * WHEEL_SPEED), point.x, point.y));
  }

  function onClickCapture(event) {
    if (performance.now() < swallowClickUntil) {
      event.stopPropagation();
      event.preventDefault();
      swallowClickUntil = 0;
    }
  }

  // Escape during a drag puts the card back.
  function onKeyDown(event) {
    if (event.key === 'Escape' && gesture?.type === 'drag') {
      event.preventDefault(); // tells other handlers the Escape was used
      onDragCancel(gesture.id);
      gesture = { ...gesture, type: 'cancelled' };
    }
  }

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerEnd);
  svg.addEventListener('pointercancel', onPointerEnd);
  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('click', onClickCapture, true);
  document.addEventListener('keydown', onKeyDown);

  return {
    get dragging() {
      return gesture?.type === 'drag';
    },
    destroy() {
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', onPointerEnd);
      svg.removeEventListener('pointercancel', onPointerEnd);
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('click', onClickCapture, true);
      document.removeEventListener('keydown', onKeyDown);
    },
  };
}
