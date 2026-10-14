// Side panel for editing: the document and current graph when nothing is selected,
// otherwise the selected person, union or group. All changes go through ctx.edit(), which
// wraps Store.apply, so each one is undoable and validated.
//
// The panel is rebuilt only when the selection changes; after an edit, field values
// are refreshed in place so typing and tabbing between fields keep focus.
//
// Simple by default (ADR 0017): one tree. Groups, sub-graphs, cross-graph links and
// layout tools sit in a collapsed "Advanced" section. "All attributes" shows every
// stored attribute of the selected node, including ones without a form field.

import { h, confirmButton } from './dom.js';
import { displayName } from '../render/format.js';
import {
  addPerson, addGraph, addGraphRef, removeGraph, updateNodeAttrs, removeNode,
  addGroup, addGroupMember, removeGroupMember, addLink, removeLink,
} from '../store/model.js';
import {
  addPartnerTo, addChildTo, addParentTo, removePerson, copyPersonTo,
  unionsOfPerson, parentUnionsOf, partnersOfUnion, childrenOfUnion,
  groupsOf, linksOf, sameAsIdentity, graphsContaining, addPetTo, petsOfUnion, ownersOfPet, removePet,
} from '../store/family.js';
import { endpoint } from '../store/schema.js';
import { addMedia, setPhoto, isSafeImageData, mediaUsage, imageBytes, formatSize } from '../store/media.js';
import { photoFromFile, ACCEPTED_TYPES } from '../io/photo.js';
import { icon, portrait } from './icons.js';

// Section headings with their icon.
const HEADING_ICONS = {
  Person: 'person', Partnership: 'partnership', Group: 'group', Family: 'family',
  'Add relative': 'addPerson', Partners: 'partners', Parents: 'parents', Children: 'children',
  Members: 'parents', Groups: 'group', Pet: 'paw', Pets: 'paw', Owners: 'parents', 'All attributes': 'list', 'In other graphs': 'families', Advanced: 'sliders',
};
const heading = (tag, text) => h(tag, {}, HEADING_ICONS[text] ? icon(HEADING_ICONS[text]) : null, text);

const UNION_KINDS = ['married', 'partner', 'divorced', 'widowed', 'single'];
const SEXES = [['U', 'Unknown'], ['F', 'Female'], ['M', 'Male']];
// '' lets the privacy rule decide (ADR 0018): living unless a death is recorded or born 100+ years ago.
const STATUSES = [['', 'Automatic (from dates)'], ['living', 'Living'], ['deceased', 'Deceased']];

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
  { name: 'status', label: 'Living or deceased', options: STATUSES, ...nested(null, 'status') },
  { name: 'birth-date', label: 'Born', placeholder: 'e.g. 1950-03-14', ...nested('birth', 'date') },
  { name: 'birth-place', label: 'Birthplace', ...nested('birth', 'place') },
  { name: 'death-date', label: 'Died', ...nested('death', 'date') },
  { name: 'death-place', label: 'Place of death', ...nested('death', 'place') },
  { name: 'occupation', label: 'Job or profession', placeholder: 'e.g. Teacher', ...nested(null, 'occupation') },
  { name: 'employer', label: 'Employer', placeholder: 'e.g. Leeds City Council', ...nested(null, 'employer') },
  { name: 'notes', label: 'Notes', multiline: true, ...nested(null, 'notes') },
];

const PET_FIELDS = [
  { name: 'pet-name', label: 'Name', ...nested(null, 'name') },
  { name: 'species', label: 'Animal', options: [['dog', 'Dog'], ['cat', 'Cat'], ['other', 'Other animal']], ...nested(null, 'species') },
  { name: 'pet-born', label: 'Born', placeholder: 'e.g. 2019', ...nested('birth', 'date') },
  { name: 'pet-died', label: 'Died', ...nested('death', 'date') },
  { name: 'pet-notes', label: 'Notes', multiline: true, ...nested(null, 'notes') },
];

const GROUP_FIELDS = [
  { name: 'group-label', label: 'Group name', placeholder: 'e.g. Household', ...nested(null, 'label') },
];

