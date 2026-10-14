// GEDCOM → FamTee (ADR 0010). A GEDCOM file becomes one new graph: INDI records
// become persons, FAM records become unions with partner and child edges. Everything
// else is counted and reported, not silently dropped.

import { newId } from '../../store/ids.js';
import { getGraph, addGraphRef, createDocument } from '../../store/model.js';
import { parseGedcom, child, childrenOf, valueOf, unescapeValue } from './lines.js';
import { dateFromGedcom, nameFromGedcom } from './convert.js';

const INDI_TAGS = new Set(['NAME', 'SEX', 'BIRT', 'DEAT', 'OCCU', 'NOTE', 'FAMC', 'FAMS', 'CHAN']);
const FAM_TAGS = new Set(['HUSB', 'WIFE', 'CHIL', 'MARR', 'DIV', 'NOTE', 'CHAN']);
const PEDIGREE = { adopted: 'adopted', foster: 'foster', birth: 'biological' };

export function looksLikeGedcom(text) {
  return /^\uFEFF?\s*0\s+HEAD\b/.test(text);
}

// Returns { graph: { title, nodes, edges }, stats, warnings }. Throws when the file
// has no individuals.
export function importGedcom(text, { title = 'Imported family' } = {}) {
  const { records, warnings } = parseGedcom(text);
  const skipped = new Map();
  const skip = (tag) => skipped.set(tag, (skipped.get(tag) ?? 0) + 1);

  const head = records.find((r) => r.tag === 'HEAD');
  if (!head) throw new Error('Not a GEDCOM file (no HEAD record)');
  const version = valueOf(child(head, 'GEDC'), 'VERS');
  const charset = valueOf(head, 'CHAR').toUpperCase();
  if (version && !version.startsWith('5.5')) warnings.push(`GEDCOM ${version} was read as 5.5.1; some details may be missing`);
  if (charset && !['UTF-8', 'UTF8', 'ASCII'].includes(charset)) {
    warnings.push(`The file says its text is ${charset}; accented letters may look wrong (save it as UTF-8 to fix)`);
  }

  const notes = new Map(records.filter((r) => r.tag === 'NOTE' && r.xref).map((r) => [r.xref, r.value]));
  const noteText = (node) => {
    const v = node.value.trim();
    return unescapeValue(notes.get(v) ?? node.value);
  };

  const nodes = {};
  const edges = [];
  const personIds = new Map(); // GEDCOM xref → FamTee id
  const pedigree = new Map(); // `${famXref} ${indiXref}` → child kind
  const event = (node) => {
    const date = valueOf(node, 'DATE');
    const place = valueOf(node, 'PLAC');
    const result = {};
    if (date) result.date = unescapeValue(dateFromGedcom(date));
    if (place) result.place = unescapeValue(place);
    return result;
  };

  for (const indi of records.filter((r) => r.tag === 'INDI')) {
    if (!indi.xref) {
      warnings.push(`Individual on line ${indi.line} has no ID and was skipped`);
      continue;
    }
    const attrs = {};
    const nameNode = child(indi, 'NAME');
    for (let i = 1; i < childrenOf(indi, 'NAME').length; i++) skip('NAME (additional names)');
    if (nameNode) {
      const name = nameFromGedcom(unescapeValue(nameNode.value), valueOf(nameNode, 'GIVN'), valueOf(nameNode, 'SURN'));
      if (Object.keys(name).length) attrs.name = name;
    }
    const sex = valueOf(indi, 'SEX').toUpperCase();
    if (sex === 'M' || sex === 'F') attrs.sex = sex;
    for (const [tag, key] of [['BIRT', 'birth'], ['DEAT', 'death']]) {
      const ev = child(indi, tag);
      if (ev && Object.keys(event(ev)).length) attrs[key] = event(ev);
    }
    // Occupation: the job title, with its agency (AGNC) as the employer.
    const occu = child(indi, 'OCCU');
    if (occu?.value.trim()) attrs.occupation = unescapeValue(occu.value.trim());
    if (valueOf(occu, 'AGNC')) attrs.employer = unescapeValue(valueOf(occu, 'AGNC'));
    for (let i = 1; i < childrenOf(indi, 'OCCU').length; i++) skip('OCCU (additional occupations)');
    const noteParts = childrenOf(indi, 'NOTE').map(noteText).filter((t) => t.trim());
    if (noteParts.length) attrs.notes = noteParts.join('\n\n');
    for (const famc of childrenOf(indi, 'FAMC')) {
      const kind = PEDIGREE[valueOf(famc, 'PEDI').toLowerCase()];
      if (kind) pedigree.set(`${famc.value.trim()} ${indi.xref}`, kind);
    }
    for (const c of indi.children) if (!INDI_TAGS.has(c.tag)) skip(c.tag);

    const id = newId('person');
    nodes[id] = { type: 'person', attrs };
    personIds.set(indi.xref, id);
  }
  if (!personIds.size) throw new Error('This GEDCOM file contains no individuals');

  let families = 0;
  for (const fam of records.filter((r) => r.tag === 'FAM')) {
    const resolve = (ref, role) => {
      const id = personIds.get(ref.value.trim());
      if (!id) warnings.push(`Family ${fam.xref ?? `on line ${fam.line}`} refers to unknown ${role} ${ref.value.trim()}`);
      return id;
    };
    const partners = [...childrenOf(fam, 'HUSB'), ...childrenOf(fam, 'WIFE')].map((r) => resolve(r, 'partner')).filter(Boolean);
    const kids = childrenOf(fam, 'CHIL').map((r) => [r.value.trim(), resolve(r, 'child')]).filter(([, id]) => id);
    if (!partners.length && !kids.length) continue;

    const attrs = {};
    const marr = child(fam, 'MARR');
    const div = child(fam, 'DIV');
    // No MARR record: a couple is recorded as partners, not assumed married.
    attrs.kind = div ? 'divorced' : partners.length < 2 ? 'single' : marr ? 'married' : 'partner';
    if (marr?.children.length) {
      const ev = event(marr);
      if (ev.date) attrs.start = ev.date;
      if (ev.place) attrs.place = ev.place;
    }
    if (div && valueOf(div, 'DATE')) attrs.end = dateFromGedcom(valueOf(div, 'DATE'));
    for (const c of fam.children) if (!FAM_TAGS.has(c.tag)) skip(c.tag);

    const unionId = newId('union');
    nodes[unionId] = { type: 'union', attrs };
    for (const p of new Set(partners)) edges.push({ id: newId('edge'), type: 'partner', from: p, to: unionId, attrs: {} });
    for (const [xref, kidId] of kids) {
      const kind = pedigree.get(`${fam.xref} ${xref}`) ?? 'biological';
      edges.push({ id: newId('edge'), type: 'child', from: unionId, to: kidId, attrs: { kind } });
    }
    families++;
  }

  for (const r of records) {
    if (!['HEAD', 'INDI', 'FAM', 'TRLR', 'NOTE', 'SUBM'].includes(r.tag)) skip(r.tag);
  }
  if (skipped.size) {
    const list = [...skipped].sort((a, b) => b[1] - a[1]).map(([tag, n]) => `${n} × ${tag}`).join(', ');
    warnings.push(`Not imported (FamTee doesn't store these yet): ${list}`);
  }

  return {
    graph: { title, nodes, edges },
    stats: { people: personIds.size, families },
    warnings,
  };
}

// Adds an imported graph to the document with a tile in `parentGraphId`.
// Returns the new graph's id. Use inside Store.apply so it is validated and undoable.
export function addImportedGraph(doc, parentGraphId, graph) {
  getGraph(doc, parentGraphId);
  const graphId = newId('graph');
  doc.graphs[graphId] = structuredClone(graph);
  addGraphRef(doc, parentGraphId, graphId, { label: graph.title });
  return graphId;
}

// A new document whose only tree is the imported graph (the start screen's and
// Open…'s way of opening a GEDCOM file).
export function documentFromGedcom(graph) {
  const doc = createDocument({ title: graph.title, graphTitle: graph.title });
  doc.graphs[doc.meta.rootGraph] = structuredClone(graph);
  return doc;
}
