// Bootstrap: load the embedded document (or start a blank one) into a Store and
// render it. Navigation: drill into graphRef cards, jump across link badges,
// go back via the breadcrumb. Clicking a card selects it.

import { createDocument } from './store/model.js';
import { loadDocument, readEmbedded } from './store/serialize.js';
import { Store } from './store/store.js';
import { createRenderer } from './render/renderer.js';

function boot() {
  const status = document.getElementById('status');
  let store;
  let errors = [];
  try {
    const text = readEmbedded(document);
    if (text) {
      const loaded = loadDocument(text);
      errors = loaded.errors;
      store = new Store(loaded.doc, { readOnly: loaded.readOnly || errors.length > 0 });
    } else {
      store = new Store(createDocument());
    }
  } catch (e) {
    status.className = 'error';
    status.textContent = `Could not load data: ${e.message}`;
    return;
  }

  const renderer = createRenderer(document.getElementById('canvas'));
  const view = { path: [store.doc.meta.rootGraph], selection: new Set() };
  const start = new URLSearchParams(location.hash.slice(1)).get('g');
  if (start && start !== view.path[0] && store.doc.graphs[start]) view.path.push(start);

  const update = () => {
    const doc = store.doc;
    view.path = view.path.filter((g) => doc.graphs[g]);
    if (!view.path.length) view.path = [doc.meta.rootGraph];
    const graphId = view.path[view.path.length - 1];
    document.getElementById('doc-title').textContent = doc.meta.title;
    document.title = `${doc.meta.title} — FamTee`;
    renderBreadcrumb(doc, view, update);
    renderer.render(doc, graphId, { selection: view.selection });
    status.className = errors.length ? 'error' : 'muted';
    status.textContent = errors.length
      ? `Read-only: ${errors.map((e) => e.message).join('; ')}`
      : store.readOnly ? 'Read-only (file is from a newer FamTee version)' : '';
  };

  renderer.svg.addEventListener('click', (event) => {
    const ref = event.target.closest('[data-ref-graph]');
    const badge = event.target.closest('[data-link-graph]');
    const card = event.target.closest('[data-id]');
    if (ref) {
      view.path.push(ref.dataset.refGraph);
      view.selection = new Set();
    } else if (badge) {
      view.path.push(badge.dataset.linkGraph);
      view.selection = new Set([badge.dataset.linkNode]);
    } else if (card && !card.classList.contains('edge')) {
      view.selection = new Set([card.dataset.id]);
    } else {
      view.selection = new Set();
    }
    update();
  });

  window.famtee = { store, view, update };
  store.subscribe(update);
  update();
}

function renderBreadcrumb(doc, view, update) {
  const nav = document.getElementById('breadcrumb');
  nav.replaceChildren(...view.path.flatMap((graphId, i) => {
    const title = doc.graphs[graphId].title || graphId;
    const last = i === view.path.length - 1;
    const crumb = document.createElement(last ? 'span' : 'button');
    crumb.textContent = title;
    if (!last) {
      crumb.type = 'button';
      crumb.addEventListener('click', () => {
        view.path = view.path.slice(0, i + 1);
        view.selection = new Set();
        update();
      });
    }
    return i ? [document.createTextNode(' › '), crumb] : [crumb];
  }));
}

boot();
