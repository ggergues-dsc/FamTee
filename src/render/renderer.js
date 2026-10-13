// Draws one graph of a document into an <svg> organised in fixed layers (ADR 0003).
// The output is a function of (document, graph id, options): nothing is kept between
// renders except the layer elements themselves.

import { layoutGraph } from '../layout/layout.js';
import { parseEndpoint } from '../store/schema.js';
import { displayName, lifespan, fitText } from './format.js';
import { transformAttr } from '../ui/viewport.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const LAYERS = ['background', 'edges', 'nodes', 'labels', 'annotations', 'overlay', 'ui'];
const MARGIN = 40;
const UNION_RADIUS = 5;
const BADGE_RADIUS = 9;

export function svgEl(tag, attrs = {}, parent = null) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) el.setAttribute(key, String(value));
  }
  if (parent) parent.append(el);
  return el;
}

export function createRenderer(svg) {
  svg.classList.add('famtee-canvas');
  svg.removeAttribute('viewBox');
  svg.replaceChildren();
  const viewport = svgEl('g', { class: 'viewport' }, svg);
  const layers = Object.fromEntries(LAYERS.map((name) => [name, svgEl('g', { class: `layer layer-${name}` }, viewport)]));

  // `preview` holds extra { dx, dy } offsets for nodes being dragged (not stored).
  function render(doc, graphId, { selection = new Set(), preview = null, layoutOptions } = {}) {
    const graph = doc.graphs[graphId];
    if (!graph) throw new Error(`Unknown graph: ${graphId}`);
    const layout = layoutGraph(graph, { ...layoutOptions, preview });
    for (const layer of Object.values(layers)) layer.replaceChildren();

    const { bounds } = layout;
    svgEl('rect', {
      class: 'background',
      x: bounds.x - MARGIN, y: bounds.y - MARGIN,
      width: bounds.width + 2 * MARGIN, height: bounds.height + 2 * MARGIN,
    }, layers.background);

    const groupBoxes = drawGroups(graph, layout, layers);
    drawEdges(graph, layout, layers.edges);
    drawNodes(doc, graph, layout, layers, preview);
    drawLinkBadges(doc, graphId, layout, layers.annotations);
    drawSelection(selection, layout, groupBoxes, layers.ui);
    return layout;
  }

  // Pan/zoom (ADR 0012): the transform maps layout coordinates to screen pixels.
  function setTransform(t) {
    viewport.setAttribute('transform', transformAttr(t));
  }

  return { svg, layers, render, setTransform };
}

// Returns Map(group id → box) so the selection outline can reuse it.
function drawGroups(graph, layout, layers) {
  const boxes = new Map();
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.type !== 'group') continue;
    const members = (node.attrs.members ?? []).map((m) => layout.nodes[m]).filter(Boolean);
    if (!members.length) continue;
    const pad = 14;
    const x0 = Math.min(...members.map((n) => n.x - n.width / 2)) - pad;
    const y0 = Math.min(...members.map((n) => n.y - n.height / 2)) - pad - 16;
    const x1 = Math.max(...members.map((n) => n.x + n.width / 2)) + pad;
    const y1 = Math.max(...members.map((n) => n.y + n.height / 2)) + pad;
    const box = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    boxes.set(id, box);
    const rect = svgEl('rect', { class: 'group', 'data-id': id, ...box, rx: 12 }, layers.nodes);
    svgEl('title', {}, rect).textContent = `${node.attrs.label || 'Group'} (click to edit)`;
    const label = svgEl('text', { class: 'group-label', x: x0 + 10, y: y0 + 16 }, layers.labels);
    label.textContent = node.attrs.label || 'Group';
  }
  return boxes;
}

