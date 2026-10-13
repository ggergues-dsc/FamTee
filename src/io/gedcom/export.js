// FamTee → GEDCOM 5.5.1 (ADR 0010). Two scopes:
//   exportGedcom(doc, graphId)   one graph: persons as INDI, unions as FAM
//   exportGedcomMerged(doc)      every graph as one tree: people joined by same-as
//                                links become one INDI, a couple recorded in several
//                                graphs becomes one FAM
// Both first build a neutral model ({ people, families }) and share one writer.
// GEDCOM has no place for groups, sub-graph tiles, custom relations or layout, so
// those are listed in the returned warnings.

import { writeTag, escapeValue } from './lines.js';
import { dateToGedcom, nameToGedcom } from './convert.js';
import { displayName } from '../../render/format.js';
import { parseEndpoint } from '../../store/schema.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const PEDI = { adopted: 'adopted', foster: 'foster' };

// --- single graph ---------------------------------------------------------------

// Returns { text, stats: { people, families }, warnings }.
export function exportGedcom(doc, graphId, { now = new Date() } = {}) {
  const graph = doc.graphs[graphId];
  if (!graph) throw new Error(`Unknown graph: ${graphId}`);
  const model = { people: [], families: [] };
  for (const [id, n] of Object.entries(graph.nodes)) {
    if (n.type === 'person') model.people.push({ key: id, attrs: n.attrs, names: n.attrs.name ? [n.attrs.name] : [] });
  }
  for (const fam of familiesOf(graph)) model.families.push({ ...fam, key: fam.unionId });

  const linksOut = doc.links.filter((l) => [l.from, l.to].some((ep) => parseEndpoint(ep)?.graphId === graphId)).length;
  const lost = [...lostIn([graph]), [linksOut, 'link(s) to other graphs']];
  const result = writeModel(model, lost, now);
  if (!model.people.length) result.warnings.push('This graph has no people, so the GEDCOM file is empty');
  return result;
}

// --- all graphs, merged -----------------------------------------------------------

// Returns { text, stats: { people, families, graphs }, warnings }.
export function exportGedcomMerged(doc, { now = new Date() } = {}) {
  const order = graphOrder(doc);
  const identity = sameAsIdentities(doc);
  const conflicts = [];

  // People: one record per identity, with the copies' details merged in graph order.
  const copies = new Map(); // identity → [attrs, …]
  for (const graphId of order) {
    for (const [id, n] of Object.entries(doc.graphs[graphId].nodes)) {
      if (n.type !== 'person') continue;
      const key = identity(`${graphId}:${id}`);
      if (!copies.has(key)) copies.set(key, []);
      copies.get(key).push(n.attrs);
    }
  }
  const people = [...copies].map(([key, list]) => mergePerson(key, list, conflicts));

  // Families: the same couple (or the same lone parent with a shared child) recorded
  // in several graphs is one family.
  const families = [];
  for (const graphId of order) {
    for (const fam of familiesOf(doc.graphs[graphId])) {
      const partners = [...new Set(fam.partners.map((p) => identity(`${graphId}:${p}`)))];
      const children = fam.children.map((c) => ({ ...c, key: identity(`${graphId}:${c.key}`) }));
      const couple = [...partners].sort().join('|');
      const same = families.find((f) => f.couple === couple &&
        (partners.length >= 2 || f.children.some((c) => children.some((k) => k.key === c.key))));
      if (!same) {
        families.push({ key: `${graphId}:${fam.unionId}`, couple, attrs: { ...fam.attrs }, partners, children: dedupeChildren(children) });
        continue;
      }
      mergeFields(same.attrs, fam.attrs, ['kind', 'start', 'end', 'place'], () => familyName(same, people), conflicts);
      same.children = dedupeChildren([...same.children, ...children]);
    }
  }

  const graphs = order.map((id) => doc.graphs[id]);
  const customLinks = doc.links.filter((l) => l.type !== 'same-as').length;
  const lost = [...lostIn(graphs), [customLinks, '"related" link(s) between graphs']];
  const result = writeModel({ people, families }, lost, now);
  if (conflicts.length) {
    const examples = conflicts.slice(0, 3).join('; ');
    result.warnings.push(`${conflicts.length} detail(s) differ between graphs; the first graph's value was used (${examples}${conflicts.length > 3 ? '; …' : ''})`);
  }
  if (!people.length) result.warnings.push('No graph has any people, so the GEDCOM file is empty');
  return { ...result, stats: { ...result.stats, graphs: order.length } };
}

