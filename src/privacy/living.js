// Privacy filter for sharing (ADR 0018). A shared copy keeps the tree's shape but
// hides living people's details: they appear as "Living", with no dates, places,
// notes or photos. Partnerships between living people lose their dates and place.

import { ulid } from '../store/ids.js';
import { withoutUnusedMedia } from '../store/media.js';

export const LIVING_LABEL = 'Living';
export const ASSUME_DECEASED_AFTER_YEARS = 100;

// First four-digit year in a date as FamTee stores it ("1950-03-14", "ABT 1900", "BET 1950 AND 1960").
export function yearOf(date) {
  const m = /\b(\d{4})\b/.exec(String(date ?? ''));
  return m ? Number(m[1]) : null;
}

// Whether a person must be treated as living. The explicit status wins; otherwise
// anyone without a recorded death is living unless born more than 100 years ago.
// Unknown birth and no death counts as living: when in doubt, protect.
export function isLiving(attrs = {}, now = new Date()) {
  if (attrs.status === 'living') return true;
  if (attrs.status === 'deceased') return false;
  if (attrs.death && (attrs.death.date || attrs.death.place)) return false;
  const born = yearOf(attrs.birth?.date);
  return !(born !== null && now.getFullYear() - born > ASSUME_DECEASED_AFTER_YEARS);
}

// Returns { doc, hidden } where doc is a shared copy of `source` with living people's
// details removed, a new document id, and meta.privacy describing what was done.
// The source document is not changed.
export function privatize(source, { now = new Date() } = {}) {
  const doc = structuredClone(source);
  let hidden = 0;
  for (const graph of Object.values(doc.graphs)) {
    const living = new Set();
    for (const [id, node] of Object.entries(graph.nodes)) {
      if (node.type !== 'person' || !isLiving(node.attrs, now)) continue;
      living.add(id);
      hidden++;
      const { sex, nudge } = node.attrs;
      node.attrs = { name: { given: LIVING_LABEL } };
      if (sex === 'M' || sex === 'F') node.attrs.sex = sex;
      if (nudge) node.attrs.nudge = nudge;
    }
    // A partnership whose partners are all living is private too.
    const partners = new Map();
    for (const e of graph.edges) {
      if (e.type === 'partner') (partners.get(e.to) ?? partners.set(e.to, []).get(e.to)).push(e.from);
    }
    for (const [unionId, ps] of partners) {
      const union = graph.nodes[unionId];
      if (union && ps.length && ps.every((p) => living.has(p))) {
        for (const key of ['start', 'end', 'place']) delete union.attrs[key];
      }
    }
  }
  const sourceHash = source.meta.revision?.hash ?? null;
  doc.meta = {
    ...doc.meta,
    id: ulid(), // a separate document: never mixed with the original's browser session
    title: `${source.meta.title} (shared)`,
    privacy: { livingHidden: hidden, rule: `living unless a death is recorded or born more than ${ASSUME_DECEASED_AFTER_YEARS} years ago`, at: now.toISOString(), sourceHash },
  };
  delete doc.meta.revision;
  return { doc: withoutUnusedMedia(doc), hidden };
}
