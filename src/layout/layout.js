// Generational layout for one graph (ADR 0008). A pure function: graph in,
// positions out. Steps:
//   1. rank   — generation per person; partners share a rank, children sit below parents
//   2. order  — partners kept adjacent in "blocks"; blocks ordered by barycentre sweeps
//   3. place  — x by centring children under their union and parents over their children,
//               resolving overlaps per row; y = rank × row height
//   4. manual moves — attrs.nudge {dx, dy} offsets a card from its automatic position
//               (set by dragging); cards it would cover are pushed aside along their row,
//               and partnership dots move with their partners (ADR 0019)
// Orientation 'TB' (generations top to bottom, default) or 'LR' (left to right): the
// core layout always runs top-down, with card sizes swapped for 'LR', then is rotated.

export const LAYOUT_DEFAULTS = {
  cardWidth: 160,
  cardHeight: 56,
  unionWidth: 32, // horizontal room for the union dot between partners
  gap: 24, // minimum horizontal gap between blocks
  rankGap: 72, // vertical gap between generations
  sweeps: 4,
  orientation: 'TB', // 'TB' or 'LR'
  preview: null, // { [nodeId]: { dx, dy } } extra offsets while a drag is in progress
};

export const ORIENTATIONS = ['TB', 'LR'];

export function layoutGraph(graph, options = {}) {
  const o = { ...LAYOUT_DEFAULTS, ...options };
  o.orientation = ORIENTATIONS.includes(o.orientation) ? o.orientation : 'TB';
  const lr = o.orientation === 'LR';
  // Left to right = top-down with each card's width and height swapped, then rotated.
  const core = lr ? { ...o, cardWidth: o.cardHeight, cardHeight: o.cardWidth } : o;
  const rel = relations(graph);
  const rank = assignRanks(graph, rel);
  const rows = buildRows(graph, rel, rank, core);
  orderRows(rows, rel, core.sweeps);
  placeRows(rows, rel, core);

  const rowHeight = core.cardHeight + core.rankGap;
  const nodes = {};
  for (const row of rows) {
    for (const block of row) {
      for (const item of block.items) {
        const along = block.left + item.offset + item.width / 2;
        const across = item.rank * rowHeight;
        nodes[item.id] = {
          kind: item.kind,
          rank: item.rank,
          x: lr ? across : along,
          y: lr ? along : across,
          width: item.kind === 'union' ? 0 : o.cardWidth,
          height: item.kind === 'union' ? 0 : o.cardHeight,
        };
      }
    }
  }
  applyManualMoves(graph, rel, nodes, o);
  return { nodes, bounds: bounds(nodes), options: o };
}

// --- relations ----------------------------------------------------------------

function relations(graph) {
  const partnersOf = new Map(); // union → persons
  const childrenOf = new Map(); // union → persons
  const unionsOf = new Map(); // person → unions they are a partner in
  const parentUnionsOf = new Map(); // person → unions they are a child of
  const add = (map, key, value) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  };
  const type = (id) => graph.nodes[id]?.type;
  for (const e of graph.edges) {
    if (e.type === 'partner' && type(e.from) === 'person' && type(e.to) === 'union') {
      add(partnersOf, e.to, e.from);
      add(unionsOf, e.from, e.to);
    } else if (e.type === 'child' && type(e.from) === 'union' && type(e.to) === 'person') {
      add(childrenOf, e.from, e.to);
      add(parentUnionsOf, e.to, e.from);
    }
  }
  const get = (map) => (id) => map.get(id) ?? [];
  return {
    partners: get(partnersOf),
    children: get(childrenOf),
    unions: get(unionsOf),
    parentUnions: get(parentUnionsOf),
  };
}

// --- 1. ranks -------------------------------------------------------------------

