// Tree view (View mode): the graph drawn as actual trees instead of cards. Built from
// the same generational layout (always top-down), turned upside down so ancestors are
// at the bottom and descendants grow upward.
//
//   trunk   a founding couple: a partnership where no partner has parents in the graph
//   branch  from a partnership up to each child; thicker the more people grow from it
//   fork    someone with children: a round portrait with a bark-brown ring
//   leaf    someone with no children yet: ringed and haloed in their family's green
//   graft   a partnership whose partners come from different lineages: their branches
//           meet there and the couple's children grow from it
//
// Everyone belongs to the trunk(s) they descend from; someone who married in belongs
// to their partner's. A family (trunk) can be hidden: its people disappear unless they
// also descend from a trunk that is shown, so a grafted couple's children stay.
//
// Diameters, curves and bark shades vary by about ±5%, seeded from the document and
// node ids, so a family always looks the same and adding someone doesn't reshape the rest.

import { svgEl } from './svg.js';
import { displayName, lifespan, fitText } from './format.js';
import { portraitMarkup, iconMarkup, petIconName } from '../ui/icons.js';

const NODE_RADIUS = 20;
const TRUNK_HEIGHT = 84;
const CANOPY_RADIUS = 92;
const TONES = 4; // family colours, cycled (.tree-tone-0 … 3 in main.css)

// --- seeded variation -------------------------------------------------------------

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

