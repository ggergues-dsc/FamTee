// Connecting two people who are already in the graph (for example someone added on
// their own, before it was known where they fit). The user drags from one card to
// another (Ctrl/⌘+drag, or the handle on the selected card), or selects a person,
// presses C and picks the other one. This module is the popover that follows: it asks
// how they are related and describes the result before anything changes.
//
// relationOptions() and applyConnection() are pure, so they can be unit-tested.

import { h } from './dom.js';
import { displayName } from '../render/format.js';
import {
  unionsOfPerson, parentUnionsOf, partnersOfUnion, arePartners,
  connectPartners, connectParent, connectChild, connectSibling, connectRelated,
} from '../store/family.js';

export const PARTNER_KINDS = ['married', 'partner', 'divorced', 'widowed'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// The relations `subject` can have to `anchor`, each [value, label, reason it is unavailable or ''].
export function relationOptions(graph, subject, anchor) {
  const first = displayName(graph.nodes[anchor].attrs).split(' ')[0];
  const parentsOf = (id) => parentUnionsOf(graph, id).flatMap((u) => partnersOfUnion(graph, u));
  const anchorParents = parentsOf(anchor);
  const anchorHasRoom = !parentUnionsOf(graph, anchor).length ||
    parentUnionsOf(graph, anchor).some((u) => partnersOfUnion(graph, u).length < 2);
  const subjectHasParents = parentUnionsOf(graph, subject).length > 0;
  return [
    ['partner', 'Partner', arePartners(graph, subject, anchor) ? 'already partners' : ''],
    ['child', 'Child', parentsOf(subject).includes(anchor) ? 'already their child'
      : subjectHasParents && !parentUnionsOf(graph, subject).some((u) => partnersOfUnion(graph, u).length < 2) ? 'already has two parents' : ''],
    ['parent', 'Parent', anchorParents.includes(subject) ? 'already their parent'
      : anchorHasRoom ? '' : `${first} already has two parents`],
    ['sibling', 'Brother or sister', !parentUnionsOf(graph, anchor).length ? `add ${first}’s parents first`
      : subjectHasParents ? 'already has parents' : ''],
    ['other', 'Other relation…', ''],
  ];
}

// Applies the chosen relation inside Store.apply. op: { how, kind, start, unionId, label }.
export function applyConnection(doc, graphId, subject, anchor, op) {
  switch (op.how) {
    case 'partner':
      return connectPartners(doc, graphId, subject, anchor, { kind: op.kind || 'married', ...(op.start ? { start: op.start } : {}) });
    case 'child':
      return connectChild(doc, graphId, anchor, subject, op.unionId ?? null);
    case 'parent':
      return connectParent(doc, graphId, subject, anchor);
    case 'sibling':
      return connectSibling(doc, graphId, anchor, subject);
    case 'other':
      return connectRelated(doc, graphId, subject, anchor, op.label ?? '');
    default:
      throw new Error(`Unknown relation: ${op.how}`);
  }
}

// One sentence saying what Connect will do.
export function describeConnection(graph, subject, anchor, op) {
  const S = displayName(graph.nodes[subject].attrs);
  const A = displayName(graph.nodes[anchor].attrs);
  switch (op.how) {
    case 'partner': return `${S} becomes ${A}’s partner (${[op.kind || 'married', op.start].filter(Boolean).join(' ')}).`;
    case 'child': {
      const others = op.unionId ? partnersOfUnion(graph, op.unionId).filter((p) => p !== anchor) : [];
      return `${S} becomes the child of ${[A, ...others.map((p) => displayName(graph.nodes[p].attrs))].join(' and ')}.`;
    }
    case 'parent': return `${S} becomes ${A}’s parent.`;
    case 'sibling': return `${S} becomes ${A}’s brother or sister.`;
    default: return `${S} is linked to ${A}${op.label ? ` as “${op.label}”` : ''}, outside the family lines.`;
  }
}

export const CONNECT_LABELS = {
  partner: 'Connect as partners', child: 'Connect as child', parent: 'Connect as parent',
  sibling: 'Connect as brother or sister', other: 'Link related person',
};

// host: positioned element the popover is placed in; area: what it must stay inside.
export function createConnectDialog(host, area = host) {
  let current = null; // { el, onCancel }

  function close() {
    const was = current;
    current = null;
    was?.el.remove();
    return !!was;
  }

  // anchorEl: the anchor's card on the canvas. onConnect(op) applies it and returns
  // whether it worked; onCancel() is called when the popover is dismissed.
  function open({ graph, subject, anchor, anchorEl, onConnect, onCancel = () => {} }) {
    close();
    const S = displayName(graph.nodes[subject].attrs);
    const A = displayName(graph.nodes[anchor].attrs);
    const options = relationOptions(graph, subject, anchor);
    const firstOk = options.find(([, , why]) => !why)[0];
    const rel = h('select', { id: 'connect-relation', name: 'connect-relation' }, options.map(([value, label, why]) =>
      h('option', { value, disabled: !!why, selected: value === firstOk }, why ? `${label} (${why})` : label)));
    const extra = h('div', { class: 'connect-extra' });
    const preview = h('p', { class: 'connect-preview', 'aria-live': 'polite' });
    const ok = h('button', { type: 'button', class: 'primary' }, 'Connect');
    const cancel = h('button', { type: 'button' }, 'Cancel');
    const el = h('div', { class: 'connect', role: 'dialog', 'aria-label': `Connect ${S} and ${A}` },
      h('h4', {}, `Connect ${S} to ${A}`),
      h('label', { class: 'field', for: 'connect-relation' }, h('span', {}, `${S.split(' ')[0]} is ${A.split(' ')[0]}’s`), rel),
      extra, preview,
      h('div', { class: 'connect-actions' }, ok, cancel, h('span', { class: 'muted' }, 'Esc to cancel')));

    let read = () => ({ how: rel.value });
    function fields() {
      const how = rel.value;
      if (how === 'partner') {
        const kind = h('select', { id: 'connect-kind', name: 'connect-kind' }, PARTNER_KINDS.map((k) => h('option', { value: k }, cap(k))));
        const start = h('input', { id: 'connect-start', name: 'connect-start', type: 'text', placeholder: 'e.g. 2001', autocomplete: 'off' });
        extra.replaceChildren(h('div', { class: 'two' },
          h('label', { class: 'field', for: 'connect-kind' }, h('span', {}, 'Relationship'), kind),
          h('label', { class: 'field', for: 'connect-start' }, h('span', {}, 'From'), start)));
        read = () => ({ how, kind: kind.value, start: start.value.trim() });
      } else if (how === 'child') {
        const unions = unionsOfPerson(graph, anchor).filter((u) => u.partners.length);
        const withs = h('select', { id: 'connect-with', name: 'connect-with' },
          unions.map((u) => h('option', { value: u.unionId },
            `with ${u.partners.map((p) => displayName(graph.nodes[p].attrs)).join(' & ')}`)),
          h('option', { value: '' }, 'alone'));
        extra.replaceChildren(h('label', { class: 'field', for: 'connect-with' }, h('span', {}, 'Other parent'), withs));
        read = () => ({ how, unionId: withs.value || null });
      } else if (how === 'other') {
        const label = h('input', { id: 'connect-label', name: 'connect-label', type: 'text', placeholder: 'e.g. godparent', autocomplete: 'off' });
        extra.replaceChildren(h('label', { class: 'field', for: 'connect-label' }, h('span', {}, 'How are they related?'), label));
        read = () => ({ how, label: label.value.trim() });
      } else {
        extra.replaceChildren();
        read = () => ({ how });
      }
      for (const input of extra.querySelectorAll('input, select')) input.addEventListener('input', describe);
      describe();
    }
    function describe() {
      preview.textContent = describeConnection(graph, subject, anchor, read());
    }
    rel.addEventListener('change', fields);
    ok.addEventListener('click', () => {
      if (onConnect(read())) close();
    });
    cancel.addEventListener('click', () => {
      close();
      onCancel();
    });
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.tagName === 'INPUT') ok.click();
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancel.click();
      }
    });
    fields();
    host.append(el);
    current = { el, onCancel };

    // Beside the anchor's card, inside the area.
    const card = anchorEl.getBoundingClientRect();
    const frame = host.getBoundingClientRect();
    const box = area.getBoundingClientRect();
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    let x = card.right + 14;
    if (x + w > box.right - 8) x = card.left - 14 - w;
    x = Math.min(Math.max(box.left + 8, x), Math.max(box.left + 8, box.right - 8 - w));
    const y = Math.min(Math.max(box.top + 8, card.top - 20), Math.max(box.top + 8, box.bottom - hgt - 8));
    el.style.left = `${x - frame.left}px`;
    el.style.top = `${y - frame.top}px`;
    rel.focus({ preventScroll: true });
  }

  // Escape: closes the popover (and reports the cancel). Returns whether it was open.
  function cancel() {
    const was = current;
    if (!close()) return false;
    was.onCancel();
    return true;
  }

  return { open, close, cancel, get isOpen() { return !!current; } };
}