function assignRanks(graph, rel) {
  const ids = Object.keys(graph.nodes);
  const persons = ids.filter((id) => graph.nodes[id].type === 'person');
  const unions = ids.filter((id) => graph.nodes[id].type === 'union');
  const rank = new Map(persons.map((p) => [p, 0]));

  // Relax constraints until stable. Ranks only grow, and validation forbids ancestry
  // cycles, but odd (valid) data such as marrying a grandchild's child can still keep
  // pushing, so the loop is capped.
  let changed = true;
  for (let i = 0; changed && i < persons.length * 2 + 2; i++) {
    changed = false;
    const raise = (p, r) => {
      if (r > rank.get(p)) {
        rank.set(p, r);
        changed = true;
      }
    };
    for (const u of unions) {
      const partners = rel.partners(u);
      if (!partners.length) continue;
      const r = Math.max(...partners.map((p) => rank.get(p)));
      for (const p of partners) raise(p, r);
      for (const c of rel.children(u)) raise(c, r + 1);
    }
    // Someone with no parents in this graph sits just above their children
    // instead of floating up to the top row.
    for (const p of persons) {
      if (rel.parentUnions(p).length) continue;
      const kids = rel.unions(p).flatMap(rel.children);
      if (kids.length) raise(p, Math.min(...kids.map((c) => rank.get(c))) - 1);
    }
  }

  const all = new Map(rank);
  for (const u of unions) {
    const partners = rel.partners(u);
    const kids = rel.children(u);
    if (partners.length) all.set(u, Math.max(...partners.map((p) => rank.get(p))));
    else if (kids.length) all.set(u, Math.max(0, Math.min(...kids.map((c) => rank.get(c))) - 1));
    else all.set(u, 0);
  }
  for (const id of ids) {
    if (!all.has(id) && graph.nodes[id].type !== 'group') all.set(id, 0);
  }
  return all;
}

// --- 2. rows of blocks ----------------------------------------------------------

// A block is a run of items laid out side by side with no gaps: a person with
// all their same-generation partners and the union dots between them.
function buildRows(graph, rel, rank, o) {
  const seen = new Set();
  const byRank = new Map();
  const item = (id) => {
    const kind = graph.nodes[id].type === 'union' ? 'union' : 'card';
    return { id, kind, rank: rank.get(id), width: kind === 'union' ? o.unionWidth : o.cardWidth, offset: 0 };
  };
  const sameRankUnions = (p) => rel.unions(p).filter((u) => rank.get(u) === rank.get(p));
  const sameRankPartners = (u) => rel.partners(u).filter((p) => rank.get(p) === rank.get(u));

  const emit = (p, seq) => {
    seen.add(p);
    seq.push(item(p));
    for (const u of sameRankUnions(p)) {
      if (seen.has(u)) continue;
      seen.add(u);
      seq.push(item(u));
      for (const q of sameRankPartners(u)) if (!seen.has(q)) emit(q, seq);
    }
  };

  // Start each partner chain at an end (someone with at most one partnership) so
  // that a person with two partners ends up in the middle.
  const component = (start) => {
    const members = [];
    const stack = [start];
    const visited = new Set([start]);
    while (stack.length) {
      const p = stack.pop();
      members.push(p);
      for (const u of sameRankUnions(p)) {
        for (const q of sameRankPartners(u)) {
          if (!visited.has(q)) {
            visited.add(q);
            stack.push(q);
          }
        }
      }
    }
    return members;
  };

  for (const id of Object.keys(graph.nodes)) {
    if (seen.has(id) || !rank.has(id)) continue;
    const type = graph.nodes[id].type;
    const seq = [];
    if (type === 'person') {
      const members = component(id);
      const start = members.find((p) => sameRankUnions(p).length <= 1) ?? id;
      emit(start, seq);
    } else if (type === 'union') {
      if (sameRankPartners(id).length) continue; // emitted with its partners
      seen.add(id);
      seq.push(item(id));
    } else {
      seen.add(id);
      seq.push(item(id));
    }
    let offset = 0;
    for (const it of seq) {
      it.offset = offset;
      offset += it.width;
    }
    const r = rank.get(id);
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push({ items: seq, width: offset, left: 0 });
  }

  const maxRank = Math.max(-1, ...byRank.keys());
  return Array.from({ length: maxRank + 1 }, (_, r) => byRank.get(r) ?? []);
}