function drawEdges(graph, layout, layer) {
  const { cardHeight, rankGap } = layout.options;
  const lanes = busLanes(graph, layout);
  for (const edge of graph.edges) {
    const a = layout.nodes[edge.from];
    const b = layout.nodes[edge.to];
    if (!a || !b) continue;
    const kind = edge.attrs?.kind;
    const cls = ['edge', `edge-${edge.type}`, kind ? `kind-${kind}` : ''].join(' ').trim();
    let d;
    if (edge.type === 'partner') {
      // From the side of the card facing the union to the union dot.
      const side = b.x >= a.x ? 1 : -1;
      d = `M ${a.x + (side * a.width) / 2} ${a.y} L ${b.x} ${b.y}`;
    } else if (edge.type === 'child') {
      // Orthogonal "bus": down from the union, across, down to the child's top edge.
      const top = b.y - b.height / 2;
      const mid = Math.max(a.y + cardHeight / 2 + 6, top - rankGap / 2 + (lanes.get(edge.from) ?? 0));
      d = `M ${a.x} ${a.y} V ${mid} H ${b.x} V ${top}`;
    } else {
      const mx = (a.x + b.x) / 2;
      const my = Math.min(a.y, b.y) - 40;
      d = `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
    }
    svgEl('path', { class: cls, d, 'data-id': edge.id }, layer);
  }
}

// Child connectors from different unions in the same row would share one horizontal
// line where their spans overlap. Give overlapping spans separate lanes (y offsets).
const LANE_SPACING = 10;

function busLanes(graph, layout) {
  const spans = new Map(); // union id → { row, x0, x1 }
  for (const edge of graph.edges) {
    const u = layout.nodes[edge.from];
    const c = layout.nodes[edge.to];
    if (edge.type !== 'child' || !u || !c) continue;
    const span = spans.get(edge.from) ?? { row: Math.round(u.y), x0: u.x, x1: u.x };
    span.x0 = Math.min(span.x0, c.x);
    span.x1 = Math.max(span.x1, c.x);
    spans.set(edge.from, span);
  }
  const rows = new Map();
  for (const [id, span] of spans) {
    if (!rows.has(span.row)) rows.set(span.row, []);
    rows.get(span.row).push({ id, ...span });
  }
  const offsets = new Map();
  for (const row of rows.values()) {
    row.sort((a, b) => a.x0 - b.x0 || a.x1 - b.x1);
    const laneEnds = [];
    const lane = new Map();
    for (const span of row) {
      let i = laneEnds.findIndex((end) => end < span.x0 - 4);
      if (i === -1) i = laneEnds.push(0) - 1;
      laneEnds[i] = span.x1;
      lane.set(span.id, i);
    }
    const centre = (laneEnds.length - 1) / 2;
    for (const [id, i] of lane) offsets.set(id, (i - centre) * LANE_SPACING);
  }
  return offsets;
}

function drawNodes(doc, graph, layout, layers, preview) {
  for (const [id, node] of Object.entries(graph.nodes)) {
    const pos = layout.nodes[id];
    if (!pos) continue;
    if (node.type === 'union') {
      svgEl('circle', { class: 'union', 'data-id': id, cx: pos.x, cy: pos.y, r: UNION_RADIUS }, layers.nodes);
      continue;
    }

    const left = pos.x - pos.width / 2;
    const top = pos.y - pos.height / 2;
    const textWidth = pos.width - 20;
    let title;
    let subtitle;
    let cls;
    const extra = {};
    if (node.type === 'graphRef') {
      title = node.attrs.label ?? doc.graphs[node.attrs.graph]?.title ?? 'Graph';
      subtitle = 'Open →';
      cls = 'card graph-ref';
      extra['data-ref-graph'] = node.attrs.graph;
    } else {
      title = displayName(node.attrs);
      subtitle = lifespan(node.attrs);
      const sex = ['M', 'F'].includes(node.attrs.sex) ? node.attrs.sex : 'U';
      cls = `card person sex-${sex}`;
    }

    if (preview?.[id]) cls += ' dragging';
    const card = svgEl('rect', {
      class: cls, 'data-id': id, ...extra,
      x: left, y: top, width: pos.width, height: pos.height, rx: 8,
    }, layers.nodes);
    svgEl('title', {}, card).textContent = subtitle ? `${title}\n${subtitle}` : title;

    const name = svgEl('text', { class: 'name', x: pos.x, y: subtitle ? pos.y - 4 : pos.y + 5 }, layers.labels);
    name.textContent = fitText(title, textWidth);
    if (subtitle) {
      const sub = svgEl('text', { class: 'dates', x: pos.x, y: pos.y + 15 }, layers.labels);
      sub.textContent = fitText(subtitle, textWidth, 6.5);
    }
  }
}

// Marks nodes that also appear in, or are linked to, another graph. Several badges
// on one card are spaced out along its top edge.
function drawLinkBadges(doc, graphId, layout, layer) {
  const perNode = new Map();
  for (const link of doc.links) {
    const ends = [link.from, link.to].map(parseEndpoint);
    ends.forEach((end, i) => {
      const other = ends[1 - i];
      if (!end || !other || end.graphId !== graphId || other.graphId === graphId) return;
      const pos = layout.nodes[end.nodeId];
      if (!pos) return;
      const index = perNode.get(end.nodeId) ?? 0;
      perNode.set(end.nodeId, index + 1);
      const cx = pos.x + pos.width / 2 - 4 - index * (2 * BADGE_RADIUS + 4);
      const cy = pos.y - pos.height / 2 + 4;
      const badge = svgEl('g', {
        class: `link-badge link-${link.type}`,
        'data-link-graph': other.graphId,
        'data-link-node': other.nodeId,
      }, layer);
      svgEl('circle', { cx, cy, r: BADGE_RADIUS }, badge);
      svgEl('text', { x: cx, y: cy + 4 }, badge).textContent = link.type === 'same-as' ? '=' : '↔';
      const target = doc.graphs[other.graphId]?.title ?? other.graphId;
      const label = link.attrs?.label ? `${link.attrs.label}: ` : '';
      svgEl('title', {}, badge).textContent =
        link.type === 'same-as' ? `Same person in “${target}”` : `${label}linked to “${target}”`;
    });
  }
}

function drawSelection(selection, layout, groupBoxes, layer) {
  for (const id of selection) {
    const box = groupBoxes.get(id);
    if (box) {
      svgEl('rect', { class: 'selection', 'data-id': id, ...box, rx: 12 }, layer);
      continue;
    }
    const pos = layout.nodes[id];
    if (!pos) continue;
    const pad = 4;
    svgEl('rect', {
      class: 'selection', 'data-id': id,
      x: pos.x - pos.width / 2 - pad, y: pos.y - pos.height / 2 - pad,
      width: pos.width + 2 * pad, height: pos.height + 2 * pad, rx: 10,
    }, layer);
  }
}
