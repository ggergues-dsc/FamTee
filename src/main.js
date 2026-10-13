// Bootstrap and wiring: start screen → Store ↔ renderer, pan/zoom and drag, editing
// panel, toolbar, browser-first saving (ADR 0017).
// Navigation: drill into graphRef cards, jump across link badges, breadcrumb back,
// #g=<graphId>&sel=<nodeId> deep links (they open the file's family directly, as does
// #start=file|new|continue). Clicking a card selects it for editing; dragging it moves
// it (stored as attrs.nudge); dragging the background pans.

import { captureTemplate, isSelfContained, documentContents, downloadFile, FORMATS } from './persist/save.js';
import {
  saveDraft, draftRelation, lastSessionDraft, clearDraft, recordDownload, lastDownload, debounce,
} from './persist/autosave.js';
import { stampRevision, checkRevision, downloadName, shortHash } from './persist/revision.js';
import { parseImport } from './persist/import.js';
import { importGedcom, addImportedGraph, looksLikeGedcom, documentFromGedcom } from './io/gedcom/import.js';
import { exportGedcom, exportGedcomMerged } from './io/gedcom/export.js';
import { privatize } from './privacy/living.js';
import { createDocument, updateNodeAttrs, removeNode } from './store/model.js';
import { replaceDocument, removePerson } from './store/family.js';
import { loadDocument, readEmbedded } from './store/serialize.js';
import { Store } from './store/store.js';
import { createRenderer } from './render/renderer.js';
import { createPanel } from './ui/panel.js';
import { createToolbar } from './ui/toolbar.js';
import { startScreen } from './ui/start.js';
import { h } from './ui/dom.js';
import { createInteraction } from './ui/interaction.js';
import { IDENTITY, fitTransform, zoomAt } from './ui/viewport.js';

// Must run before anything changes the DOM: this is what "Download" writes out.
const TEMPLATE = captureTemplate();
const SELF_CONTAINED = isSelfContained();
const when = (iso) => new Date(iso).toLocaleString();

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Reads a chosen file as a whole document: FamTee .html, .famtee.json or GEDCOM.
async function readDocumentFile(file) {
  const text = await file.text();
  if (/\.ged(com)?$/i.test(file.name) || looksLikeGedcom(text)) {
    const title = file.name.replace(/\.ged(com)?$/i, '') || 'Imported family';
    const { graph, warnings } = importGedcom(text, { title });
    return { doc: documentFromGedcom(graph), warnings };
  }
  const { doc, readOnly, errors } = parseImport(text);
  if (readOnly) throw new Error('it was made by a newer version of FamTee');
  if (errors.length) throw new Error(errors.map((e) => e.message).join('; '));
  return { doc, warnings: [] };
}