function orderRows(rows, rel, sweeps) {
  const position = new Map(); // id → normalised position within its row
  const index = (row) => {
    const flat = row.flatMap((b) => b.items);
    flat.forEach((it, i) => position.set(it.id, flat.length > 1 ? i / (flat.length - 1) : 0.5));
  };
  rows.forEach(index);

  const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  const sortRow = (r, key) => {
    const row = rows[r];
    const keyed = row.map((block, i) => ({ block, key: key(block) ?? position.get(block.items[0].id) ?? i }));
    keyed.sort((a, b) => a.key - b.key);
    rows[r] = keyed.map((k) => k.block);
    index(rows[r]);
  };
  const parentsKey = (block) =>
    mean(block.items.flatMap((it) => rel.parentUnions(it.id)).map((u) => position.get(u)).filter((v) => v !== undefined));
  const childrenKey = (block) =>
    mean(block.items.flatMap((it) => rel.children(it.id)).map((c) => position.get(c)).filter((v) => v !== undefined));

  for (let s = 0; s < sweeps; s++) {
    for (let r = 1; r < rows.length; r++) sortRow(r, parentsKey);
    for (let r = rows.length - 2; r >= 0; r--) sortRow(r, childrenKey);
  }
  for (let r = 1; r < rows.length; r++) sortRow(r, parentsKey);
}

// --- 3. coordinates -------------------------------------------------------------

function placeRows(rows, rel, o) {
  const x = new Map(); // item id → centre x
  const record = (row) => {
    for (const block of row) for (const it of block.items) x.set(it.id, block.left + it.offset + it.width / 2);
  };

  for (const row of rows) {
    let left = 0;
    for (const block of row) {
      block.left = left;
      left += block.width + o.gap;
    }
    record(row);
  }

  const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
  // Desired left edge of a block: average over its items of (target centre − item centre offset).
  const desire = (block, target) => {
    const wants = [];
    for (const it of block.items) {
      const t = target(it.id);
      if (t !== null) wants.push(t - (it.offset + it.width / 2));
    }
    return wants.length ? mean(wants) : block.left;
  };
  const underParents = (id) => {
    const us = rel.parentUnions(id).filter((u) => x.has(u));
    return us.length ? mean(us.map((u) => x.get(u))) : null;
  };
  const overChildren = (id) => {
    const cs = rel.children(id).filter((c) => x.has(c));
    return cs.length ? mean(cs.map((c) => x.get(c))) : null;
  };
  const pass = (r, target) => {
    resolveRow(rows[r], rows[r].map((b) => desire(b, target)), o.gap);
    record(rows[r]);
  };

  for (let r = 1; r < rows.length; r++) pass(r, underParents);
  for (let r = rows.length - 2; r >= 0; r--) pass(r, overChildren);
  for (let r = 1; r < rows.length; r++) pass(r, underParents);

  const minLeft = Math.min(0, ...rows.flatMap((row) => row.map((b) => b.left)));
  for (const row of rows) for (const block of row) block.left -= minLeft;
}

// Places blocks (in fixed order) as close as possible to their desired left
// edges without overlapping: overlapping neighbours merge into a cluster that
// sits at the mean of its members' wishes.
export function resolveRow(blocks, desired, gap) {
  const clusters = [];
  blocks.forEach((block, i) => {
    clusters.push({ start: i, end: i, width: block.width, sum: desired[i], n: 1 });
    while (clusters.length > 1) {
      const a = clusters[clusters.length - 2];
      const b = clusters[clusters.length - 1];
      if (a.sum / a.n + a.width + gap <= b.sum / b.n) break;
      const shift = a.width + gap;
      a.sum += b.sum - shift * b.n;
      a.n += b.n;
      a.width += gap + b.width;
      a.end = b.end;
      clusters.pop();
    }
  });
  for (const c of clusters) {
    let left = c.sum / c.n;
    for (let i = c.start; i <= c.end; i++) {
      blocks[i].left = left;
      left += blocks[i].width + gap;
    }
  }
}

// --- 4. manual moves ---------------------------------------------------------------