// A small random generator for one node: the same id always gives the same numbers.
function randomFor(key) {
  let seed = hash(key);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- the family structure -----------------------------------------------------------

export function treeStructure(graph) {
  const partners = new Map(); // union → people
  const children = new Map(); // union → people
  const pets = new Map(); // union → pets
  const unionsOf = new Map(); // person → unions they are a partner in
  const parentsOf = new Map(); // person → unions they are a child of
  const add = (map, k, v) => (map.get(k) ?? map.set(k, []).get(k)).push(v);
  const type = (id) => graph.nodes[id]?.type;
  for (const e of graph.edges) {
    if (e.type === 'partner' && type(e.from) === 'person' && type(e.to) === 'union') {
      add(partners, e.to, e.from);
      add(unionsOf, e.from, e.to);
    } else if (e.type === 'child' && type(e.from) === 'union' && type(e.to) === 'person') {
      add(children, e.from, e.to);
      add(parentsOf, e.to, e.from);
    } else if (e.type === 'pet' && type(e.from) === 'union' && type(e.to) === 'pet') {
      add(pets, e.from, e.to);
    }
  }
  const get = (map, k) => map.get(k) ?? [];
  const people = Object.keys(graph.nodes).filter((id) => type(id) === 'person');
  const hasParents = (p) => get(parentsOf, p).length > 0;

  // Trunks: partnerships where nobody has parents here. Someone entirely on their own
  // (no parents, no partnership) is a trunk of their own too.
  const trunks = [];
  for (const [u, ps] of partners) if (ps.length && ps.every((p) => !hasParents(p))) trunks.push(u);
  for (const p of people) if (!hasParents(p) && !get(unionsOf, p).length) trunks.push(p);

  // Membership: the trunks each person descends from (memoised; cycles are prevented
  // by validation, the guard only protects against odd data).
  const memo = new Map();
  const visiting = new Set();
  function familiesOf(p) {
    if (memo.has(p)) return memo.get(p);
    if (visiting.has(p)) return new Set();
    visiting.add(p);
    let result = new Set();
    if (hasParents(p)) {
      for (const u of get(parentsOf, p)) for (const q of get(partners, u)) for (const t of familiesOf(q)) result.add(t);
    } else {
      // A founder, someone on their own, or someone who married in.
      for (const u of get(unionsOf, p)) if (trunks.includes(u)) result.add(u);
      if (trunks.includes(p)) result.add(p);
      if (!result.size) {
        for (const u of get(unionsOf, p)) {
          for (const q of get(partners, u)) if (q !== p && hasParents(q)) for (const t of familiesOf(q)) result.add(t);
        }
      }
    }
    visiting.delete(p);
    memo.set(p, result);
    return result;
  }
  for (const p of people) familiesOf(p);

  // How many people grow from someone (themselves included): sets a branch's thickness.
  const sizeMemo = new Map();
  function grows(p, seen = new Set()) {
    if (sizeMemo.has(p)) return sizeMemo.get(p);
    if (seen.has(p)) return 1;
    seen.add(p);
    let n = 1;
    for (const u of get(unionsOf, p)) for (const c of get(children, u)) n += grows(c, seen);
    sizeMemo.set(p, n);
    return n;
  }

  return {
    partners: (u) => get(partners, u),
    children: (u) => get(children, u),
    pets: (u) => get(pets, u),
    unionsOf: (p) => get(unionsOf, p),
    hasParents,
    hasChildren: (p) => get(unionsOf, p).some((u) => get(children, u).length > 0),
    trunks,
    familiesOf: (p) => memo.get(p) ?? new Set(),
    grows,
  };
}

// The families (trunks) of a graph, each { id, name }, named after the founders' surnames.
export function treeFamilies(graph, structure = treeStructure(graph)) {
  return structure.trunks.map((id) => {
    const founders = graph.nodes[id].type === 'person' ? [id] : structure.partners(id);
    const surnames = [...new Set(founders.map((p) => {
      const name = graph.nodes[p].attrs.name;
      return (typeof name === 'object' && name?.surname) || displayName(graph.nodes[p].attrs);
    }))];
    return { id, name: surnames.join(' & ') };
  });
}

// --- drawing ---------------------------------------------------------------------------

// Draws the tree into the renderer's layers. layout: layoutGraph(graph) top-down.
// Returns { nodes: { id: { x, y, width, height } }, bounds, families }.
export function drawTree({ doc, graph, layout, layers, selection = new Set(), hidden = new Set(), photoFill, clips }) {
  const s = treeStructure(graph);
  // families left to right, as their trunks stand (so the switches read in the same order)
  const families = treeFamilies(graph, s).sort((a, b) => (layout.nodes[a.id]?.x ?? 0) - (layout.nodes[b.id]?.x ?? 0));
  const toneOf = new Map(families.map((f, i) => [f.id, i % TONES]));
  const docKey = doc.meta?.id ?? '';
  const P = (id) => {
    const n = layout.nodes[id];
    return n ? { x: n.x, y: -n.y } : null;
  };
  const shown = (p) => [...s.familiesOf(p)].some((t) => !hidden.has(t));
  const tone = (p) => toneOf.get([...s.familiesOf(p)].find((t) => !hidden.has(t)) ?? [...s.familiesOf(p)][0]) ?? 0;

  const people = Object.keys(graph.nodes).filter((id) => graph.nodes[id].type === 'person' && P(id) && shown(id));
  const visible = new Set(people);
  const unions = Object.keys(graph.nodes).filter((id) => graph.nodes[id].type === 'union' && P(id) &&
    s.partners(id).some((p) => visible.has(p)));
  if (!people.length) return { nodes: {}, bounds: { x: 0, y: 0, width: 0, height: 0 }, families };

  const ys = people.map((p) => P(p).y);
  const ground = Math.max(...ys) + TRUNK_HEIGHT;
  const canopy = svgEl('g', { class: 'tree-canopy' }, layers.background);
  const wood = svgEl('g', { class: 'tree-wood' }, layers.edges);
  const nodes = {};
  const points = [];

  // A tapered limb along a cubic curve, as a filled outline; `caps` rounds its ends.
  function limb(rand, p0, c1, c2, p1, w0, w1, caps = 'both') {
    const at = (t) => {
      const u = 1 - t;
      return [0, 1].map((i) => u * u * u * p0[i] + 3 * u * u * t * c1[i] + 3 * u * t * t * c2[i] + t * t * t * p1[i]);
    };
    const left = [];
    const right = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const [x, y] = at(t);
      const [xa, ya] = at(Math.max(0, t - 0.01));
      const [xb, yb] = at(Math.min(1, t + 0.01));
      const len = Math.hypot(xb - xa, yb - ya) || 1;
      const half = (w0 + (w1 - w0) * t) / 2;
      left.push(`${(x - ((yb - ya) / len) * half).toFixed(1)} ${(y + ((xb - xa) / len) * half).toFixed(1)}`);
      right.push(`${(x + ((yb - ya) / len) * half).toFixed(1)} ${(y - ((xb - xa) / len) * half).toFixed(1)}`);
    }
    const shade = (rand() * 2 - 1) * 5;
    const fill = `color-mix(in srgb, var(--bark) ${(100 - Math.abs(shade)).toFixed(1)}%, ${shade < 0 ? '#000' : '#fff'} ${Math.abs(shade).toFixed(1)}%)`;
    svgEl('path', { class: 'tree-limb', d: `M ${left.join(' L ')} L ${right.reverse().join(' L ')} Z`, style: `fill: ${fill}` }, wood);
    if (caps === 'both' || caps === 'start') svgEl('circle', { class: 'tree-limb', cx: p0[0], cy: p0[1], r: w0 / 2, style: `fill: ${fill}` }, wood);
    if (caps === 'both' || caps === 'end') svgEl('circle', { class: 'tree-limb', cx: p1[0], cy: p1[1], r: w1 / 2, style: `fill: ${fill}` }, wood);
  }
  const vary = (rand, v, amount = 0.05) => v * (1 + (rand() * 2 - 1) * amount);
  const width = (n) => Math.min(30, 5 + 4 * Math.sqrt(n));
  // A branch from a to b, leaving a upward and arriving at b; `key` seeds its variation.
  function branch(key, a, b, w, caps = 'both') {
    const rand = randomFor(docKey + key);
    const dy = a.y - b.y;
    const base = vary(rand, w);
    limb(rand, [a.x, a.y], [vary(rand, a.x, 0.01), a.y - dy * vary(rand, 0.55)], [vary(rand, b.x, 0.01), b.y + dy * vary(rand, 0.45)],
      [b.x, b.y], base, vary(rand, base * 0.72), caps);
  }

  // Trunks, with a short root flare, up to each founding partnership (or lone founder).
  for (const t of s.trunks) {
    if (hidden.has(t) || !P(t)) continue;
    const top = P(t);
    const n = graph.nodes[t].type === 'person' ? s.grows(t) : s.partners(t).reduce((sum, p) => sum + s.grows(p), 0);
    const w = Math.min(34, width(n) * 1.15);
    const rand = randomFor(`${docKey}${t}:roots`);
    for (const dx of [-1, 1]) {
      const ex = top.x + vary(rand, dx * w * 1.15, 0.1);
      limb(rand, [top.x + dx * w * 0.15, ground - 12], [top.x + dx * w * 0.4, ground - 7], [ex - dx * 10, ground + 4], [ex, ground + 6],
        vary(rand, w * 0.5), vary(rand, 2.5), 'none');
    }
    limb(rand, [top.x, ground - 8], [top.x, ground - 4], [top.x, ground + 6], [vary(rand, top.x, 0.002), ground + 11], vary(rand, w * 0.45), 3, 'none');
    branch(`${t}:trunk`, { x: top.x, y: ground }, top, w, 'end');
    points.push([top.x, ground + 30]);
  }

  // Partnerships: partners join the union point; children and pets grow up from it.
  for (const u of unions) {
    const at = P(u);
    const ps = s.partners(u).filter((p) => visible.has(p));
    const lineages = ps.filter((p) => s.hasParents(p));
    const kids = s.children(u).filter((c) => visible.has(c) && P(c));
    const weight = kids.reduce((sum, c) => sum + s.grows(c), 0);
    for (const p of ps) {
      // someone with parents here carries the branch on to the partnership; a founder or
      // someone who married in joins it with a short limb
      const w = s.hasParents(p) ? width(weight + 1) * 0.9 : Math.max(5, width(weight) * 0.45);
      branch(`${u}:${p}`, P(p), at, w);
    }
    for (const c of kids) branch(`${u}>${c}`, at, P(c), width(s.grows(c)));
    for (const pet of s.pets(u)) {
      const q = P(pet);
      if (q) branch(`${u}>${pet}`, at, q, 3);
    }
    if (lineages.length >= 2) {
      svgEl('circle', { class: 'tree-graft', cx: at.x, cy: at.y, r: 8 }, layers.labels);
      svgEl('title', {}, layers.labels.lastChild).textContent = 'Two families joined by this partnership';
    }
  }

  // Canopy: soft foliage around everyone above the founders, in their family's colour.
  for (const p of people) {
    if (!s.hasParents(p) && !s.unionsOf(p).some((u) => s.hasParents(s.partners(u).find((q) => q !== p) ?? ''))) continue;
    const at = P(p);
    const rand = randomFor(`${docKey}${p}:leaf`);
    // two overlapping blobs per person, so neighbouring ones merge into one crown
    svgEl('circle', { class: `tree-foliage tree-tone-${tone(p)}`, cx: at.x + vary(rand, 18, 0.5) * (rand() < 0.5 ? -1 : 1), cy: at.y - vary(rand, 22, 0.3), r: vary(rand, CANOPY_RADIUS, 0.15) }, canopy);
    svgEl('circle', { class: `tree-foliage tree-tone-${tone(p)}`, cx: at.x + vary(rand, 26, 0.5) * (rand() < 0.5 ? -1 : 1), cy: at.y + vary(rand, 6, 0.5), r: vary(rand, CANOPY_RADIUS * 0.75, 0.15) }, canopy);
  }

  // People: forks (with children) and leaves (without), and pets.
  for (const p of people) {
    const at = P(p);
    const node = graph.nodes[p];
    const leaf = !s.hasChildren(p);
    const g = svgEl('g', {
      class: `tree-node tree-person ${leaf ? `tree-leaf tree-tone-${tone(p)}` : 'tree-fork'}`, 'data-id': p,
    }, layers.nodes);
    if (leaf) svgEl('circle', { class: 'tree-halo', cx: at.x, cy: at.y, r: NODE_RADIUS + 11 }, g);
    const photo = node.attrs.photo ? photoFill(doc, node.attrs.photo) : null;
    // the photo goes in an inline style: the stylesheet's ring fill would override a fill attribute
    svgEl('circle', { class: 'tree-ring', cx: at.x, cy: at.y, r: NODE_RADIUS, style: photo ? `fill: ${photo}` : undefined }, g);
    if (!photo) {
      const art = svgEl('g', {
        class: 'portrait-art', 'clip-path': `url(#${clips.portrait})`,
        transform: `translate(${at.x - NODE_RADIUS + 1} ${at.y - NODE_RADIUS + 1}) scale(${(NODE_RADIUS - 1) / 20})`,
      }, g);
      art.innerHTML = portraitMarkup(node.attrs.sex);
    }
    svgEl('title', {}, g).textContent = [displayName(node.attrs), lifespan(node.attrs)].filter(Boolean).join('\n');
    if (selection.has(p)) svgEl('circle', { class: 'selection', cx: at.x, cy: at.y, r: NODE_RADIUS + 5 }, layers.ui);
    const name = svgEl('text', { class: 'tree-name', x: at.x, y: at.y + NODE_RADIUS + 15 }, layers.labels);
    name.textContent = fitText(displayName(node.attrs), 120);
    const dates = lifespan(node.attrs);
    if (dates) svgEl('text', { class: 'tree-dates', x: at.x, y: at.y + NODE_RADIUS + 28 }, layers.labels).textContent = dates;
    nodes[p] = { x: at.x, y: at.y, width: 2 * NODE_RADIUS, height: 2 * NODE_RADIUS };
    points.push([at.x - 70, at.y - CANOPY_RADIUS - 10], [at.x + 70, at.y + NODE_RADIUS + 34]);
  }
  for (const u of unions) {
    for (const pet of s.pets(u)) {
      const at = P(pet);
      if (!at) continue;
      const g = svgEl('g', { class: 'tree-node tree-pet', 'data-id': pet }, layers.nodes);
      svgEl('circle', { class: 'tree-ring', cx: at.x, cy: at.y, r: 14 }, g);
      const icon = svgEl('g', { class: 'pet-icon', transform: `translate(${at.x - 9} ${at.y - 9}) scale(${18 / 24})` }, g);
      icon.innerHTML = iconMarkup(petIconName(graph.nodes[pet].attrs.species));
      svgEl('title', {}, g).textContent = graph.nodes[pet].attrs.name || 'Pet';
      if (selection.has(pet)) svgEl('circle', { class: 'selection', cx: at.x, cy: at.y, r: 19 }, layers.ui);
      svgEl('text', { class: 'tree-dates', x: at.x, y: at.y + 27 }, layers.labels).textContent = graph.nodes[pet].attrs.name || 'Pet';
      nodes[pet] = { x: at.x, y: at.y, width: 28, height: 28 };
      points.push([at.x, at.y + 30]);
    }
  }

  // Groups: a soft dashed outline around the members shown, with the group's name.
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.type !== 'group') continue;
    const members = (node.attrs.members ?? []).map((m) => nodes[m]).filter(Boolean);
    if (!members.length) continue;
    const pad = 16;
    const x0 = Math.min(...members.map((n) => n.x - n.width / 2)) - pad - 34;
    const x1 = Math.max(...members.map((n) => n.x + n.width / 2)) + pad + 34;
    const y0 = Math.min(...members.map((n) => n.y - n.height / 2)) - pad - 14;
    const y1 = Math.max(...members.map((n) => n.y + n.height / 2)) + pad + 26; // room for the names
    const rect = svgEl('rect', { class: 'group tree-group', 'data-id': id, x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 24 }, layers.background);
    svgEl('title', {}, rect).textContent = `${node.attrs.label || 'Group'} (click to edit)`;
    svgEl('text', { class: 'group-label', x: x0 + 14, y: y0 + 15 }, layers.labels).textContent = node.attrs.label || 'Group';
    if (selection.has(id)) svgEl('rect', { class: 'selection', x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 24 }, layers.ui);
    points.push([x0, y0], [x1, y1]);
  }

  // Other relations (godparent…): a dotted arc above the two people, with its label.
  for (const e of graph.edges) {
    if (e.type !== 'custom' || !nodes[e.from] || !nodes[e.to]) continue;
    const a = nodes[e.from];
    const b = nodes[e.to];
    const mx = (a.x + b.x) / 2;
    const top = Math.min(a.y, b.y) - 70 - Math.abs(a.x - b.x) * 0.12;
    svgEl('path', { class: 'edge edge-custom tree-relation', d: `M ${a.x} ${a.y - NODE_RADIUS} Q ${mx} ${top} ${b.x} ${b.y - NODE_RADIUS}` }, layers.edges);
    if (e.attrs?.label) {
      const y = (Math.min(a.y, b.y) - NODE_RADIUS + top) / 2 - 4;
      svgEl('text', { class: 'edge-label tree-relation-label', x: mx, y }, layers.labels).textContent = e.attrs.label;
      points.push([mx, y - 12]);
    }
  }

  // The ground, and each family's name under its trunk.
  const xs = points.map(([x]) => x);
  svgEl('path', {
    class: 'tree-ground',
    d: `M ${Math.min(...xs) - 400} ${ground + 6} Q ${(Math.min(...xs) + Math.max(...xs)) / 2} ${ground - 24} ${Math.max(...xs) + 400} ${ground + 6} V ${ground + 4000} H ${Math.min(...xs) - 400} Z`,
  }, layers.background);
  for (const f of families) {
    if (hidden.has(f.id) || !P(f.id)) continue;
    svgEl('text', { class: 'tree-family', x: P(f.id).x, y: ground + 34 }, layers.labels).textContent = f.name;
  }
  points.push([Math.min(...xs), ground + 44]);

  const x0 = Math.min(...points.map(([x]) => x));
  const x1 = Math.max(...points.map(([x]) => x));
  const y0 = Math.min(...points.map(([, y]) => y));
  const y1 = Math.max(...points.map(([, y]) => y));
  return { nodes, bounds: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, families };
}