// The root graph first, then graphs reachable through tiles (breadth-first), then any
// others in document order. "First graph wins" follows this order.
export function graphOrder(doc) {
  const order = [];
  const queue = [doc.meta.rootGraph];
  while (queue.length) {
    const id = queue.shift();
    if (order.includes(id) || !doc.graphs[id]) continue;
    order.push(id);
    for (const n of Object.values(doc.graphs[id].nodes)) if (n.type === 'graphRef') queue.push(n.attrs.graph);
  }
  for (const id of Object.keys(doc.graphs)) if (!order.includes(id)) order.push(id);
  return order;
}

// Returns endpoint → representative endpoint, following same-as links transitively.
function sameAsIdentities(doc) {
  const parent = new Map();
  const find = (k) => {
    while (parent.has(k)) k = parent.get(k);
    return k;
  };
  for (const l of doc.links) {
    if (l.type !== 'same-as') continue;
    const [a, b] = [find(l.from), find(l.to)];
    if (a !== b) parent.set(b, a);
  }
  return find;
}

function mergePerson(key, list, conflicts) {
  const names = [];
  for (const a of list) {
    if (!a.name) continue;
    const name = typeof a.name === 'string' ? { given: a.name } : a.name;
    const same = (n) => ['given', 'surname', 'suffix'].every((k) => (n[k] ?? '') === (name[k] ?? ''));
    if (!names.some(same)) names.push(name);
  }
  const attrs = {};
  const label = () => displayName({ name: names[0] });
  const sexes = [...new Set(list.map((a) => a.sex).filter((s) => s === 'M' || s === 'F'))];
  if (sexes.length) attrs.sex = sexes[0];
  if (sexes.length > 1) conflicts.push(`${label()}: sex`);
  for (const key of ['birth', 'death']) {
    const merged = {};
    for (const a of list) mergeFields(merged, a[key] ?? {}, ['date', 'place'], () => `${label()}: ${key}`, conflicts);
    if (Object.keys(merged).length) attrs[key] = merged;
  }
  const notes = [...new Set(list.map((a) => a.notes?.trim()).filter(Boolean))];
  if (notes.length) attrs.notes = notes.join('\n\n');
  return { key, attrs, names };
}

// Copies `fields` from `from` into `into` where `into` has none; records a conflict
// when both have different values.
function mergeFields(into, from, fields, describe, conflicts) {
  for (const f of fields) {
    if (from[f] === undefined || from[f] === '') continue;
    if (into[f] === undefined || into[f] === '') into[f] = from[f];
    else if (into[f] !== from[f]) conflicts.push(`${describe()} ${f}`);
  }
}

function dedupeChildren(children) {
  const seen = new Set();
  return children.filter((c) => !seen.has(c.key) && seen.add(c.key));
}

function familyName(fam, people) {
  const names = fam.partners.map((k) => displayName({ name: people.find((p) => p.key === k)?.names[0] }));
  return `family of ${names.join(' & ') || 'unknown parents'}:`;
}

// --- shared ----------------------------------------------------------------------

// Unions with at least one partner or child, as { unionId, attrs, partners, children }.
function familiesOf(graph) {
  const partners = new Map();
  const children = new Map();
  const add = (map, k, v) => (map.get(k) ?? map.set(k, []).get(k)).push(v);
  for (const e of graph.edges) {
    if (e.type === 'partner') add(partners, e.to, e.from);
    if (e.type === 'child') add(children, e.from, { key: e.to, kind: e.attrs?.kind });
  }
  return Object.entries(graph.nodes)
    .filter(([id, n]) => n.type === 'union' && (partners.has(id) || children.has(id)))
    .map(([id, n]) => ({ unionId: id, attrs: n.attrs, partners: partners.get(id) ?? [], children: children.get(id) ?? [] }));
}

// [count, description] pairs for things GEDCOM cannot hold.
function lostIn(graphs) {
  const nodes = graphs.flatMap((g) => Object.values(g.nodes));
  const count = (pred) => nodes.filter(pred).length;
  return [
    [count((n) => n.type === 'group'), 'group(s)'],
    [count((n) => n.type === 'graphRef'), 'sub-graph tile(s)'],
    [graphs.flatMap((g) => g.edges).filter((e) => e.type === 'custom').length, 'custom relation(s)'],
    [count((n) => n.attrs?.nudge), 'manual card position(s)'],
    [count((n) => n.type === 'union' && n.attrs.kind === 'widowed'), '"widowed" status(es) (exported as married)'],
  ];
}

