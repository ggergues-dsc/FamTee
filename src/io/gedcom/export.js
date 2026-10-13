// FamTee → GEDCOM 5.5.1 (ADR 0010). Exports one graph: persons as INDI, unions as
// FAM. GEDCOM has no place for groups, cross-graph links, sub-graph tiles, custom
// relations or layout, so those are listed in the returned warnings.

import { writeTag, escapeValue } from './lines.js';
import { dateToGedcom, nameToGedcom } from './convert.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const PEDI = { adopted: 'adopted', foster: 'foster' };

// Returns { text, stats: { people, families }, warnings }.
export function exportGedcom(doc, graphId, { now = new Date() } = {}) {
  const graph = doc.graphs[graphId];
  if (!graph) throw new Error(`Unknown graph: ${graphId}`);
  const warnings = [];
  const out = [];
  const tag = (level, name, value = '', xref = null) => writeTag(out, level, name, value, xref);
  const text = (value) => escapeValue(String(value));

  const entries = Object.entries(graph.nodes);
  const persons = entries.filter(([, n]) => n.type === 'person').map(([id]) => id);
  const partnersOf = new Map();
  const childEdgesOf = new Map();
  for (const e of graph.edges) {
    if (e.type === 'partner') (partnersOf.get(e.to) ?? partnersOf.set(e.to, []).get(e.to)).push(e.from);
    if (e.type === 'child') (childEdgesOf.get(e.from) ?? childEdgesOf.set(e.from, []).get(e.from)).push(e);
  }
  const unions = entries
    .filter(([id, n]) => n.type === 'union' && ((partnersOf.get(id)?.length ?? 0) + (childEdgesOf.get(id)?.length ?? 0)) > 0)
    .map(([id]) => id);

  const indiRef = new Map(persons.map((id, i) => [id, `@I${i + 1}@`]));
  const famRef = new Map(unions.map((id, i) => [id, `@F${i + 1}@`]));

  // GEDCOM 5.5.1 families have one HUSB and one WIFE: assign by sex, then fill gaps.
  const roles = new Map();
  for (const u of unions) {
    const partners = partnersOf.get(u) ?? [];
    const role = { HUSB: null, WIFE: null };
    const sex = (p) => graph.nodes[p].attrs.sex;
    for (const p of partners) {
      if (sex(p) === 'M' && !role.HUSB) role.HUSB = p;
      else if (sex(p) === 'F' && !role.WIFE) role.WIFE = p;
    }
    for (const p of partners) {
      if (p === role.HUSB || p === role.WIFE) continue;
      if (!role.HUSB) role.HUSB = p;
      else if (!role.WIFE) role.WIFE = p;
      else warnings.push(`A partnership with more than two partners was exported with only two`);
    }
    roles.set(u, role);
  }

  // --- header ---
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

  // --- individuals ---
  let stepChildren = 0;
  for (const id of persons) {
    const a = graph.nodes[id].attrs;
    tag(0, 'INDI', '', indiRef.get(id));
    if (a.name) {
      tag(1, 'NAME', text(nameToGedcom(a.name)));
      if (typeof a.name === 'object') {
        if (a.name.given) tag(2, 'GIVN', text(a.name.given));
        if (a.name.surname) tag(2, 'SURN', text(a.name.surname));
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
    for (const u of unions) {
      const edge = (childEdgesOf.get(u) ?? []).find((e) => e.to === id);
      if (!edge) continue;
      tag(1, 'FAMC', famRef.get(u));
      const kind = edge.attrs?.kind;
      if (PEDI[kind]) tag(2, 'PEDI', PEDI[kind]);
      if (kind === 'step') stepChildren++;
    }
    for (const u of unions) {
      const { HUSB, WIFE } = roles.get(u);
      if (HUSB === id || WIFE === id) tag(1, 'FAMS', famRef.get(u));
    }
  }

  // --- families ---
  for (const u of unions) {
    const a = graph.nodes[u].attrs;
    const { HUSB, WIFE } = roles.get(u);
    tag(0, 'FAM', '', famRef.get(u));
    if (HUSB) tag(1, 'HUSB', indiRef.get(HUSB));
    if (WIFE) tag(1, 'WIFE', indiRef.get(WIFE));
    for (const e of childEdgesOf.get(u) ?? []) tag(1, 'CHIL', indiRef.get(e.to));
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

  // --- what GEDCOM could not carry ---
  const count = (pred) => entries.filter(([, n]) => pred(n)).length;
  const lost = [
    [count((n) => n.type === 'group'), 'group(s)'],
    [count((n) => n.type === 'graphRef'), 'sub-graph tile(s)'],
    [graph.edges.filter((e) => e.type === 'custom').length, 'custom relation(s)'],
    [doc.links.filter((l) => [l.from, l.to].some((ep) => ep.startsWith(`${graphId}:`))).length, 'link(s) to other graphs'],
    [count((n) => n.attrs?.nudge), 'manual card position(s)'],
    [stepChildren, 'step-child relation(s) (exported as ordinary children)'],
    [count((n) => n.type === 'union' && n.attrs.kind === 'widowed'), '"widowed" status(es) (exported as married)'],
  ].filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`);
  if (lost.length) warnings.push(`Not included in GEDCOM: ${lost.join(', ')}`);
  if (persons.length === 0) warnings.push('This graph has no people, so the GEDCOM file is empty');

  return { text: out.join('\r\n') + '\r\n', stats: { people: persons.length, families: unions.length }, warnings };
}