// Offsets are relative to the automatic position, so a moved card travels with its
// family when the automatic layout shifts (e.g. after adding someone on the left).
const isNudge = (n) => n && Number.isFinite(n.dx) && Number.isFinite(n.dy);

function applyManualMoves(graph, rel, nodes, o) {
  const moves = new Map(); // card id → { dx, dy } it was moved by (manually or pushed aside)
  for (const [id, n] of Object.entries(nodes)) {
    const stored = graph.nodes[id].attrs?.nudge;
    const extra = o.preview?.[id];
    const dx = (isNudge(stored) ? stored.dx : 0) + (isNudge(extra) ? extra.dx : 0);
    const dy = (isNudge(stored) ? stored.dy : 0) + (isNudge(extra) ? extra.dy : 0);
    if (dx || dy) {
      n.x += dx;
      n.y += dy;
      n.nudged = true;
      moves.set(id, { dx, dy });
    }
  }
  pushAside(nodes, o, moves);
  // A partnership dot moves by the average of its partners' moves, so it stays between
  // two partners and beside a single one.
  for (const [id, n] of Object.entries(nodes)) {
    if (n.kind !== 'union' || n.nudged) continue;
    const partners = rel.partners(id).filter((p) => nodes[p]);
    if (!partners.some((p) => moves.has(p))) continue;
    const zero = { dx: 0, dy: 0 };
    n.x += partners.reduce((s, p) => s + (moves.get(p) ?? zero).dx, 0) / partners.length;
    n.y += partners.reduce((s, p) => s + (moves.get(p) ?? zero).dy, 0) / partners.length;
  }
}

// Cards that a manually moved card would cover are pushed along their row (or column,
// left to right), keeping their order and never onto another card. Moved cards stay
// exactly where the user put them.
function pushAside(nodes, o, moves) {
  const lr = o.orientation === 'LR';
  const along = lr ? 'y' : 'x';
  const across = lr ? 'x' : 'y';
  const size = { x: 'width', y: 'height' };
  const moved = Object.values(nodes).filter((n) => n.nudged && n.kind === 'card');
  if (!moved.length) return;

  const rows = new Map(); // rank → [id, node] of cards that weren't moved
  for (const [id, n] of Object.entries(nodes)) {
    if (n.kind !== 'card' || n.nudged) continue;
    if (!rows.has(n.rank)) rows.set(n.rank, []);
    rows.get(n.rank).push([id, n]);
  }
  for (const row of rows.values()) {
    const [, sample] = row[0];
    const lo = sample[across] - sample[size[across]] / 2;
    const hi = sample[across] + sample[size[across]] / 2;
    const obstacles = moved
      .filter((m) => m[across] + m[size[across]] / 2 > lo && m[across] - m[size[across]] / 2 < hi)
      .map((m) => [m[along] - m[size[along]] / 2, m[along] + m[size[along]] / 2]);
    if (!obstacles.length) continue;
    row.sort(([, a], [, b]) => a[along] - b[along]);
    let cursor = -Infinity;
    for (const [id, n] of row) {
      const length = n[size[along]];
      let start = Math.max(n[along] - length / 2, cursor + o.gap);
      for (let clash = true; clash;) {
        clash = false;
        for (const [a0, a1] of obstacles) {
          if (start < a1 + o.gap && start + length > a0 - o.gap) {
            start = a1 + o.gap;
            clash = true;
          }
        }
      }
      const shift = start + length / 2 - n[along];
      if (shift) {
        n[along] += shift;
        const m = moves.get(id) ?? { dx: 0, dy: 0 };
        if (lr) m.dy += shift;
        else m.dx += shift;
        moves.set(id, m);
      }
      cursor = start + length;
    }
  }
}

function bounds(nodes) {
  const list = Object.values(nodes);
  if (!list.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x0 = Math.min(...list.map((n) => n.x - n.width / 2));
  const y0 = Math.min(...list.map((n) => n.y - n.height / 2));
  const x1 = Math.max(...list.map((n) => n.x + n.width / 2));
  const y1 = Math.max(...list.map((n) => n.y + n.height / 2));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
