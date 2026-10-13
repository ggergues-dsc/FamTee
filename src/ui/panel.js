// Side panel for editing: the document and current graph when nothing is selected,
// otherwise the selected person or union. All changes go through ctx.edit(), which
// wraps Store.apply, so each one is undoable and validated.
//
// The panel is rebuilt only when the selection changes; after an edit, field values
// are refreshed in place so typing and tabbing between fields keep focus.

import { h, confirmButton } from './dom.js';
import { displayName } from '../render/format.js';
import { addPerson, addGraph, addGraphRef, removeGraph, updateNodeAttrs, removeNode } from '../store/model.js';
import {
  addPartnerTo, addChildTo, addParentTo, removePerson,
  unionsOfPerson, parentUnionsOf, partnersOfUnion, childrenOfUnion,
} from '../store/family.js';

const UNION_KINDS = ['married', 'partner', 'divorced', 'widowed', 'single'];
const SEXES = [['U', 'Unknown'], ['F', 'Female'], ['M', 'Male']];

// Reads/writes nested attrs such as name.given or birth.date. Empty strings remove the key.
function nested(group, key) {
  return {
    get: (attrs) => (group ? attrs[group]?.[key] : attrs[key]) ?? '',
    patch: (attrs, raw) => {
      const value = typeof raw === 'string' ? raw.trim() : raw;
      if (!group) return { [key]: value === '' ? undefined : value };
      const next = { ...(attrs[group] ?? {}) };
      if (value === '') delete next[key];
      else next[key] = value;
      return { [group]: Object.keys(next).length ? next : undefined };
    },
  };
}

const PERSON_FIELDS = [
  { name: 'given', label: 'Given name', ...nested('name', 'given') },
  { name: 'surname', label: 'Surname', ...nested('name', 'surname') },
  { name: 'sex', label: 'Sex', options: SEXES, ...nested(null, 'sex') },
  { name: 'birth-date', label: 'Born', placeholder: 'e.g. 1950-03-14', ...nested('birth', 'date') },
  { name: 'birth-place', label: 'Birthplace', ...nested('birth', 'place') },
  { name: 'death-date', label: 'Died', ...nested('death', 'date') },
  { name: 'death-place', label: 'Place of death', ...nested('death', 'place') },
  { name: 'notes', label: 'Notes', multiline: true, ...nested(null, 'notes') },
];

const UNION_FIELDS = [
  { name: 'kind', label: 'Relationship', options: UNION_KINDS.map((k) => [k, k[0].toUpperCase() + k.slice(1)]), ...nested(null, 'kind') },
  { name: 'start', label: 'From', ...nested(null, 'start') },
  { name: 'end', label: 'Until', ...nested(null, 'end') },
];

