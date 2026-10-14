// Person snapshot: a small read-only summary that floats beside a card while the
// pointer is over it (or a card has keyboard focus). Clicking still opens the editor.
//
// personSummary() is pure (document in, rows out) so it can be unit-tested; the
// snapshot itself only places that summary next to the card.

import { h } from './dom.js';
import { portrait, icon, jobIconName } from './icons.js';
import { displayName, lifespan } from '../render/format.js';
import { isLiving } from '../privacy/living.js';
import { unionsOfPerson, parentUnionsOf, partnersOfUnion, groupsOf, linksOf, petsOfUnion } from '../store/family.js';
import { countryOf, flagMarkup } from '../render/flags.js';

const GAP = 12; // px between the card and the snapshot

const place = (event) => [event?.date, event?.place].filter(Boolean).join(' · ');
const names = (graph, ids) => ids.map((id) => displayName(graph.nodes[id]?.attrs)).join(', ');

// { name, dates, sex, living, rows: [[label, text]] } for a person in a graph.
export function personSummary(doc, graphId, personId, now = new Date()) {
  const graph = doc.graphs[graphId];
  const attrs = graph.nodes[personId].attrs;
  const unions = unionsOfPerson(graph, personId);
  const parents = parentUnionsOf(graph, personId).flatMap((u) => partnersOfUnion(graph, u));
  const partners = unions.flatMap(({ unionId, partners: ids }) => ids.map((id) => {
    const u = graph.nodes[unionId].attrs;
    const how = [u.kind && u.kind !== 'single' ? u.kind : '', u.start ?? ''].filter(Boolean).join(' ');
    return `${displayName(graph.nodes[id].attrs)}${how ? ` (${how})` : ''}`;
  }));
  const children = unions.flatMap((u) => u.children);
  const pets = unions.flatMap((u) => petsOfUnion(graph, u.unionId)).map((id) => {
    const pet = graph.nodes[id].attrs;
    return `${pet.name?.trim() || 'Unnamed pet'}${pet.species === 'dog' || pet.species === 'cat' ? ` (${pet.species})` : ''}`;
  });
  const groups = groupsOf(graph, personId).map((id) => graph.nodes[id].attrs.label || 'Group');
  const elsewhere = linksOf(doc, graphId, personId).map(({ link, other }) => {
    const where = doc.graphs[other.graphId]?.title ?? other.graphId;
    return link.type === 'same-as' ? `Same person in ${where}` : `${link.attrs?.label || 'Related'} (${where})`;
  });
  const rows = [
    ['Born', place(attrs.birth)],
    ['Died', place(attrs.death)],
    ['Job', attrs.occupation?.trim() ?? ''],
    ['Employer', attrs.employer?.trim() ?? ''],
    ['Parents', names(graph, parents)],
    [partners.length > 1 ? 'Partners' : 'Partner', partners.join('; ')],
    ['Children', names(graph, children)],
    ['Pets', pets.join(', ')],
    ['Groups', groups.join(', ')],
    ['Elsewhere', elsewhere.join('; ')],
  ].filter(([, text]) => text);
  return {
    name: displayName(attrs),
    dates: lifespan(attrs),
    sex: attrs.sex,
    living: isLiving(attrs, now),
    country: countryOf(attrs.birth?.place),
    rows,
  };
}

// A small flag before the birthplace, and the trade icon before the job.
function mark(label, text, s) {
  if (label === 'Born' && s.country) {
    const flag = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    flag.setAttribute('class', 'snapshot-flag');
    flag.setAttribute('viewBox', '0 0 15 10');
    flag.setAttribute('role', 'img');
    flag.setAttribute('aria-label', s.country);
    flag.innerHTML = flagMarkup(s.country);
    return flag;
  }
  if (label === 'Job') return icon(jobIconName(text));
  return null;
}

// host: a positioned element the snapshot is placed in; area: the element it must stay
// inside (the canvas, so it never covers the side panel).
export function createSnapshot(host, area = host) {
  let current = null; // { el, key }

  function hide() {
    current?.el.remove();
    current = null;
  }

  // Shows the snapshot for a person beside `cardEl` (an element on the canvas).
  function show(doc, graphId, personId, cardEl) {
    const key = `${graphId}:${personId}`;
    if (current?.key === key) return;
    hide();
    const s = personSummary(doc, graphId, personId);
    const el = h('div', { class: 'snapshot', role: 'tooltip' },
      h('div', { class: 'snapshot-head' },
        h('span', { class: 'snapshot-portrait' }, portrait(s.sex)),
        h('div', { class: 'snapshot-title' }, h('b', {}, s.name), s.dates ? h('span', {}, s.dates) : null),
        h('span', { class: `chip ${s.living ? 'living' : 'deceased'}` }, s.living ? 'Living' : 'Deceased')),
      s.rows.length ? h('dl', {}, s.rows.flatMap(([label, text]) => [h('dt', {}, label), h('dd', {}, mark(label, text, s), text)])) : null,
      h('p', { class: 'snapshot-foot' }, 'Click to edit'));
    host.append(el);
    current = { el, key };

    // Right of the card, or left when there is no room; always inside the area.
    const card = cardEl.getBoundingClientRect();
    const frame = host.getBoundingClientRect();
    const box = area.getBoundingClientRect();
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    const right = card.right + GAP;
    const left = card.left - GAP - w;
    const onRight = right + w <= box.right - 8 || left < box.left + 8;
    const x = onRight ? Math.min(right, box.right - 8 - w) : left;
    const y = Math.min(Math.max(box.top + 8, card.top + card.height / 2 - 24), Math.max(box.top + 8, box.bottom - hgt - 8));
    el.classList.add(onRight ? 'on-right' : 'on-left');
    el.style.left = `${Math.max(box.left + 8, x) - frame.left}px`;
    el.style.top = `${y - frame.top}px`;
    el.style.setProperty('--arrow-y', `${card.top + card.height / 2 - y}px`);
  }

  return { show, hide, get shownFor() { return current?.key ?? null; } };
}