// Display text for any node in lists.
export function nodeLabel(doc, graphId, nodeId) {
  const node = doc.graphs[graphId]?.nodes[nodeId];
  if (!node) return 'Missing';
  if (node.type === 'person') return displayName(node.attrs);
  if (node.type === 'group') return node.attrs.label || 'Group';
  if (node.type === 'graphRef') return node.attrs.label || doc.graphs[node.attrs.graph]?.title || 'Graph';
  if (node.type === 'pet') return node.attrs.name?.trim() || 'Unnamed pet';
  return 'Partnership';
}

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
        : node?.type === 'group' ? groupPanel(graphId, selected)
        : node?.type === 'pet' ? petPanel(graphId, selected)
        : graphPanel(graphId);
      container.replaceChildren(...body.filter(Boolean));
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

  // A collapsed "Advanced" section; whether it is open is remembered for the session.
  function advanced(...children) {
    const section = h('details', { class: 'advanced', open: !!ctx.view.advancedOpen },
      heading('summary', 'Advanced'), ...children);
    section.addEventListener('toggle', () => { ctx.view.advancedOpen = section.open; });
    return section;
  }

  // Every stored attribute of a node, read-only, refreshed after each edit.
  function allAttributes(graphId, nodeId) {
    const list = h('dl', { class: 'attrs' });
    refreshers.push(() => {
      const { doc } = ctx.store;
      const node = doc.graphs[graphId]?.nodes[nodeId];
      if (!node) return;
      list.replaceChildren(...attributeRows(doc, graphId, nodeId, node).flatMap(([label, value]) =>
        [h('dt', {}, label), h('dd', {}, value)]));
    });
    return h('section', { class: 'all-attributes' }, heading('h3', 'All attributes'), list);
  }

  // A <select> whose options are rebuilt after every edit. It defaults to the first
  // option; once the user picks one, that choice is kept while it still exists.
  function picker(props, buildOptions) {
    const select = h('select', props);
    let chosen = false;
    select.addEventListener('change', () => { chosen = true; });
    refreshers.push(() => {
      const previous = chosen ? select.value : null;
      select.replaceChildren(...buildOptions());
      if ([...select.options].some((o) => o.value === previous)) select.value = previous;
      else select.selectedIndex = 0;
    });
    return select;
  }

  // A list of clickable nodes in the current graph that refreshes after every edit.
  // `remove` (optional) adds a × button per item: { label, run(id) }.
  function people(title, ids, remove = null) {
    const list = h('ul', { class: 'people' });
    const section = h('section', {}, heading('h3', title), list);
    let shown = null;
    refreshers.push(() => {
      const { doc } = ctx.store;
      const graphId = ctx.currentGraph();
      const current = ids().filter((id) => doc.graphs[graphId].nodes[id]);
      section.hidden = current.length === 0;
      // Rebuild only when the list changed: a commit-on-blur refresh mustn't replace
      // the link the user is pressing at that moment.
      const signature = JSON.stringify([ctx.store.readOnly, ...current.map((id) => [id, nodeLabel(doc, graphId, id)])]);
      if (signature === shown) return;
      shown = signature;
      list.replaceChildren(...current.map((id) => {
        const text = nodeLabel(doc, graphId, id);
        return h('li', {},
          h('button', { type: 'button', class: 'link', onclick: () => ctx.select(id) }, text),
          remove && h('button', {
            type: 'button', class: 'icon', title: `${remove.label} ${text}`, 'aria-label': `${remove.label} ${text}`,
            disabled: ctx.store.readOnly, onclick: () => remove.run(id),
          }, '×'));
      }));
    });
    return section;
  }

  // --- photo (person) -------------------------------------------------------------

  function photoSection(graphId, personId) {
    const attrs = () => ctx.store.doc.graphs[graphId]?.nodes[personId]?.attrs ?? {};
    const img = h('img', { class: 'photo', alt: '' });
    const empty = h('span', { class: 'photo placeholder', title: 'No photo' });
    const size = h('span', { class: 'muted hint' });
    const input = h('input', { type: 'file', accept: ACCEPTED_TYPES.join(','), hidden: true, name: 'photo-file' });
    const choose = h('button', { type: 'button', onclick: () => input.click() }, 'Add photo…');
    const remove = h('button', { type: 'button', onclick: () => ctx.edit('Remove photo', (d) => setPhoto(d, graphId, personId, null)) }, 'Remove');

    async function use(file) {
      if (!file || ctx.store.readOnly) return;
      try {
        const photo = await photoFromFile(file);
        ctx.edit(attrs().photo ? 'Change photo' : 'Add photo', (d) => setPhoto(d, graphId, personId, addMedia(d, photo)));
      } catch (e) {
        ctx.notify(e.message, 'error');
      }
    }
    input.addEventListener('change', () => {
      const [file] = input.files;
      input.value = '';
      return use(file);
    });

    // Dropping an image file onto the photo area works too.
    const frame = h('div', { class: 'photo-frame', title: 'Drop an image here' }, img, empty);
    frame.addEventListener('dragover', (event) => {
      if ([...(event.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) {
        event.preventDefault();
        frame.classList.add('drop');
      }
    });
    frame.addEventListener('dragleave', () => frame.classList.remove('drop'));
    frame.addEventListener('drop', (event) => {
      event.preventDefault();
      frame.classList.remove('drop');
      return use(event.dataTransfer?.files?.[0]);
    });

    refreshers.push(() => {
      const media = ctx.store.doc.media?.[attrs().photo];
      const ok = media && isSafeImageData(media.data);
      img.hidden = !ok;
      empty.hidden = !!ok;
      if (!ok && empty.dataset.sex !== (attrs().sex ?? 'U')) {
        empty.dataset.sex = attrs().sex ?? 'U';
        empty.replaceChildren(portrait(attrs().sex));
      }
      if (ok && img.src !== media.data) img.src = media.data;
      choose.textContent = ok ? 'Change…' : 'Add photo…';
      remove.hidden = !ok;
      size.textContent = ok ? `${media.width}×${media.height}, ${formatSize(imageBytes(media.data))}` : '';
    });
    return h('section', { class: 'photo-section' }, frame, h('div', { class: 'row' }, choose, remove, input), size);
  }

  // --- cross-graph links (person) ------------------------------------------------

  function linksSection(graphId, personId) {
    const doc = () => ctx.store.doc;
    const self = endpoint(graphId, personId);

    const list = h('ul', { class: 'people' });
    const none = h('p', { class: 'muted hint' }, 'Not linked to any other graph.');
    let shown = null;
    refreshers.push(() => {
      const items = linksOf(doc(), graphId, personId);
      none.hidden = items.length > 0;
      const signature = JSON.stringify([ctx.store.readOnly, ...items.map(({ link, other }) =>
        [link.id, link.attrs?.label ?? '', nodeLabel(doc(), other.graphId, other.nodeId), doc().graphs[other.graphId]?.title])]);
      if (signature === shown) return;
      shown = signature;
      list.replaceChildren(...items.map(({ link, other }) => {
        const where = doc().graphs[other.graphId]?.title ?? other.graphId;
        const who = nodeLabel(doc(), other.graphId, other.nodeId);
        const text = link.type === 'same-as' ? `Same person in ${where}` : `${link.attrs?.label || 'Related'}: ${who} (${where})`;
        return h('li', {},
          h('button', { type: 'button', class: 'link', onclick: () => ctx.openNode(other.graphId, other.nodeId) }, text),
          h('button', {
            type: 'button', class: 'icon', title: 'Remove link', 'aria-label': `Remove link: ${text}`,
            disabled: ctx.store.readOnly, onclick: () => ctx.edit('Remove link', (d) => removeLink(d, link.id)),
          }, '×'));
      }));
    });

    const graphSelect = h('select', { name: 'link-graph', 'aria-label': 'Other graph' });
    const typeSelect = h('select', { name: 'link-type', 'aria-label': 'Kind of link' },
      h('option', { value: 'same-as' }, 'Same person as'),
      h('option', { value: 'custom' }, 'Related to'));
    const personSelect = h('select', { name: 'link-person', 'aria-label': 'Person in the other graph' });
    const labelInput = h('input', { name: 'link-label', type: 'text', placeholder: 'How? e.g. godparent', hidden: true, autocomplete: 'off' });
    const copyButton = h('button', { type: 'button', onclick: () => {
      ctx.edit('Copy to graph', (d) => copyPersonTo(d, graphId, personId, graphSelect.value));
    } }, 'Copy into that graph');
    const linkButton = h('button', { type: 'button', onclick: () => {
      const type = typeSelect.value;
      const label = labelInput.value.trim();
      const done = ctx.edit(type === 'same-as' ? 'Link same person' : 'Link related person', (d) => addLink(d, {
        type, from: self, to: endpoint(graphSelect.value, personSelect.value), attrs: type === 'custom' && label ? { label } : {},
      }));
      if (done) labelInput.value = '';
    } }, 'Link');

    // Candidates: people in a graph; for same-as, not ones that already are this person.
    const candidates = (targetId) => {
      const target = doc().graphs[targetId];
      const identity = sameAsIdentity(doc(), graphId, personId);
      return target ? Object.keys(target.nodes).filter((id) => target.nodes[id].type === 'person' &&
        !(typeSelect.value === 'same-as' && identity.has(endpoint(targetId, id)))) : [];
    };
    const fillPeople = () => {
      const target = doc().graphs[graphSelect.value];
      const previous = personSelect.value;
      const ids = candidates(graphSelect.value);
      personSelect.replaceChildren(...ids.map((id) => h('option', { value: id }, nodeLabel(doc(), graphSelect.value, id))));
      if (ids.includes(previous)) personSelect.value = previous;
      const ro = ctx.store.readOnly;
      linkButton.disabled = ro || ids.length === 0;
      personSelect.disabled = ro || ids.length === 0;
      copyButton.disabled = ro || !target || graphsContaining(doc(), graphId, personId).has(graphSelect.value);
      labelInput.hidden = typeSelect.value !== 'custom';
    };
    const form = h('div', { class: 'link-form' },
      h('label', {}, h('span', {}, 'Other graph'), graphSelect),
      h('div', { class: 'row' }, copyButton),
      h('div', { class: 'row' }, typeSelect, personSelect),
      h('div', { class: 'row' }, labelInput, linkButton));
    const noGraphs = h('p', { class: 'muted hint' }, 'Add a sub-graph to link people across graphs.');
    let graphChosen = false;
    graphSelect.addEventListener('change', () => { graphChosen = true; fillPeople(); });
    typeSelect.addEventListener('change', fillPeople);
    refreshers.push(() => {
      const others = Object.entries(doc().graphs).filter(([id]) => id !== graphId);
      const previous = graphSelect.value;
      graphSelect.replaceChildren(...others.map(([id, g]) => h('option', { value: id }, g.title || id)));
      // Keep the user's graph; otherwise default to the first graph with someone to link to.
      const fallback = others.find(([id]) => candidates(id).length)?.[0] ?? others[0]?.[0];
      if (graphChosen && others.some(([id]) => id === previous)) graphSelect.value = previous;
      else if (fallback) graphSelect.value = fallback;
      form.hidden = others.length === 0;
      noGraphs.hidden = others.length > 0;
      fillPeople();
    });

    return h('section', { class: 'links' }, heading('h3', 'In other graphs'), list, none, form, noGraphs);
  }

  // --- groups (person) -----------------------------------------------------------

  function groupsSection(graphId, nodeId) {
    const graph = () => ctx.store.doc.graphs[graphId];
    const choice = picker({ name: 'add-group', 'aria-label': 'Group' }, () => [
      ...Object.keys(graph().nodes)
        .filter((id) => graph().nodes[id].type === 'group' && !graph().nodes[id].attrs.members.includes(nodeId))
        .map((id) => h('option', { value: id }, nodeLabel(ctx.store.doc, graphId, id))),
      h('option', { value: '' }, 'New group'),
    ]);
    const add = h('button', { type: 'button', onclick: () => {
      if (choice.value) ctx.edit('Add to group', (d) => addGroupMember(d, graphId, choice.value, nodeId));
      else ctx.edit('New group', (d) => addGroup(d, graphId, [nodeId], { label: 'New group' }));
    } }, 'Add to group');
    return h('section', {},
      people('Groups', () => groupsOf(graph(), nodeId),
        { label: 'Remove from', run: (groupId) => ctx.edit('Remove from group', (d) => removeGroupMember(d, graphId, groupId, nodeId)) }),
      h('div', { class: 'row' }, choice, add));
  }

  // --- person ---------------------------------------------------------------

  function personPanel(graphId, personId) {
    const graph = () => ctx.store.doc.graphs[graphId];
    const attrs = () => graph().nodes[personId]?.attrs ?? {};

    const unionChoice = picker({ name: 'child-union', 'aria-label': 'Other parent' }, () => [
      ...unionsOfPerson(graph(), personId).map(({ unionId, partners }) => h('option', { value: unionId },
        partners.length ? `with ${partners.map((p) => displayName(graph().nodes[p].attrs)).join(' & ')}` : 'alone (existing)')),
      h('option', { value: '' }, 'alone (new)'),
    ]);

    const addParentButton = h('button', { type: 'button', onclick: () =>
      ctx.editAndSelect('Add parent', (doc) => addParentTo(doc, graphId, personId).personId) }, '+ Parent');
    refreshers.push(() => {
      const unions = parentUnionsOf(graph(), personId);
      addParentButton.disabled = ctx.store.readOnly ||
        (unions.length > 0 && unions.every((u) => partnersOfUnion(graph(), u).length >= 2));
    });

    const speciesChoice = h('select', { name: 'pet-species', 'aria-label': 'Kind of animal' },
      h('option', { value: 'dog' }, 'Dog'), h('option', { value: 'cat' }, 'Cat'), h('option', { value: 'other' }, 'Other animal'));

    const resetPosition = h('button', { type: 'button', onclick: () =>
      ctx.edit('Reset position', (doc) => updateNodeAttrs(doc, graphId, personId, { nudge: undefined })) }, 'Reset position');
    refreshers.push(() => { resetPosition.hidden = !attrs().nudge; });

    return [
      heading('h2', 'Person'),
      photoSection(graphId, personId),
      nodeForm(graphId, personId, PERSON_FIELDS, 'Edit person'),
      h('section', { class: 'actions' },
        heading('h3', 'Add relative'),
        h('div', { class: 'row' },
          h('button', { type: 'button', onclick: () =>
            ctx.editAndSelect('Add partner', (doc) => addPartnerTo(doc, graphId, personId).personId) }, '+ Partner'),
          addParentButton),
        h('div', { class: 'row' },
          h('button', { type: 'button', onclick: () => ctx.editAndSelect('Add child', (doc) =>
            addChildTo(doc, graphId, personId, unionChoice.value || null).personId) }, '+ Child'),
          unionChoice),
        h('div', { class: 'row' },
          h('button', {
            type: 'button', class: 'with-icon', title: 'Add a pet of this person (with the partner chosen for + Child)',
            onclick: () => ctx.editAndSelect('Add pet', (doc) =>
              addPetTo(doc, graphId, personId, unionChoice.value || null, { name: 'New pet', species: speciesChoice.value }).petId),
          }, icon('paw'), '+ Pet'),
          speciesChoice)),
      people('Partners', () => unionsOfPerson(graph(), personId).flatMap((u) => u.partners)),
      people('Parents', () => parentUnionsOf(graph(), personId).flatMap((u) => partnersOfUnion(graph(), u))),
      people('Children', () => unionsOfPerson(graph(), personId).flatMap((u) => u.children)),
      people('Pets', () => unionsOfPerson(graph(), personId).flatMap((u) => petsOfUnion(graph(), u.unionId))),
      allAttributes(graphId, personId),
      advanced(
        linksSection(graphId, personId),
        groupsSection(graphId, personId),
        h('div', { class: 'row' }, resetPosition)),
      h('section', { class: 'row danger' },
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
      heading('h2', 'Partnership'),
      nodeForm(graphId, unionId, UNION_FIELDS, 'Edit partnership'),
      people('Partners', () => partnersOfUnion(graph(), unionId)),
      people('Children', () => childrenOfUnion(graph(), unionId)),
      allAttributes(graphId, unionId),
      h('section', { class: 'row danger' },
        confirmButton('Delete partnership', 'Click again to delete', () => {
          ctx.edit('Delete partnership', (doc) => removeNode(doc, graphId, unionId));
          ctx.select(null);
        })),
    ];
  }

  // --- pet ------------------------------------------------------------------

  function petPanel(graphId, petId) {
    const graph = () => ctx.store.doc.graphs[graphId];
    return [
      heading('h2', 'Pet'),
      nodeForm(graphId, petId, PET_FIELDS, 'Edit pet'),
      people('Owners', () => ownersOfPet(graph(), petId)),
      allAttributes(graphId, petId),
      h('section', { class: 'row danger' },
        confirmButton('Delete pet', 'Click again to delete', () => {
          ctx.edit('Delete pet', (doc) => removePet(doc, graphId, petId));
          ctx.select(null);
        })),
    ];
  }

  // --- group ------------------------------------------------------------------

  function groupPanel(graphId, groupId) {
    const members = () => ctx.store.doc.graphs[graphId].nodes[groupId]?.attrs.members ?? [];
    return [
      heading('h2', 'Group'),
      nodeForm(graphId, groupId, GROUP_FIELDS, 'Rename group'),
      people('Members', members, {
        label: 'Remove',
        run: (id) => {
          const last = members().length === 1;
          ctx.edit('Remove from group', (d) => removeGroupMember(d, graphId, groupId, id));
          if (last) ctx.select(null);
        },
      }),
      h('p', { class: 'muted hint' }, 'Add people from their own panel (Advanced → “Add to group”). Removing the last member removes the group.'),
      allAttributes(graphId, groupId),
      h('section', { class: 'row danger' },
        confirmButton('Delete group', 'Click again to delete', () => {
          ctx.edit('Delete group', (d) => removeNode(d, graphId, groupId));
          ctx.select(null);
        })),
    ];
  }

  // --- document / graph -----------------------------------------------------

  function graphPanel(graphId) {
    const { doc } = ctx.store;
    const isRoot = graphId === doc.meta.rootGraph;
    const docFields = [{ name: 'doc-title', label: 'Family name', ...nested(null, 'title') }];
    const graphFields = [{ name: 'graph-title', label: 'This graph', ...nested(null, 'title') }];
    const gedcomInput = h('input', { type: 'file', accept: '.ged', hidden: true, name: 'gedcom-subgraph' });
    gedcomInput.addEventListener('change', () => {
      const [file] = gedcomInput.files;
      gedcomInput.value = '';
      if (file) ctx.addGedcomGraph(file);
    });
    return [
      heading('h2', 'Family'),
      form(docFields, () => ctx.store.doc.meta, (field, value) =>
        ctx.edit('Rename family', (d) => { d.meta.title = value.trim() || 'Untitled family'; })),
      h('section', { class: 'actions' },
        h('div', { class: 'row' },
          h('button', { type: 'button', onclick: () =>
            ctx.editAndSelect('Add person', (d) => addPerson(d, graphId, { name: { given: 'New person' } })) }, '+ Person'))),
      form([{ name: 'orientation', label: 'Layout', options: [['TB', 'Generations top to bottom'], ['LR', 'Generations left to right']],
        ...nested(null, 'orientation') }],
      () => ctx.store.doc.graphs[graphId]?.layout ?? {},
      (field, value) => ctx.edit('Change layout', (d) => { d.graphs[graphId].layout = { ...d.graphs[graphId].layout, orientation: value }; })),
      h('p', { class: 'muted hint' }, 'Click a person to see and edit everything about them and to add relatives. Drag cards to move them; drag the background to pan, scroll or pinch to zoom.'),
      photoUsage(),
      advanced(
        form(graphFields, () => ctx.store.doc.graphs[graphId] ?? {}, (field, value) =>
          ctx.edit('Rename graph', (d) => { d.graphs[graphId].title = value.trim() || 'Untitled graph'; })),
        h('div', { class: 'row' },
          h('button', { type: 'button', onclick: () => {
            const id = ctx.edit('Add sub-graph', (d) => {
              const sub = addGraph(d, { title: 'New family' });
              addGraphRef(d, graphId, sub);
              return sub;
            });
            if (id) ctx.open(id);
          } }, '+ Sub-graph'),
          h('button', { type: 'button', onclick: () => gedcomInput.click(),
            title: 'Adds a GEDCOM file as a separate graph, with a tile here' }, 'Add GEDCOM as sub-graph…'),
          gedcomInput),
        resetLayoutButton(graphId),
        people('Groups', () => Object.keys(ctx.store.doc.graphs[graphId]?.nodes ?? {})
          .filter((id) => ctx.store.doc.graphs[graphId].nodes[id].type === 'group')),
        isRoot ? null : h('section', { class: 'row danger' },
          confirmButton('Delete this graph', 'Click again to delete', () => {
            ctx.back();
            ctx.edit('Delete graph', (d) => removeGraph(d, graphId));
          }))),
    ];
  }


  // How much the embedded photos add to the saved file.
  function photoUsage() {
    const line = h('p', { class: 'muted hint photo-usage' });
    refreshers.push(() => {
      const { count, bytes } = mediaUsage(ctx.store.doc);
      line.hidden = count === 0;
      line.textContent = `${count} photo${count === 1 ? '' : 's'} embedded, ${formatSize(bytes)} of the file`;
    });
    return line;
  }

  // Clears every manual move (attrs.nudge) in the graph as one undoable step.
  function resetLayoutButton(graphId) {
    const nudged = () => Object.entries(ctx.store.doc.graphs[graphId]?.nodes ?? {}).filter(([, n]) => n.attrs.nudge);
    const button = h('button', { type: 'button', onclick: () => ctx.edit('Reset layout', (d) => {
      for (const [id] of nudged()) updateNodeAttrs(d, graphId, id, { nudge: undefined });
    }) }, 'Reset layout');
    refreshers.push(() => { button.hidden = nudged().length === 0; });
    return h('div', { class: 'row' }, button);
  }

  return { render };
}

// --- all attributes -----------------------------------------------------------------

const LABELS = {
  name: 'Name', given: 'given name', surname: 'surname', suffix: 'suffix', sex: 'Sex', birth: 'Born', death: 'Died',
  date: 'date', place: 'place', notes: 'Notes', kind: 'Relationship', start: 'From', end: 'Until', label: 'Label',
  status: 'Status',
};
const SEX = { M: 'Male', F: 'Female', U: 'Unknown' };

// [label, text] rows for every stored attribute of a node, plus its identity.
export function attributeRows(doc, graphId, nodeId, node) {
  const rows = [['Type', node.type === 'union' ? 'partnership' : node.type], ['ID', nodeId]];
  for (const [key, value] of Object.entries(node.attrs ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (key === 'photo') {
      const m = doc.media?.[value];
      rows.push(['Photo', m ? `${m.width}×${m.height} ${m.mime.replace('image/', '').toUpperCase()}, ${formatSize(imageBytes(m.data))} (${value})` : `missing (${value})`]);
    } else if (key === 'nudge') {
      rows.push(['Manual position', `moved ${value.dx}, ${value.dy} from the automatic layout`]);
    } else if (key === 'members' && Array.isArray(value)) {
      rows.push(['Members', value.map((id) => nodeLabel(doc, graphId, id)).join(', ') || 'none']);
    } else if (key === 'graph') {
      rows.push(['Graph', doc.graphs[value]?.title ?? value]);
    } else if (key === 'sex') {
      rows.push(['Sex', SEX[value] ?? String(value)]);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [sub, v] of Object.entries(value)) {
        if (v === undefined || v === null || v === '') continue;
        rows.push([`${LABELS[key] ?? key} · ${LABELS[sub] ?? sub}`, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
      }
    } else {
      rows.push([LABELS[key] ?? key, Array.isArray(value) ? value.join(', ') : String(value)]);
    }
  }
  const links = doc.links.filter((l) => [l.from, l.to].includes(`${graphId}:${nodeId}`)).length;
  if (links) rows.push(['Links to other graphs', String(links)]);
  return rows;
}