export function createPanel(container, ctx) {
  let key = null;
  let refreshers = [];

  function render() {
    const { doc } = ctx.store;
    const graphId = ctx.currentGraph();
    const graph = doc.graphs[graphId];
    const [selected] = ctx.view.selection;
    const node = selected ? graph.nodes[selected] : null;
    const nextKey = node ? `${graphId}:${selected}:${node.type}` : `graph:${graphId}`;
    const readOnly = ctx.store.readOnly;

    if (nextKey !== key) {
      key = nextKey;
      refreshers = [];
      const body = node?.type === 'person' ? personPanel(graphId, selected)
        : node?.type === 'union' ? unionPanel(graphId, selected)
        : graphPanel(graphId);
      container.replaceChildren(...body);
      if (readOnly) for (const el of container.querySelectorAll('input, select, textarea, button')) el.disabled = true;
    }
    for (const refresh of refreshers) refresh();
  }

  // --- building blocks -----------------------------------------------------

  // A form bound to node attrs (or to any getter/setter pair for document fields).
  function form(fields, read, write) {
    return h('div', { class: 'form' }, fields.map((field) => {
      const id = `f-${field.name}`;
      const input = field.options
        ? h('select', { id, name: field.name }, field.options.map(([value, text]) => h('option', { value }, text)))
        : field.multiline
          ? h('textarea', { id, name: field.name, rows: 3 })
          : h('input', { id, name: field.name, type: 'text', placeholder: field.placeholder ?? '', autocomplete: 'off' });
      input.addEventListener('change', () => write(field, input.value));
      refreshers.push(() => {
        const value = field.get(read());
        if (document.activeElement !== input) input.value = field.options && value === '' ? field.options[0][0] : value;
      });
      return h('label', { for: id }, h('span', {}, field.label), input);
    }));
  }

  function nodeForm(graphId, nodeId, fields, label) {
    const read = () => ctx.store.doc.graphs[graphId]?.nodes[nodeId]?.attrs ?? {};
    return form(fields, read, (field, value) => {
      ctx.edit(label, (doc) => updateNodeAttrs(doc, graphId, nodeId, field.patch(read(), value)));
    });
  }

  // A list of clickable people that refreshes after every edit.
  function people(title, ids) {
    const list = h('ul', { class: 'people' });
    const section = h('section', {}, h('h3', {}, title), list);
    refreshers.push(() => {
      const graph = ctx.store.doc.graphs[ctx.currentGraph()];
      const current = ids().filter((id) => graph.nodes[id]);
      section.hidden = current.length === 0;
      list.replaceChildren(...current.map((id) => h('li', {},
        h('button', { type: 'button', class: 'link', onclick: () => ctx.select(id) }, displayName(graph.nodes[id].attrs)))));
    });
    return section;
  }

  // --- person ---------------------------------------------------------------

  function personPanel(graphId, personId) {
    const graph = () => ctx.store.doc.graphs[graphId];
    const attrs = () => graph().nodes[personId]?.attrs ?? {};

    const unionChoice = h('select', { name: 'child-union', 'aria-label': 'Other parent' });
    let chosen = false;
    unionChoice.addEventListener('change', () => { chosen = true; });
    refreshers.push(() => {
      const previous = chosen ? unionChoice.value : null;
      const options = unionsOfPerson(graph(), personId).map(({ unionId, partners }) =>
        h('option', { value: unionId },
          partners.length ? `with ${partners.map((p) => displayName(graph().nodes[p].attrs)).join(' & ')}` : 'alone (existing)'));
      unionChoice.replaceChildren(...options, h('option', { value: '' }, 'alone (new)'));
      // Default to the first partnership; keep the user's choice across refreshes.
      if ([...unionChoice.options].some((o) => o.value === previous)) unionChoice.value = previous;
      else unionChoice.selectedIndex = 0;
    });

    const addParentButton = h('button', { type: 'button', onclick: () =>
      ctx.editAndSelect('Add parent', (doc) => addParentTo(doc, graphId, personId).personId) }, '+ Parent');
    refreshers.push(() => {
      const unions = parentUnionsOf(graph(), personId);
      addParentButton.disabled = ctx.store.readOnly ||
        (unions.length > 0 && unions.every((u) => partnersOfUnion(graph(), u).length >= 2));
    });

    const resetPosition = h('button', { type: 'button', onclick: () =>
      ctx.edit('Reset position', (doc) => updateNodeAttrs(doc, graphId, personId, { pos: undefined })) }, 'Reset position');
    refreshers.push(() => { resetPosition.hidden = !attrs().pos; });

    return [
      h('h2', {}, 'Person'),
      nodeForm(graphId, personId, PERSON_FIELDS, 'Edit person'),
      h('section', { class: 'actions' },
        h('h3', {}, 'Add relative'),
        h('div', { class: 'row' },
          h('button', { type: 'button', onclick: () =>
            ctx.editAndSelect('Add partner', (doc) => addPartnerTo(doc, graphId, personId).personId) }, '+ Partner'),
          addParentButton),
        h('div', { class: 'row' },
          h('button', { type: 'button', onclick: () => ctx.editAndSelect('Add child', (doc) =>
            addChildTo(doc, graphId, personId, unionChoice.value || null).personId) }, '+ Child'),
          unionChoice)),
      people('Partners', () => unionsOfPerson(graph(), personId).flatMap((u) => u.partners)),
      people('Parents', () => parentUnionsOf(graph(), personId).flatMap((u) => partnersOfUnion(graph(), u))),
      people('Children', () => unionsOfPerson(graph(), personId).flatMap((u) => u.children)),
      h('section', { class: 'row danger' },
        resetPosition,
        confirmButton('Delete person', 'Click again to delete', () => {
          ctx.edit('Delete person', (doc) => removePerson(doc, graphId, personId));
          ctx.select(null);
        })),
    ];
  }

  // --- union ----------------------------------------------------------------

  function unionPanel(graphId, unionId) {
    const graph = () => ctx.store.doc.graphs[graphId];
    return [
      h('h2', {}, 'Partnership'),
      nodeForm(graphId, unionId, UNION_FIELDS, 'Edit partnership'),
      people('Partners', () => partnersOfUnion(graph(), unionId)),
      people('Children', () => childrenOfUnion(graph(), unionId)),
      h('section', { class: 'row danger' },
        confirmButton('Delete partnership', 'Click again to delete', () => {
          ctx.edit('Delete partnership', (doc) => removeNode(doc, graphId, unionId));
          ctx.select(null);
        })),
    ];
  }

  // --- document / graph -----------------------------------------------------

  function graphPanel(graphId) {
    const { doc } = ctx.store;
    const isRoot = graphId === doc.meta.rootGraph;
    const docFields = [{ name: 'doc-title', label: 'Family title', ...nested(null, 'title') }];
    const graphFields = [{ name: 'graph-title', label: 'This graph', ...nested(null, 'title') }];
    return [
      h('h2', {}, 'Family file'),
      form(docFields, () => ctx.store.doc.meta, (field, value) =>
        ctx.edit('Rename family', (d) => { d.meta.title = value.trim() || 'Untitled family'; })),
      form(graphFields, () => ctx.store.doc.graphs[graphId] ?? {}, (field, value) =>
        ctx.edit('Rename graph', (d) => { d.graphs[graphId].title = value.trim() || 'Untitled graph'; })),
      h('section', { class: 'actions' },
        h('div', { class: 'row' },
          h('button', { type: 'button', onclick: () =>
            ctx.editAndSelect('Add person', (d) => addPerson(d, graphId, { name: { given: 'New person' } })) }, '+ Person'),
          h('button', { type: 'button', onclick: () => {
            const id = ctx.edit('Add sub-graph', (d) => {
              const sub = addGraph(d, { title: 'New family' });
              addGraphRef(d, graphId, sub);
              return sub;
            });
            if (id) ctx.open(id);
          } }, '+ Sub-graph'))),
      h('p', { class: 'muted hint' }, 'Select a person to edit them and add relatives.'),
      isRoot ? null : h('section', { class: 'row danger' },
        confirmButton('Delete this graph', 'Click again to delete', () => {
          ctx.back();
          ctx.edit('Delete graph', (d) => removeGraph(d, graphId));
        })),
    ];
  }

  return { render };
}
