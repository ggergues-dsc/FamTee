// Header toolbar (ADR 0017): undo/redo, where your changes are, Download (the only
// way to write to disk), Export ▾ and Open….

import { h, menuButton } from './dom.js';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// actions: undo, redo, download, exportJson, exportGedcom, exportGedcomMerged, openFile(File)
export function createToolbar(container, actions) {
  const undo = h('button', { type: 'button', title: `Undo (${mod}Z)`, onclick: actions.undo }, 'Undo');
  const redo = h('button', { type: 'button', title: `Redo (${mod}Shift+Z)`, onclick: actions.redo }, 'Redo');
  const download = h('button', {
    type: 'button', class: 'primary', onclick: actions.download,
    title: `Download the family as a new file (${mod}S). Your disk is only written when you download.`,
  }, 'Download');
  const exportMenu = menuButton('Export ▾', [
    { label: 'FamTee data (.famtee.json)', title: 'The data only, without the app', run: actions.exportJson },
    { label: 'GEDCOM (.ged)', title: 'This tree, for other genealogy software', run: actions.exportGedcom },
    {
      label: 'GEDCOM: all graphs merged',
      title: 'Every graph as one tree; people linked as the same person are written once',
      run: actions.exportGedcomMerged,
    },
  ], { title: 'Export data or GEDCOM' });
  const mergedItem = exportMenu.items[2];
  const fileInput = h('input', {
    type: 'file', accept: '.json,.html,.htm,.ged', hidden: true,
    onchange: () => {
      const [file] = fileInput.files;
      fileInput.value = '';
      if (file) actions.openFile(file);
    },
  });
  const open = h('button', {
    type: 'button', onclick: () => fileInput.click(),
    title: 'Open a FamTee file (.html), FamTee data (.famtee.json) or GEDCOM (.ged) in place of this family. Undo brings this one back.',
  }, 'Open…');
  const state = h('span', { class: 'save-state', 'aria-live': 'polite' });
  container.replaceChildren(undo, redo, state, download, exportMenu.element, open, fileInput);

  // session: { draftAt, downloadedAt, downloadName, storageOk, multiGraph }
  function render(store, session = {}) {
    undo.disabled = store.readOnly || !store.canUndo;
    redo.disabled = store.readOnly || !store.canRedo;
    undo.title = store.canUndo ? `Undo ${store.undoStack.at(-1).label} (${mod}Z)` : 'Nothing to undo';
    open.disabled = store.readOnly;
    mergedItem.hidden = !session.multiGraph;

    let text;
    let title;
    let kind = '';
    if (store.readOnly) {
      text = 'Read-only';
      title = 'This family can be viewed and downloaded, not edited';
    } else if (store.dirty && session.storageOk === false) {
      text = 'Not backed up · download to keep your work';
      title = 'This browser refused to keep your changes (storage full or blocked). Download now so nothing is lost.';
      kind = 'error';
    } else if (store.dirty) {
      text = session.draftAt ? `Kept in this browser ${time(session.draftAt)} · not downloaded` : 'Changes not downloaded yet';
      title = 'Your changes are kept in this browser only. Click Download to save them to your disk as a new file.';
      kind = 'dirty';
    } else if (session.downloadedAt) {
      text = `Downloaded ${time(session.downloadedAt)}`;
      title = `Saved to your disk as ${session.downloadName}`;
    } else {
      text = 'No unsaved changes';
      title = 'Nothing has changed since this family was opened';
    }
    state.textContent = text;
    state.title = title;
    state.className = `save-state ${kind}`.trim();
  }

  return { render };
}
