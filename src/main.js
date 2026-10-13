// Bootstrap and wiring: Store ↔ renderer, editing panel, toolbar, persistence.
// Navigation: drill into graphRef cards, jump across link badges, breadcrumb back,
// #g=<graphId>&sel=<nodeId> deep links. Clicking a card selects it for editing.

import { captureTemplate, isSelfContained, documentContents, writeFile, fileName, FORMATS } from './persist/save.js';
import { saveDraft, findNewerDraft, clearDraft, debounce } from './persist/autosave.js';
import { parseImport } from './persist/import.js';
import { createDocument } from './store/model.js';
import { replaceDocument, removePerson } from './store/family.js';
import { loadDocument, readEmbedded } from './store/serialize.js';
import { Store } from './store/store.js';
import { createRenderer } from './render/renderer.js';
import { createPanel } from './ui/panel.js';
import { createToolbar } from './ui/toolbar.js';
import { h } from './ui/dom.js';

// Must run before anything changes the DOM: this is what "Save" writes back.
const TEMPLATE = captureTemplate();
const SELF_CONTAINED = isSelfContained();

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function boot() {
  const notice = document.getElementById('notice');
  const showNotice = (content, kind = 'info') => {
    notice.className = `notice ${kind}`;
    notice.replaceChildren(...[content].flat(), h('button', { type: 'button', class: 'link', onclick: () => { notice.hidden = true; } }, 'Dismiss'));
    notice.hidden = false;
  };

  let store;
  let loadErrors = [];
  try {
    const text = readEmbedded(document);
    if (text) {
      const loaded = loadDocument(text);
      loadErrors = loaded.errors;
      store = new Store(loaded.doc, { readOnly: loaded.readOnly || loadErrors.length > 0 });
      if (loaded.readOnly) showNotice('This file was made by a newer version of FamTee and is opened read-only.', 'error');
      if (loadErrors.length) showNotice(`Opened read-only, the data has problems: ${loadErrors.map((e) => e.message).join('; ')}`, 'error');
    } else {
      store = new Store(createDocument());
    }
  } catch (e) {
    showNotice(`Could not load data: ${e.message}`, 'error');
    return;
  }

  const storage = safeStorage();
  const renderer = createRenderer(document.getElementById('canvas'));
  const view = { path: [store.doc.meta.rootGraph], selection: new Set() };
  const hash = new URLSearchParams(location.hash.slice(1));
  const start = hash.get('g');
  if (start && start !== view.path[0] && store.doc.graphs[start]) view.path.push(start);
  if (hash.get('sel')) view.selection = new Set([hash.get('sel')]);
  const handles = { html: null, json: null };

  const currentGraph = () => view.path[view.path.length - 1];

  const ctx = {
    store,
    view,
    currentGraph,
    // Runs an undoable change; shows the reason and returns undefined if it is rejected.
    edit(label, fn) {
      try {
        return store.apply(label, fn);
      } catch (e) {
        showNotice(`${label} failed: ${e.message}`, 'error');
        return undefined;
      }
    },
    editAndSelect(label, fn) {
      const id = ctx.edit(label, fn);
      if (id) ctx.select(id);
    },
    select(id) {
      view.selection = id ? new Set([id]) : new Set();
      update();
    },
    open(graphId) {
      view.path.push(graphId);
      view.selection = new Set();
      update();
    },
    back() {
      if (view.path.length > 1) view.path.pop();
      view.selection = new Set();
      update();
    },
  };

  const panel = createPanel(document.getElementById('panel'), ctx);

  async function save(kind) {
    if (kind === 'html' && !SELF_CONTAINED) {
      showNotice('This page runs from separate source files, so it can’t save itself as one file. Build it with python3 build/build.py, or use Export JSON.', 'error');
      return;
    }
    const { doc } = store;
    try {
      const result = await writeFile({
        contents: documentContents(kind, doc, TEMPLATE),
        kind,
        suggestedName: fileName(doc, FORMATS[kind].ext),
        handle: handles[kind],
      });
      handles[kind] = result.handle;
      store.markSaved();
      if (storage) clearDraft(storage, doc);
      if (result.method === 'download') {
        showNotice(kind === 'html'
          ? 'Downloaded an updated copy. Replace your old file with it (your browser can’t overwrite files directly).'
          : 'Downloaded the data as a .famtee.json file.');
      } else {
        notice.hidden = true;
      }
    } catch (e) {
      if (e.name !== 'AbortError') showNotice(`Save failed: ${e.message}`, 'error');
    }
  }

  async function importFile(file) {
    try {
      const { doc, readOnly, errors } = parseImport(await file.text());
      if (readOnly) throw new Error('the file was made by a newer version of FamTee');
      if (errors.length) throw new Error(errors.map((e) => e.message).join('; '));
      if (ctx.edit(`Import ${file.name}`, (d) => { replaceDocument(d, doc); return true; })) {
        view.path = [store.doc.meta.rootGraph];
        view.selection = new Set();
        update();
        showNotice(`Imported ${file.name}. Use Undo to go back.`);
      }
    } catch (e) {
      showNotice(`Import failed: ${e.message}`, 'error');
    }
  }

  const toolbar = createToolbar(document.getElementById('toolbar'), {
    undo: () => store.undo(),
    redo: () => store.redo(),
    save: () => save('html'),
    exportJson: () => save('json'),
    importFile,
  });

  function update() {
    const { doc } = store;
    view.path = view.path.filter((g) => doc.graphs[g]);
    if (!view.path.length) view.path = [doc.meta.rootGraph];
    const graph = doc.graphs[currentGraph()];
    view.selection = new Set([...view.selection].filter((id) => graph.nodes[id]));
    document.getElementById('doc-title').textContent = doc.meta.title;
    document.title = `${store.dirty ? '• ' : ''}${doc.meta.title} — FamTee`;
    renderBreadcrumb(doc, view, update);
    renderer.render(doc, currentGraph(), { selection: view.selection });
    panel.render();
    toolbar.render(store);
  }

  // --- canvas interaction ------------------------------------------------------
  renderer.svg.addEventListener('click', (event) => {
    const ref = event.target.closest('[data-ref-graph]');
    const badge = event.target.closest('[data-link-graph]');
    const node = event.target.closest('[data-id]');
    if (ref) ctx.open(ref.dataset.refGraph);
    else if (badge) {
      view.path.push(badge.dataset.linkGraph);
      ctx.select(badge.dataset.linkNode);
    } else if (node && !node.classList.contains('edge')) ctx.select(node.dataset.id);
    else ctx.select(null);
  });

  // --- keyboard ------------------------------------------------------------------
  document.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    const typing = event.target.closest?.('input, textarea, select');
    const k = event.key.toLowerCase();
    if (mod && k === 's') {
      event.preventDefault();
      event.target.blur?.(); // commit the field being edited first
      save('html');
    } else if (typing) {
      return;
    } else if (mod && k === 'z') {
      event.preventDefault();
      if (event.shiftKey) store.redo();
      else store.undo();
    } else if (mod && k === 'y') {
      event.preventDefault();
      store.redo();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && !store.readOnly) {
      const [id] = view.selection;
      if (id && store.doc.graphs[currentGraph()].nodes[id]?.type === 'person') {
        event.preventDefault();
        ctx.edit('Delete person', (d) => removePerson(d, currentGraph(), id));
      }
    } else if (event.key === 'Escape') {
      ctx.select(null);
    }
  });

  // --- persistence -------------------------------------------------------------
  const autosave = debounce(() => { if (storage && store.dirty) saveDraft(storage, store.doc); }, 800);
  store.subscribe(() => {
    update();
    if (store.dirty) autosave();
  });
  window.addEventListener('beforeunload', (event) => {
    if (!store.dirty) return;
    autosave.flush();
    event.preventDefault();
    event.returnValue = '';
  });

  const draft = storage && !store.readOnly ? findNewerDraft(storage, store.doc) : null;
  if (draft) {
    const when = new Date(draft.savedAt).toLocaleString();
    showNotice([
      `Unsaved changes from ${when} were found. `,
      h('button', { type: 'button', class: 'primary', onclick: () => {
        ctx.edit('Restore unsaved changes', (d) => replaceDocument(d, draft.doc));
        notice.hidden = true;
      } }, 'Restore'),
      ' ',
      h('button', { type: 'button', onclick: () => { clearDraft(storage, store.doc); notice.hidden = true; } }, 'Discard'),
      ' ',
    ]);
  }

  window.famtee = { store, view, ctx, save };
  update();
}

function renderBreadcrumb(doc, view, update) {
  const nav = document.getElementById('breadcrumb');
  nav.replaceChildren(...view.path.flatMap((graphId, i) => {
    const title = doc.graphs[graphId].title || graphId;
    const last = i === view.path.length - 1;
    const crumb = last ? h('span', {}, title) : h('button', { type: 'button', class: 'link', onclick: () => {
      view.path = view.path.slice(0, i + 1);
      view.selection = new Set();
      update();
    } }, title);
    return i ? [document.createTextNode(' › '), crumb] : [crumb];
  }));
}

boot();
