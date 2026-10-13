// Bootstrap: load the embedded document (or start a blank one) into a Store.
// Rendering is not implemented yet; this shows a summary of what was loaded.

import { createDocument } from './store/model.js';
import { loadDocument, readEmbedded } from './store/serialize.js';
import { Store } from './store/store.js';

function boot() {
  const app = document.getElementById('app');
  const text = readEmbedded(document);
  let store;
  let errors = [];
  try {
    if (text) {
      const loaded = loadDocument(text);
      errors = loaded.errors;
      store = new Store(loaded.doc, { readOnly: loaded.readOnly || errors.length > 0 });
    } else {
      store = new Store(createDocument());
    }
  } catch (e) {
    app.innerHTML = '';
    app.append(el('p', 'error', `Could not load data: ${e.message}`));
    return;
  }
  window.famtee = { store };
  store.subscribe(() => render(app, store, errors));
  render(app, store, errors);
}

function render(app, store, errors) {
  const { doc } = store;
  const graphs = Object.values(doc.graphs);
  const people = graphs.reduce(
    (n, g) => n + Object.values(g.nodes).filter((node) => node.type === 'person').length, 0);
  app.replaceChildren(
    el('h1', '', doc.meta.title),
    el('p', 'muted', `${graphs.length} graph(s), ${people} person node(s), ${doc.links.length} cross-graph link(s)` +
      (store.readOnly ? ' — read-only' : '')),
    ...errors.map((e) => el('p', 'error', e.message)),
  );
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

boot();