async function boot() {
  const notice = document.getElementById('notice');
  const showNotice = (content, kind = 'info') => {
    notice.className = `notice ${kind}`;
    notice.replaceChildren(...[content].flat(), h('button', { type: 'button', class: 'link', onclick: () => { notice.hidden = true; } }, 'Dismiss'));
    notice.hidden = false;
  };
  const storage = safeStorage();

  // 1. The family stored in this file, if any.
  let embedded = null;
  try {
    const text = readEmbedded(document);
    if (text) {
      const loaded = loadDocument(text);
      embedded = {
        doc: loaded.doc,
        readOnly: loaded.readOnly || loaded.errors.length > 0,
        integrity: checkRevision(loaded.doc),
        problems: loaded.readOnly ? 'Made by a newer version of FamTee: it opens read-only.'
          : loaded.errors.length ? `It has problems and opens read-only: ${loaded.errors.map((e) => e.message).join('; ')}` : '',
      };
    }
  } catch (e) {
    embedded = { error: e.message };
  }

  // 2. Unsaved work kept in this browser: for this family, or the last one edited.
  let draft = null;
  let relation = 'other';
  if (storage && embedded?.doc) ({ draft, relation } = draftRelation(storage, embedded.doc));
  if (relation === 'none') draft = null;
  if (storage && !draft) {
    const last = lastSessionDraft(storage);
    if (last && last.doc.meta.id !== embedded?.doc?.meta.id) [draft, relation] = [last, 'other'];
  }

  // 3. The start screen (skipped by #start=… and deep links).
  const hash = new URLSearchParams(location.hash.slice(1));
  const wanted = hash.get('start') ?? (hash.get('g') || hash.get('sel') ? 'file' : null);
  let openedWarnings = [];
  let choice = wanted === 'file' && embedded?.doc ? { kind: 'file' }
    : wanted === 'continue' && draft ? { kind: 'continue' }
      : wanted === 'new' ? { kind: 'new', title: 'My family' } : null;
  choice ??= await startScreen(document.body, {
    embedded, draft, relation,
    openFile: async (file) => {
      const { doc, warnings } = await readDocumentFile(file);
      openedWarnings = warnings;
      return doc;
    },
    discardDraft: () => clearDraft(storage, draft.doc),
  });

  // 4. The document to work on.
  let doc;
  let readOnly = false;
  const session = { baseHash: null, draftAt: null, downloadedAt: null, downloadName: '', storageOk: !!storage };
  if (choice.kind === 'file') {
    ({ doc, readOnly } = embedded);
    session.baseHash = doc.meta.revision?.hash ?? null;
    if (embedded.problems) showNotice(embedded.problems, 'error');
    else if (embedded.integrity === 'modified') {
      showNotice('This file was changed outside FamTee after it was saved: its content no longer matches its fingerprint.', 'error');
    }
    const later = storage && lastDownload(storage, doc.meta.id);
    if (later && later.hash !== session.baseHash && later.savedAt > (doc.meta.revision?.savedAt ?? '')) {
      showNotice(`A newer version of this family was downloaded on ${when(later.savedAt)} as ${later.filename}. You opened an older file.`, 'error');
    }
  } else if (choice.kind === 'continue') {
    doc = draft.doc;
    session.baseHash = draft.baseHash;
    session.draftAt = draft.savedAt;
    if (relation === 'diverged') {
      showNotice('You continued an unsaved session that started from a different version than this file. Download it to keep it.', 'error');
    }
  } else if (choice.kind === 'new') {
    doc = createDocument({ title: choice.title, graphTitle: choice.title });
  } else {
    doc = choice.doc;
    session.baseHash = doc.meta.revision?.hash ?? null;
    if (openedWarnings.length) showNotice(`Opened ${choice.name}. ${openedWarnings.join('. ')}.`);
  }

  const store = new Store(doc, { readOnly });
  if (choice.kind === 'continue') store.dirty = true;

  const renderer = createRenderer(document.getElementById('canvas'));
  const view = { path: [store.doc.meta.rootGraph], selection: new Set(), advancedOpen: false };
  const start = hash.get('g');
  if (start && start !== view.path[0] && store.doc.graphs[start]) view.path.push(start);
  if (hash.get('sel')) view.selection = new Set([hash.get('sel')]);

  const currentGraph = () => view.path[view.path.length - 1];
  const sessionView = () => ({
    ...session,
    multiGraph: Object.values(store.doc.graphs).filter((g) => Object.values(g.nodes).some((n) => n.type === 'person')).length > 1,
  });

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
    notify: (message, kind) => showNotice(message, kind),
    // Navigates to another graph (if needed) and selects a node there.
    openNode(graphId, nodeId) {
      if (currentGraph() !== graphId) view.path.push(graphId);
      ctx.select(nodeId);
    },
    back() {
      if (view.path.length > 1) view.path.pop();
      view.selection = new Set();
      update();
    },
    addGedcomGraph: async (file) => {
      try {
        importGedcomText(await file.text(), file);
      } catch (e) {
        showNotice(`Import failed: ${e.message}`, 'error');
      }
    },
  };

  const panel = createPanel(document.getElementById('panel'), ctx);

  // The only way FamTee writes to disk (ADR 0017): a new file, stamped with the content
  // hash and time, named so it never overwrites an earlier download.
  function download(kind) {
    if (kind === 'html' && !SELF_CONTAINED) {
      showNotice('This page runs from separate source files, so it can’t download itself as one file. Build it with python3 build/build.py, or use Export ▸ FamTee data.', 'error');
      return;
    }
    const now = new Date();
    const stamped = stampRevision(store.doc, { now, parent: session.baseHash });
    const filename = downloadName(stamped, FORMATS[kind].ext, now);
    try {
      downloadFile({ contents: documentContents(kind, stamped, TEMPLATE), kind, filename });
    } catch (e) {
      showNotice(`Download failed: ${e.message}`, 'error');
      return;
    }
    store.doc.meta.revision = stamped.meta.revision; // shown in "All attributes"; not part of the content hash
    Object.assign(session, { baseHash: stamped.meta.revision.hash, downloadedAt: now.toISOString(), downloadName: filename });
    if (storage) {
      clearDraft(storage, store.doc);
      recordDownload(storage, stamped, filename);
    }
    store.markSaved();
    showNotice(`Downloaded ${filename} (fingerprint ${shortHash(stamped.meta.revision.hash)}). Earlier files are untouched; open this new one next time.`);
  }

  // GEDCOM export (the graph on screen, or every graph merged) never counts as
  // saving: the file can't hold everything FamTee stores (ADR 0010).
  function exportGedcomFile({ merged = false } = {}) {
    const { doc: current } = store;
    const graph = current.graphs[currentGraph()];
    try {
      const { text, stats, warnings } = merged ? exportGedcomMerged(current) : exportGedcom(current, currentGraph());
      const title = merged ? current.meta.title : graph.title || current.meta.title;
      downloadFile({ contents: text, kind: 'gedcom', filename: downloadName({ meta: { title } }, FORMATS.gedcom.ext) });
      const counts = `${stats.people} people and ${stats.families} families`;
      const what = merged ? `${counts} from ${stats.graphs} graph(s) merged` : `${counts} from “${graph.title}”`;
      showNotice(`Downloaded GEDCOM with ${what}. This doesn't count as saving your family.` +
        (warnings.length ? ` ${warnings.join('. ')}.` : ''));
    } catch (e) {
      showNotice(`GEDCOM export failed: ${e.message}`, 'error');
    }
  }

  // A separate copy for sharing, with living people's details removed (ADR 0018).
  // It never counts as saving the family itself.
  function shareCopy(kind) {
    if (kind === 'html' && !SELF_CONTAINED) {
      showNotice('This page runs from separate source files, so it can’t download itself as one file. Build it with python3 build/build.py.', 'error');
      return;
    }
    const now = new Date();
    try {
      const { doc: shared, hidden } = privatize(store.doc, { now });
      let contents;
      let filename;
      if (kind === 'html') {
        const stamped = stampRevision(shared, { now, parent: null });
        contents = documentContents('html', stamped, TEMPLATE);
        filename = downloadName(stamped, FORMATS.html.ext, now);
      } else {
        contents = exportGedcom(shared, currentGraph()).text;
        filename = downloadName({ meta: { title: shared.meta.title } }, FORMATS.gedcom.ext, now);
      }
      downloadFile({ contents, kind, filename });
      const who = hidden === 1 ? '1 living person is' : `${hidden} living people are`;
      showNotice(`Downloaded ${filename} to share: ${who} shown as “Living”, without names, dates, places, notes or photos. ` +
        'Your own family is unchanged, and this doesn’t save it: use Download for that.');
    } catch (e) {
      showNotice(`Sharing copy failed: ${e.message}`, 'error');
    }
  }

  // Advanced: a GEDCOM file added as a new graph (with a tile here).
  function importGedcomText(text, file) {
    const title = file.name.replace(/\.ged(com)?$/i, '') || 'Imported family';
    const { graph, stats, warnings } = importGedcom(text, { title });
    const graphId = ctx.edit(`Import ${file.name}`, (d) => addImportedGraph(d, currentGraph(), graph));
    if (!graphId) return;
    ctx.open(graphId);
    showNotice(`Imported ${stats.people} people and ${stats.families} families from ${file.name} as a new graph. Use Undo to remove it.` +
      (warnings.length ? ` ${warnings.join('. ')}.` : ''));
  }

  // Open…: another file in place of this family (undoable).
  async function openFile(file) {
    try {
      const { doc: opened, warnings } = await readDocumentFile(file);
      if (ctx.edit(`Open ${file.name}`, (d) => { replaceDocument(d, opened); return true; })) {
        session.baseHash = opened.meta.revision?.hash ?? null;
        view.path = [store.doc.meta.rootGraph];
        view.selection = new Set();
        update();
        showNotice(`Opened ${file.name}. Undo brings the previous family back.${warnings.length ? ` ${warnings.join('. ')}.` : ''}`);
      }
    } catch (e) {
      showNotice(`${file.name} couldn't be opened: ${e.message}`, 'error');
    }
  }

  const toolbar = createToolbar(document.getElementById('toolbar'), {
    undo: () => store.undo(),
    redo: () => store.redo(),
    download: () => download('html'),
    exportJson: () => download('json'),
    exportGedcom: () => exportGedcomFile(),
    exportGedcomMerged: () => exportGedcomFile({ merged: true }),
    shareHtml: () => shareCopy('html'),
    shareGedcom: () => shareCopy('gedcom'),
    openFile,
  });

  // --- canvas: rendering, pan/zoom, drag ------------------------------------------
  const svg = renderer.svg;
  const transforms = new Map(); // graph id → pan/zoom transform, kept while navigating
  let drag = null; // { id, dx, dy } while a card is being dragged
  let layout = null;

  function renderCanvas() {
    const graphId = currentGraph();
    layout = renderer.render(store.doc, graphId, {
      selection: view.selection,
      preview: drag ? { [drag.id]: { dx: drag.dx, dy: drag.dy } } : null,
    });
    if (!transforms.has(graphId)) transforms.set(graphId, fitTransform(layout.bounds, svg.clientWidth, svg.clientHeight));
    renderer.setTransform(transforms.get(graphId));
  }

  const getTransform = () => transforms.get(currentGraph()) ?? IDENTITY;
  const setTransform = (t) => {
    transforms.set(currentGraph(), t);
    renderer.setTransform(t);
  };
  const fit = () => setTransform(fitTransform(layout.bounds, svg.clientWidth, svg.clientHeight));
  const zoomBy = (factor) => {
    const t = getTransform();
    setTransform(zoomAt(t, t.k * factor, svg.clientWidth / 2, svg.clientHeight / 2));
  };

  const interaction = createInteraction(svg, {
    getTransform,
    setTransform,
    draggableId: (target) => (store.readOnly ? null : target.closest?.('rect.card[data-id]')?.dataset.id ?? null),
    onDragMove(id, dx, dy) {
      drag = { id, dx, dy };
      renderCanvas();
    },
    onDrop(id, dx, dy) {
      drag = null;
      const [rdx, rdy] = [Math.round(dx), Math.round(dy)];
      if (!rdx && !rdy) return renderCanvas();
      const graphId = currentGraph();
      const node = store.doc.graphs[graphId].nodes[id];
      ctx.edit(node.type === 'person' ? 'Move person' : 'Move tile', (d) => {
        const old = d.graphs[graphId].nodes[id].attrs.nudge ?? { dx: 0, dy: 0 };
        const next = { dx: old.dx + rdx, dy: old.dy + rdy };
        updateNodeAttrs(d, graphId, id, { nudge: next.dx || next.dy ? next : undefined });
      });
    },
    onDragCancel() {
      drag = null;
      renderCanvas();
    },
  });

  const zoomButton = (label, title, onclick) => h('button', { type: 'button', title, 'aria-label': title, onclick }, label);
  svg.after(h('div', { class: 'zoom-controls' },
    zoomButton('+', 'Zoom in (+)', () => zoomBy(1.25)),
    zoomButton('−', 'Zoom out (−)', () => zoomBy(0.8)),
    zoomButton('Fit', 'Fit to window (0)', fit)));

  function update() {
    const { doc } = store;
    view.path = view.path.filter((g) => doc.graphs[g]);
    if (!view.path.length) view.path = [doc.meta.rootGraph];
    const graph = doc.graphs[currentGraph()];
    view.selection = new Set([...view.selection].filter((id) => graph.nodes[id]));
    document.getElementById('doc-title').textContent = doc.meta.title;
    document.title = `${store.dirty ? '• ' : ''}${doc.meta.title} — FamTee`;
    renderBreadcrumb(doc, view, update);
    renderCanvas();
    panel.render();
    toolbar.render(store, sessionView());
  }

  // Clicks (a press without movement; pans and drags swallow their click).
  svg.addEventListener('click', (event) => {
    const ref = event.target.closest('[data-ref-graph]');
    const badge = event.target.closest('[data-link-graph]');
    const node = event.target.closest('[data-id]');
    if (ref) ctx.open(ref.dataset.refGraph);
    else if (badge) ctx.openNode(badge.dataset.linkGraph, badge.dataset.linkNode);
    else if (node && !node.classList.contains('edge')) ctx.select(node.dataset.id);
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
      download('html');
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
      const type = id && store.doc.graphs[currentGraph()].nodes[id]?.type;
      if (type === 'person' || type === 'group') {
        event.preventDefault();
        ctx.edit(type === 'person' ? 'Delete person' : 'Delete group', (d) =>
          (type === 'person' ? removePerson(d, currentGraph(), id) : removeNode(d, currentGraph(), id)));
      }
    } else if (mod || event.altKey) {
      return;
    } else if (event.key === '+' || event.key === '=') {
      zoomBy(1.25);
    } else if (event.key === '-' || event.key === '_') {
      zoomBy(0.8);
    } else if (event.key === '0') {
      fit();
    } else if (event.key === 'Escape' && !event.defaultPrevented) {
      ctx.select(null);
    }
  });

  // --- browser-first saving (ADR 0017) ----------------------------------------------
  // Unsaved work is kept in browser storage ~1 s after each change, every 30 s while
  // there are changes, and when the page is hidden or closed. Storage holds only a few
  // MB; if it refuses (e.g. many photos), the toolbar and a notice say so.
  let storageWarningShown = false;
  function keepInBrowser() {
    if (!storage || !store.dirty || store.readOnly) return;
    const now = new Date();
    session.storageOk = saveDraft(storage, store.doc, { baseHash: session.baseHash, now });
    if (session.storageOk) session.draftAt = now.toISOString();
    else if (!storageWarningShown) {
      storageWarningShown = true;
      showNotice('This browser can’t keep your changes (the family, with its photos, is too big for browser storage). Download now so nothing is lost.', 'error');
    }
    toolbar.render(store, sessionView());
  }
  const autosave = debounce(keepInBrowser, 1000);
  setInterval(keepInBrowser, 30000);
  store.subscribe(() => {
    update();
    if (store.dirty) autosave();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') autosave.flush();
  });
  window.addEventListener('pagehide', () => autosave.flush());
  window.addEventListener('beforeunload', (event) => {
    if (!store.dirty) return;
    autosave.flush();
    event.preventDefault();
    event.returnValue = '';
  });

  window.famtee = { store, view, ctx, session, download, interaction, getTransform, setTransform, fit };
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
