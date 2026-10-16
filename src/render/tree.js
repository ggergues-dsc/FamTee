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
// A couple's branches meet at a fork point this far above them, so partners' limbs rise
// to it instead of running sideways, and children grow up from it.
const FORK_RISE = 58;
// The tree's own layout: narrower slots and taller generations than the cards, so
// branches climb steeply instead of spreading sideways.
export const TREE_LAYOUT = { orientation: 'TB', cardWidth: 124, unionWidth: 12, rankGap: 190 };
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
  // Twins: children of one union sharing a birth group. Fraternal twins sit at slightly
  // different heights (their fork is uneven); identical twins sit level.
  const twinGroups = new Map(); // union → [{ members (left to right), identical }]
  {
    const byKey = new Map();
    for (const e of graph.edges) {
      const g = e.attrs?.birthGroup;
      if (e.type !== 'child' || !g || !layout.nodes[e.to]) continue;
      const key = `${e.from}|${g}`;
      if (!byKey.has(key)) byKey.set(key, { union: e.from, members: [], identical: true });
      byKey.get(key).members.push(e.to);
      byKey.get(key).identical &&= e.attrs.identical === true;
    }
    for (const t of byKey.values()) {
      if (t.members.length < 2) continue;
      t.members.sort((a, b) => layout.nodes[a].x - layout.nodes[b].x);
      (twinGroups.get(t.union) ?? twinGroups.set(t.union, []).get(t.union)).push(t);
    }
  }
  const yShift = new Map();
  for (const groups of twinGroups.values()) {
    for (const t of groups) {
      if (t.identical) continue;
      t.members.forEach((m, k) => yShift.set(m, ((t.members.length - 1) / 2 - k) * 22)); // left lower, right higher
    }
  }
  const rawP = (id) => {
    const n = layout.nodes[id];
    return n ? { x: n.x, y: -n.y + (yShift.get(id) ?? 0) } : null;
  };
  // Founding couples sit on their trunk (set below, once the ground is known), so no
  // branch ever hangs down to them; everyone else is where the layout put them.
  const founderAt = new Map();
  const P = (id) => founderAt.get(id) ?? rawP(id);
  const fork = (u) => ({ x: P(u).x, y: P(u).y - FORK_RISE });
  const shown = (p) => [...s.familiesOf(p)].some((t) => !hidden.has(t));
  const tone = (p) => toneOf.get([...s.familiesOf(p)].find((t) => !hidden.has(t)) ?? [...s.familiesOf(p)][0]) ?? 0;

  const people = Object.keys(graph.nodes).filter((id) => graph.nodes[id].type === 'person' && P(id) && shown(id));
  const visible = new Set(people);
  const unions = Object.keys(graph.nodes).filter((id) => graph.nodes[id].type === 'union' && P(id) &&
    s.partners(id).some((p) => visible.has(p)));
  if (!people.length) return { nodes: {}, bounds: { x: 0, y: 0, width: 0, height: 0 }, families };

  const ys = people.map((p) => rawP(p).y);
  const ground = Math.max(...ys) + TRUNK_HEIGHT;
  // The founders of each trunk: side by side on the trunk, halfway between the ground and
  // the fork where its first branches start (a name plate on the trunk, not a low branch).
  const founderSide = new Map(); // founder → -1 left / 1 right / 0 alone
  for (const t of s.trunks) {
    if (hidden.has(t) || graph.nodes[t].type !== 'union' || !rawP(t)) continue;
    const f = fork(t);
    const founders = s.partners(t).filter((p) => visible.has(p)).sort((a, b) => rawP(a).x - rawP(b).x);
    founders.forEach((p, k) => {
      const offset = k - (founders.length - 1) / 2;
      founderAt.set(p, { x: f.x + offset * (2 * NODE_RADIUS + 4), y: f.y + (ground - f.y) * 0.5 });
      founderSide.set(p, Math.sign(offset));
    });
  }
  const canopy = svgEl('g', { class: 'tree-canopy' }, layers.background);
  const wood = svgEl('g', { class: 'tree-wood' }, layers.edges);
  const nodes = {};
  const points = [];

  // A tapered limb along a cubic curve, as a filled outline; `caps` rounds its ends.
  function limb(rand, p0, c1, c2, p1, w0, w1, caps = 'both', cls = 'tree-limb') {
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
    svgEl('path', { class: cls, d: `M ${left.join(' L ')} L ${right.reverse().join(' L ')} Z`, style: `fill: ${fill}` }, wood);
    if (caps === 'both' || caps === 'start') svgEl('circle', { class: 'tree-limb', cx: p0[0], cy: p0[1], r: w0 / 2, style: `fill: ${fill}` }, wood);
    if (caps === 'both' || caps === 'end') svgEl('circle', { class: 'tree-limb', cx: p1[0], cy: p1[1], r: w1 / 2, style: `fill: ${fill}` }, wood);
  }
  const vary = (rand, v, amount = 0.05) => v * (1 + (rand() * 2 - 1) * amount);
  const width = (n) => Math.min(30, 5 + 4 * Math.sqrt(n));
  // A branch from a to b, leaving a upward and arriving at b; `key` seeds its variation.
  // The control points are spaced evenly in height, so the branch climbs the whole way
  // (it never flattens into a sideways run); it leaves and arrives close to upright and
  // does its sideways travel in between, as real branches do.
  function branch(key, a, b, w, caps = 'both') {
    const rand = randomFor(docKey + key);
    const dx = b.x - a.x;
    const dy = a.y - b.y;
    const base = vary(rand, w);
    limb(rand, [a.x, a.y], [a.x + dx * vary(rand, 0.15, 0.3), a.y - dy * vary(rand, 0.34)],
      [b.x - dx * vary(rand, 0.12, 0.3), b.y + dy * vary(rand, 0.32)], [b.x, b.y], base, vary(rand, base * 0.72), caps);
  }

  // Trunks, with a short root flare, up to each founding partnership (or lone founder).
  for (const t of s.trunks) {
    if (hidden.has(t) || !P(t)) continue;
    const top = graph.nodes[t].type === 'person' ? P(t) : fork(t);
    const n = graph.nodes[t].type === 'person' ? s.grows(t) : s.partners(t).reduce((sum, p) => sum + s.grows(p), 0);
    const w = Math.min(34, width(n) * 1.15);
    const rand = randomFor(`${docKey}${t}:roots`);
    for (const dx of [-1, 1]) {
      const ex = top.x + vary(rand, dx * w * 1.15, 0.1);
      limb(rand, [top.x + dx * w * 0.15, ground - 12], [top.x + dx * w * 0.4, ground - 7], [ex - dx * 10, ground + 4], [ex, ground + 6],
        vary(rand, w * 0.5), vary(rand, 2.5), 'none', 'tree-root');
    }
    limb(rand, [top.x, ground - 8], [top.x, ground - 4], [top.x, ground + 6], [vary(rand, top.x, 0.002), ground + 11], vary(rand, w * 0.45), 3, 'none', 'tree-root');
    branch(`${t}:trunk`, { x: top.x, y: ground }, top, w, 'end');
    points.push([top.x, ground + 30]);
  }

  // Partnerships: partners join the union point; children and pets grow up from it.
  for (const u of unions) {
    const at = fork(u);
    const ps = s.partners(u).filter((p) => visible.has(p));
    const lineages = ps.filter((p) => s.hasParents(p));
    const kids = s.children(u).filter((c) => visible.has(c) && P(c));
    const weight = kids.reduce((sum, c) => sum + s.grows(c), 0);
    // founders sit on their trunk, which carries their branches: no limbs to them
    for (const p of s.trunks.includes(u) ? [] : ps) {
      // someone with parents here carries the branch on to the partnership; a founder or
      // someone who married in joins it with a short limb
      const w = s.hasParents(p) ? width(weight + 1) * 0.9 : Math.max(5, width(weight) * 0.45);
      branch(`${u}:${p}`, P(p), at, w);
    }
    const groups = (twinGroups.get(u) ?? []).map((t) => ({ ...t, members: t.members.filter((m) => kids.includes(m)) }))
      .filter((t) => t.members.length >= 2);
    const inGroup = new Set(groups.flatMap((t) => t.members));
    for (const c of kids) if (!inGroup.has(c)) branch(`${u}>${c}`, at, P(c), width(s.grows(c)));
    for (const t of groups) drawTwins(u, at, t);
    for (const pet of s.pets(u)) {
      const q = P(pet);
      if (q) branch(`${u}>${pet}`, at, q, 3);
    }
    if (lineages.length >= 2) {
      svgEl('circle', { class: 'tree-graft', cx: at.x, cy: at.y, r: 8 }, layers.labels);
      svgEl('title', {}, layers.labels.lastChild).textContent = 'Two families joined by this partnership';
    }
  }

  // Twins grow from one shared twig. Identical twins: it splits at a single point into
  // mirror-image twigs (same length and thickness, no variation) and a small link joins
  // them. Fraternal twins: an uneven fork, each branching off the twig at its own height.
  function drawTwins(u, at, t) {
    const pts = t.members.map(P);
    const n = t.members.reduce((sum, m) => sum + s.grows(m), 0);
    const meanX = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
    const meanY = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
    const split = { x: meanX, y: at.y - (at.y - meanY) * 0.55 };
    if (t.identical) {
      branch(`${u}>twins:${t.members[0]}`, at, split, width(n) * 0.95);
      const w = width(s.grows(t.members[0]));
      const rand = randomFor(`${docKey}${u}:identical`);
      for (const p of pts) {
        const dx = p.x - split.x;
        const dy = split.y - p.y;
        limb(rand, [split.x, split.y], [split.x + dx * 0.15, split.y - dy * 0.34], [p.x - dx * 0.12, p.y + dy * 0.32], [p.x, p.y], w, w * 0.72);
      }
      for (let k = 1; k < pts.length; k++) {
        const [a, b] = [pts[k - 1], pts[k]];
        svgEl('path', { class: 'tree-twin-link', d: `M ${a.x + NODE_RADIUS + 2} ${a.y} L ${b.x - NODE_RADIUS - 2} ${b.y}` }, wood);
        svgEl('circle', { class: 'tree-twin-knot', cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, r: 5 }, wood);
      }
      return;
    }
    // fraternal: the twig climbs past each twin in turn, from the lowest to the highest
    const low = { x: meanX - 6, y: split.y + 14 };
    const high = { x: meanX + 8, y: split.y - 22 };
    const along = (k) => (pts.length === 1 ? low : { x: low.x + ((high.x - low.x) * k) / (pts.length - 1), y: low.y + ((high.y - low.y) * k) / (pts.length - 1) });
    branch(`${u}>twins:${t.members[0]}`, at, low, width(n) * 0.95);
    t.members.forEach((m, k) => {
      if (k > 0) branch(`${u}>twins:${m}:twig`, along(k - 1), along(k), width(n - k) * 0.85);
      branch(`${u}>${m}`, along(k), P(m), width(s.grows(m)));
    });
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
    // names go below, except a founding couple's, beside them on either side of the trunk
    const side = founderSide.get(p) ?? 0;
    const label = side
      ? { x: at.x + side * (NODE_RADIUS + 6), y: at.y - 1, anchor: side < 0 ? 'end' : 'start', gap: 13 }
      : { x: at.x, y: at.y + NODE_RADIUS + 15, anchor: 'middle', gap: 13 };
    const name = svgEl('text', { class: 'tree-name', x: label.x, y: label.y, style: `text-anchor: ${label.anchor}` }, layers.labels);
    name.textContent = fitText(displayName(node.attrs), 120);
    const dates = lifespan(node.attrs);
    if (dates) {
      svgEl('text', { class: 'tree-dates', x: label.x, y: label.y + label.gap, style: `text-anchor: ${label.anchor}` }, layers.labels).textContent = dates;
    }
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
    // a thin strip of ground under the trunks, gently domed
    d: `M ${Math.min(...xs) - 120} ${ground + 4} Q ${(Math.min(...xs) + Math.max(...xs)) / 2} ${ground - 14} ${Math.max(...xs) + 120} ${ground + 4} V ${ground + 18} Q ${(Math.min(...xs) + Math.max(...xs)) / 2} ${ground + 8} ${Math.min(...xs) - 120} ${ground + 18} Z`,
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