// Writes the model. People and families are written in model order with
// @I1@…/@F1@… references.
function writeModel({ people, families }, lost, now) {
  const warnings = [];
  const out = [];
  const tag = (level, name, value = '', xref = null) => writeTag(out, level, name, value, xref);
  const text = (value) => escapeValue(String(value));
  const byKey = new Map(people.map((p) => [p.key, p]));
  const indiRef = new Map(people.map((p, i) => [p.key, `@I${i + 1}@`]));
  const famRef = new Map(families.map((f, i) => [f, `@F${i + 1}@`]));

  // GEDCOM 5.5.1 families have one HUSB and one WIFE: assign by sex, then fill gaps.
  const roles = new Map();
  for (const fam of families) {
    const role = { HUSB: null, WIFE: null };
    const sex = (k) => byKey.get(k)?.attrs.sex;
    for (const p of fam.partners) {
      if (sex(p) === 'M' && !role.HUSB) role.HUSB = p;
      else if (sex(p) === 'F' && !role.WIFE) role.WIFE = p;
    }
    for (const p of fam.partners) {
      if (p === role.HUSB || p === role.WIFE) continue;
      if (!role.HUSB) role.HUSB = p;
      else if (!role.WIFE) role.WIFE = p;
      else warnings.push('A partnership with more than two partners was exported with only two');
    }
    roles.set(fam, role);
  }

  tag(0, 'HEAD');
  tag(1, 'SOUR', 'FAMTEE');
  tag(2, 'NAME', 'FamTee');
  tag(1, 'DATE', `${now.getUTCDate()} ${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`);
  tag(1, 'SUBM', '@U1@');
  tag(1, 'GEDC');
  tag(2, 'VERS', '5.5.1');
  tag(2, 'FORM', 'LINEAGE-LINKED');
  tag(1, 'CHAR', 'UTF-8');
  tag(0, 'SUBM', '', '@U1@');
  tag(1, 'NAME', 'FamTee');

  let stepChildren = 0;
  for (const person of people) {
    const a = person.attrs;
    tag(0, 'INDI', '', indiRef.get(person.key));
    for (const name of person.names) {
      tag(1, 'NAME', text(nameToGedcom(name)));
      if (typeof name === 'object') {
        if (name.given) tag(2, 'GIVN', text(name.given));
        if (name.surname) tag(2, 'SURN', text(name.surname));
      }
    }
    tag(1, 'SEX', a.sex === 'M' || a.sex === 'F' ? a.sex : 'U');
    for (const [key, name] of [['birth', 'BIRT'], ['death', 'DEAT']]) {
      const ev = a[key];
      if (!ev || (!ev.date && !ev.place)) continue;
      tag(1, name);
      if (ev.date) tag(2, 'DATE', text(dateToGedcom(ev.date)));
      if (ev.place) tag(2, 'PLAC', text(ev.place));
    }
    if (a.notes) tag(1, 'NOTE', text(a.notes));
    for (const fam of families) {
      const asChild = fam.children.find((c) => c.key === person.key);
      if (!asChild) continue;
      tag(1, 'FAMC', famRef.get(fam));
      if (PEDI[asChild.kind]) tag(2, 'PEDI', PEDI[asChild.kind]);
      if (asChild.kind === 'step') stepChildren++;
    }
    for (const fam of families) {
      const { HUSB, WIFE } = roles.get(fam);
      if (HUSB === person.key || WIFE === person.key) tag(1, 'FAMS', famRef.get(fam));
    }
  }

  for (const fam of families) {
    const a = fam.attrs;
    const { HUSB, WIFE } = roles.get(fam);
    tag(0, 'FAM', '', famRef.get(fam));
    if (HUSB) tag(1, 'HUSB', indiRef.get(HUSB));
    if (WIFE) tag(1, 'WIFE', indiRef.get(WIFE));
    for (const c of fam.children) tag(1, 'CHIL', indiRef.get(c.key));
    if (['married', 'divorced', 'widowed'].includes(a.kind) || a.start || a.place) {
      tag(1, 'MARR');
      if (a.start) tag(2, 'DATE', text(dateToGedcom(a.start)));
      if (a.place) tag(2, 'PLAC', text(a.place));
    }
    if (a.kind === 'divorced') {
      tag(1, 'DIV');
      if (a.end) tag(2, 'DATE', text(dateToGedcom(a.end)));
    }
  }
  tag(0, 'TRLR');

  const missing = [...lost, [stepChildren, 'step-child relation(s) (exported as ordinary children)']]
    .filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`);
  if (missing.length) warnings.push(`Not included in GEDCOM: ${missing.join(', ')}`);
  return { text: out.join('\r\n') + '\r\n', stats: { people: people.length, families: families.length }, warnings };
}
