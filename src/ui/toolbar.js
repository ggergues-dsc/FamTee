// Header toolbar: undo/redo, save, export, import, and the save-state indicator.

import { h, menuButton } from './dom.js';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

export function createToolbar(container, actions) {
  const undo = h('button', { type: 'button', title: `Undo (${mod}Z)`, onclick: actions.undo }, 'Undo');
  const redo = h('button', { type: 'button', title: `Redo (${mod}Shift+Z)`, onclick: actions.redo }, 'Redo');
  const save = h('button', { type: 'button', class: 'primary', title: `Save (${mod}S)`, onclick: actions.save }, 'Save');
  const exportMenu = menuButton('Export ▾', [
    { label: 'FamTee data (.famtee.json)', title: 'The data only, without the app', run: actions.exportJson },
    { label: 'GEDCOM: this graph', title: 'The graph on screen, for other genealogy software', run: actions.exportGedcom },
    {
      label: 'GEDCOM: all graphs merged',
      title: 'Every graph as one tree; people linked as the same person are written once',
      run: actions.exportGedcomMerged,
    },
  ], { title: 'Export data or GEDCOM' });
  const fileInput = h('input', {
    type: 'file', accept: '.json,.html,.htm,.ged,application/json,text/html', hidden: true,
    onchange: () => {
      const [file] = fileInput.files;
      fileInput.value = '';
      if (file) actions.importFile(file);
    },
  });
  const importButton = h('button', {
    type: 'button', title: 'Open a .famtee.json or FamTee .html file, or add a GEDCOM (.ged) file as a new graph', onclick: () => fileInput.click(),
  }, 'Import…');
  const state = h('span', { class: 'save-state', 'aria-live': 'polite' });
  container.replaceChildren(undo, redo, state, save, exportMenu.element, importButton, fileInput);

  function render(store) {
    undo.disabled = store.readOnly || !store.canUndo;
    redo.disabled = store.readOnly || !store.canRedo;
    undo.title = store.canUndo ? `Undo ${store.undoStack.at(-1).label} (${mod}Z)` : 'Nothing to undo';
    save.disabled = store.readOnly;
    importButton.disabled = store.readOnly;
    state.textContent = store.readOnly ? 'Read-only' : store.dirty ? '● Unsaved changes' : 'All changes saved';
    state.classList.toggle('dirty', store.dirty);
  }

  return { render };
}
