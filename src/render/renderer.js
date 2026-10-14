// Draws one graph of a document into an <svg> organised in fixed layers (ADR 0003).
// The output is a function of (document, graph id, options): nothing is kept between
// renders except the layer elements themselves.

import { layoutGraph } from '../layout/layout.js';
import { parseEndpoint } from '../store/schema.js';
import { displayName, lifespan, fitText } from './format.js';
import { transformAttr } from '../ui/viewport.js';
import { mediaData } from '../store/media.js';
import { portraitMarkup, iconMarkup, jobIconName, petIconName } from '../ui/icons.js';
import { countryOf, flagMarkup } from './flags.js';
import { svgEl } from './svg.js';
import { drawTree } from './tree.js';

export const LAYERS = ['background', 'edges', 'nodes', 'labels', 'annotations', 'overlay', 'ui'];
const MARGIN = 40;
const UNION_RADIUS = 5;
const BADGE_RADIUS = 9;
const AVATAR_RADIUS = 19;
let rendererCount = 0;


export function createRenderer(svg) {
  svg.classList.add('famtee-canvas');
  svg.removeAttribute('viewBox');
  svg.replaceChildren();
  const instance = ++rendererCount;
  // Photo patterns persist across renders: each image is parsed once, not on every
  // frame of a drag (ADR 0013).
  const defs = svgEl('defs', {}, svg);
  const patterns = new Map(); // media id → pattern element id
  function photoFill(doc, mediaId) {
    const media = doc.media?.[mediaId];
    const data = mediaData(media, 'thumb'); // cards show a small avatar: the miniature is enough
    if (!data) return null;
    if (!patterns.has(mediaId)) {
      const id = `famtee-photo-${instance}-${patterns.size}`;
      const pattern = svgEl('pattern', { id, patternContentUnits: 'objectBoundingBox', width: 1, height: 1 }, defs);
      svgEl('image', { href: data, width: 1, height: 1, preserveAspectRatio: 'xMidYMid slice' }, pattern);
      patterns.set(mediaId, id);
    }
    return `url(#${patterns.get(mediaId)})`;
  }
  // Placeholder portraits (no photo) are clipped to the avatar circle.
  const portraitClip = `famtee-portrait-clip-${instance}`;
  svgEl('circle', { cx: 20, cy: 20, r: 19.5 }, svgEl('clipPath', { id: portraitClip }, defs));
  const flagClip = `famtee-flag-clip-${instance}`;
  svgEl('rect', { width: 15, height: 10, rx: 1 }, svgEl('clipPath', { id: flagClip }, defs));
  const clips = { portrait: portraitClip, flag: flagClip };
  const viewport = svgEl('g', { class: 'viewport' }, svg);
  const layers = Object.fromEntries(LAYERS.map((name) => [name, svgEl('g', { class: `layer layer-${name}` }, viewport)]));

  // `preview` holds extra { dx, dy } offsets for nodes being dragged (not stored).
  // mode 'tree' draws View mode's tree (src/render/tree.js) instead of cards; `hidden`
  // then lists the families (trunk ids) not to show.
  function render(doc, graphId, { selection = new Set(), preview = null, layoutOptions, connectHandle = false, badges = {}, mode = 'cards', hidden } = {}) {
    const graph = doc.graphs[graphId];
    if (!graph) throw new Error(`Unknown graph: ${graphId}`);
    if (mode === 'tree') {
      const layout = layoutGraph(graph, { ...layoutOptions, orientation: 'TB' });
      for (const layer of Object.values(layers)) layer.replaceChildren();
      const tree = drawTree({ doc, graph, layout, layers, selection, hidden, photoFill, clips });
      return { ...tree, options: layout.options, mode: 'tree' };
    }
    const orientation = layoutOptions?.orientation ?? graph.layout?.orientation;
    const layout = layoutGraph(graph, { ...layoutOptions, orientation, preview });
    for (const layer of Object.values(layers)) layer.replaceChildren();

    const { bounds } = layout;
    svgEl('rect', {
      class: 'background',
      x: bounds.x - MARGIN, y: bounds.y - MARGIN,
      width: bounds.width + 2 * MARGIN, height: bounds.height + 2 * MARGIN,
    }, layers.background);

    const groupBoxes = drawGroups(graph, layout, layers);
    drawEdges(graph, layout, layers.edges);
    const show = { flags: badges.flags !== false, jobs: badges.jobs !== false };
    drawNodes(doc, graphId, graph, layout, layers, preview, photoFill, clips, show);
    drawLinkBadges(doc, graphId, layout, layers.annotations);
    drawSelection(selection, layout, groupBoxes, layers.ui);
    if (connectHandle) drawConnectHandles(graph, selection, layout, layers.ui);
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
  const { cardWidth, cardHeight, rankGap } = layout.options;
  const lr = layout.options.orientation === 'LR';
  const lanes = busLanes(graph, layout);
  for (const edge of graph.edges) {
    const a = layout.nodes[edge.from];
    const b = layout.nodes[edge.to];
    if (!a || !b) continue;
    const kind = edge.attrs?.kind;
    const cls = ['edge', `edge-${edge.type}`, kind ? `kind-${kind}` : ''].join(' ').trim();
    let d;
    if (edge.type === 'partner' && lr) {
      // Partners are stacked: out of the middle of the card edge facing the union dot,
      // then square into the dot, so a moved card still meets the line at that point.
      const side = b.y >= a.y ? 1 : -1;
      d = `M ${a.x} ${a.y + (side * a.height) / 2} V ${b.y} H ${b.x}`;
    } else if (edge.type === 'partner') {
      // Out of the middle of the side facing the union, then square into the dot.
      const side = b.x >= a.x ? 1 : -1;
      d = `M ${a.x + (side * a.width) / 2} ${a.y} H ${b.x} V ${b.y}`;
    } else if ((edge.type === 'child' || edge.type === 'pet') && lr) {
      // Orthogonal "bus" to the right: out of the union, along, then into the child's left edge.
      const left = b.x - b.width / 2;
      const mid = Math.max(a.x + cardWidth / 2 + 6, left - rankGap / 2 + (lanes.get(edge.from) ?? 0));
      d = `M ${a.x} ${a.y} H ${mid} V ${b.y} H ${left}`;
    } else if (edge.type === 'child' || edge.type === 'pet') {
      // Orthogonal "bus": down from the union, across, down to the child's top edge.
      const top = b.y - b.height / 2;
      const mid = Math.max(a.y + cardHeight / 2 + 6, top - rankGap / 2 + (lanes.get(edge.from) ?? 0));
      d = `M ${a.x} ${a.y} V ${mid} H ${b.x} V ${top}`;
    } else {
      const mx = (a.x + b.x) / 2;
      const my = Math.min(a.y, b.y) - 40;
      d = `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
      if (edge.attrs?.label) {
        // The curve's highest point is halfway between its ends and the control point.
        const label = svgEl('text', { class: 'edge-label', x: mx, y: (Math.min(a.y, b.y) + my) / 2 - 4 }, layer);
        label.textContent = edge.attrs.label;
      }
    }
    svgEl('path', { class: cls, d, 'data-id': edge.id }, layer);
  }
}

// Child connectors from different unions in the same row would share one horizontal
// line where their spans overlap. Give overlapping spans separate lanes (y offsets).
const LANE_SPACING = 10;

// Rows run along x (top-down) or along y (left to right).
function busLanes(graph, layout) {
  const lr = layout.options.orientation === 'LR';
  const along = lr ? 'y' : 'x';
  const across = lr ? 'x' : 'y';
  const spans = new Map(); // union id → { row, x0, x1 } in row coordinates
  for (const edge of graph.edges) {
    const u = layout.nodes[edge.from];
    const c = layout.nodes[edge.to];
    if ((edge.type !== 'child' && edge.type !== 'pet') || !u || !c) continue;
    const span = spans.get(edge.from) ?? { row: Math.round(u[across]), x0: u[along], x1: u[along] };
    span.x0 = Math.min(span.x0, c[along]);
    span.x1 = Math.max(span.x1, c[along]);
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

const PET_AVATAR_RADIUS = 15;
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// Links from each node of this graph to other graphs (each draws a badge in the
// card's top-right corner, see drawLinkBadges).
function linkBadgeCounts(doc, graphId) {
  const counts = new Map();
  for (const link of doc.links) {
    const ends = [link.from, link.to].map(parseEndpoint);
    ends.forEach((end, i) => {
      const other = ends[1 - i];
      if (end && other && end.graphId === graphId && other.graphId !== graphId) counts.set(end.nodeId, (counts.get(end.nodeId) ?? 0) + 1);
    });
  }
  return counts;
}

// The shapes of a 24×24 icon drawn at (x, y) with the given size.
function drawIcon(parent, name, x, y, size, cls) {
  const g = svgEl('g', { class: cls, transform: `translate(${x} ${y}) scale(${size / 24})` }, parent);
  g.innerHTML = iconMarkup(name);
  return g;
}

// Job and country of birth: a column of badges on the card's right edge (a 28 px job
// badge above a 26×17 flag), left of any cross-graph link badges. Returns how much of
// the card's width the column takes (0 when there is none), so the text can make room.
const JOB_BADGE_RADIUS = 14;
const FLAG_WIDTH = 26;
function drawPersonBadges(node, pos, linkCount, layer, clips, show) {
  const job = show.jobs ? node.attrs.occupation?.trim() : '';
  const country = show.flags ? countryOf(node.attrs.birth?.place) : null;
  if (!job && !country) return 0;
  const right = pos.x + pos.width / 2;
  const top = pos.y - pos.height / 2;
  const cx = right - 4 - (linkCount ? 10 + (linkCount - 1) * (2 * BADGE_RADIUS + 4) : 0) - JOB_BADGE_RADIUS;
  const flagHeight = (FLAG_WIDTH * 10) / 15;
  if (job) {
    const cy = country ? top + 4 + JOB_BADGE_RADIUS : pos.y;
    const badge = svgEl('g', { class: 'job-badge' }, layer);
    svgEl('circle', { cx, cy, r: JOB_BADGE_RADIUS }, badge);
    drawIcon(badge, jobIconName(job), cx - 10, cy - 10, 20, 'job-icon');
  }
  if (country) {
    const y = job ? top + 4 + 2 * JOB_BADGE_RADIUS + 3 : pos.y - flagHeight / 2;
    const flag = svgEl('g', { class: 'flag', transform: `translate(${cx - FLAG_WIDTH / 2} ${y}) scale(${FLAG_WIDTH / 15})` }, layer);
    const art = svgEl('g', { 'clip-path': `url(#${clips.flag})` }, flag);
    art.innerHTML = flagMarkup(country);
  }
  return right - (cx - JOB_BADGE_RADIUS) + 4;
}

function drawNodes(doc, graphId, graph, layout, layers, preview, photoFill, clips, show) {
  // People with no partner, parent, child or other line yet are drawn with a dashed outline.
  const connected = new Set(graph.edges.flatMap((e) => [e.from, e.to]));
  const linkCounts = linkBadgeCounts(doc, graphId);
  for (const [id, node] of Object.entries(graph.nodes)) {
    const pos = layout.nodes[id];
    if (!pos) continue;
    if (node.type === 'union') {
      svgEl('circle', { class: 'union', 'data-id': id, cx: pos.x, cy: pos.y, r: UNION_RADIUS }, layers.nodes);
      continue;
    }

    const left = pos.x - pos.width / 2;
    const top = pos.y - pos.height / 2;
    // People get an avatar on the left (their photo, or a placeholder portrait by sex),
    // pets an animal icon; the text centres in the rest.
    const isPerson = node.type === 'person';
    const isPet = node.type === 'pet';
    const photo = isPerson && node.attrs.photo ? photoFill(doc, node.attrs.photo) : null;
    const textLeft = isPerson ? left + 8 + 2 * AVATAR_RADIUS : isPet ? left + 6 + 2 * PET_AVATAR_RADIUS : left;
    // Job and country badges take a column on the right; the text centres in what's left.
    const badgeWidth = isPerson ? drawPersonBadges(node, pos, linkCounts.get(id) ?? 0, layers.labels, clips, show) : 0;
    const textRight = left + pos.width - badgeWidth;
    const textX = (textLeft + textRight) / 2;
    const textWidth = textRight - textLeft - (badgeWidth ? 6 : 20);
    let title;
    let subtitle;
    let cls;
    const extra = {};
    if (node.type === 'graphRef') {
      title = node.attrs.label ?? doc.graphs[node.attrs.graph]?.title ?? 'Graph';
      subtitle = 'Open →';
      cls = 'card graph-ref';
      extra['data-ref-graph'] = node.attrs.graph;
    } else if (isPet) {
      title = node.attrs.name?.trim() || 'Unnamed pet';
      const species = ['dog', 'cat'].includes(node.attrs.species) ? node.attrs.species : 'other';
      subtitle = [species === 'other' ? 'Pet' : cap(species), lifespan(node.attrs).replace(/^b\. /, '')].filter(Boolean).join(' · ');
      cls = `card pet species-${species}${connected.has(id) ? '' : ' unconnected'}`;
    } else {
      title = displayName(node.attrs);
      subtitle = lifespan(node.attrs);
      const sex = ['M', 'F'].includes(node.attrs.sex) ? node.attrs.sex : 'U';
      cls = `card person sex-${sex}${connected.has(id) ? '' : ' unconnected'}`;
    }

    if (preview?.[id]) cls += ' dragging';
    const card = svgEl('rect', {
      class: cls, 'data-id': id, ...extra,
      x: left, y: top, width: pos.width, height: pos.height, rx: isPet ? pos.height / 2 : 8,
    }, layers.nodes);
    // The badges don't take the pointer (taps go to the card), so the card's tooltip names them.
    const country = isPerson ? countryOf(node.attrs.birth?.place) : null;
    svgEl('title', {}, card).textContent = [title, subtitle, isPerson && node.attrs.occupation?.trim(),
      country && `Born in ${country}`].filter(Boolean).join('\n');
    if (isPerson) {
      const cx = left + 6 + AVATAR_RADIUS;
      svgEl('circle', {
        class: photo ? 'avatar' : 'avatar placeholder', 'data-id': id, cx, cy: pos.y, r: AVATAR_RADIUS, fill: photo ?? undefined,
      }, layers.labels);
      if (!photo) {
        const scale = AVATAR_RADIUS / 20;
        const g = svgEl('g', {
          class: 'portrait-art', 'clip-path': `url(#${clips.portrait})`,
          transform: `translate(${cx - AVATAR_RADIUS} ${pos.y - AVATAR_RADIUS}) scale(${scale})`,
        }, layers.labels);
        g.innerHTML = portraitMarkup(node.attrs.sex);
      }
    } else if (isPet) {
      const cx = left + 5 + PET_AVATAR_RADIUS;
      svgEl('circle', { class: 'pet-avatar', cx, cy: pos.y, r: PET_AVATAR_RADIUS }, layers.labels);
      drawIcon(layers.labels, petIconName(node.attrs.species), cx - 10, pos.y - 10, 20, 'pet-icon');
    }

    const name = svgEl('text', { class: 'name', x: textX, y: subtitle ? pos.y - 4 : pos.y + 5 }, layers.labels);
    name.textContent = fitText(title, textWidth);
    if (subtitle) {
      const sub = svgEl('text', { class: 'dates', x: textX, y: pos.y + (isPet ? 12 : 15) }, layers.labels);
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

// A handle on the right edge of the selected person: drag it onto someone to connect them.
function drawConnectHandles(graph, selection, layout, layer) {
  for (const id of selection) {
    const pos = layout.nodes[id];
    if (!pos || graph.nodes[id]?.type !== 'person') continue;
    const cx = pos.x + pos.width / 2;
    const handle = svgEl('g', { class: 'connect-handle', 'data-connect-from': id }, layer);
    svgEl('title', {}, handle).textContent = 'Drag onto someone to connect them (or Ctrl/⌘+drag any card, or press C)';
    svgEl('circle', { cx, cy: pos.y, r: 9 }, handle);
    svgEl('path', { d: `M ${cx - 4} ${pos.y} h 8 M ${cx} ${pos.y - 4} v 8` }, handle);
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
