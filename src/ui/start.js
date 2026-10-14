// Start screen (ADR 0017), shown every time the app opens. It explains how saving
// works and lets the user choose what to work on:
//   - the family stored in this file (with its saved time, fingerprint and integrity)
//   - an unsaved session kept in this browser (warning if it started from another version)
//   - a new, empty tree
//   - another file (.html, .famtee.json or .ged)
//
// startScreen(host, options) resolves with one of:
//   { kind: 'file' }  { kind: 'continue' }  { kind: 'new', title }  { kind: 'open', doc, name }

import { h } from './dom.js';
import { icon } from './icons.js';
import { shortHash } from '../persist/revision.js';

const count = (doc) => Object.values(doc.graphs).reduce(
  (n, g) => n + Object.values(g.nodes).filter((x) => x.type === 'person').length, 0);
const when = (iso) => (iso ? new Date(iso).toLocaleString() : '');
const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;

// options:
//   embedded   { doc, integrity, problems } | { error } | null   the family in this file
//   draft      { doc, savedAt, baseHash } | null                  unsaved browser session
//   relation   'continues' | 'diverged' | 'other'                 how the draft relates to the file
//   openFile   async (File) => doc                                 parse a chosen file (throws on error)
//   discardDraft () => void
export function startScreen(host, { embedded = null, draft = null, relation = 'other', openFile, discardDraft }) {
  return new Promise((resolve) => {
    const finish = (choice) => {
      overlay.remove();
      resolve(choice);
    };
    const error = h('p', { class: 'start-error', role: 'alert', hidden: true });
    const fail = (message) => {
      error.textContent = message;
      error.hidden = false;
    };

    const choices = [];

    if (embedded?.doc) {
      const doc = embedded.doc;
      const rev = doc.meta.revision;
      const facts = [people(count(doc)), rev ? `saved ${when(rev.savedAt)}` : 'never downloaded from FamTee'];
      if (rev) facts.push(`fingerprint ${shortHash(rev.hash)}`);
      choices.push(card({
        name: 'start-file',
        glyph: 'fileTree',
        title: `Open “${doc.meta.title}”`,
        detail: facts.join(' · '),
        warning: embedded.integrity === 'modified'
          ? 'This file was changed outside FamTee after it was saved (its fingerprint no longer matches).'
          : embedded.problems || '',
        action: 'Open',
        onClick: () => finish({ kind: 'file' }),
        primary: !draft,
      }));
    } else if (embedded?.error) {
      fail(`The family stored in this file couldn't be read: ${embedded.error}`);
    }

    if (draft) {
      const discard = h('button', { type: 'button', class: 'link' }, 'Discard it');
      const draftCard = card({
        name: 'start-continue',
        glyph: 'resume',
        title: relation === 'other' && embedded?.doc
          ? `Continue your unsaved session of “${draft.doc.meta.title}”`
          : 'Continue your unsaved session',
        detail: `“${draft.doc.meta.title}” · ${people(count(draft.doc))} · last change ${when(draft.savedAt)} · kept in this browser, not downloaded`,
        warning: relation === 'diverged'
          ? 'This session started from a different saved version than the file you opened. Continuing keeps the session’s version; download it to keep both.'
          : '',
        action: 'Continue',
        onClick: () => finish({ kind: 'continue' }),
        primary: true,
        extra: discard,
      });
      discard.addEventListener('click', () => {
        if (discard.dataset.armed !== 'yes') {
          discard.dataset.armed = 'yes';
          discard.textContent = 'Click again to discard the unsaved session';
          return;
        }
        discardDraft();
        draftCard.remove();
      });
      choices.push(draftCard);
    }

    const titleInput = h('input', { type: 'text', name: 'new-title', placeholder: 'e.g. Hanna family', autocomplete: 'off', 'aria-label': 'Family name' });
    const startNew = () => finish({ kind: 'new', title: titleInput.value.trim() || 'My family' });
    titleInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') startNew(); });
    choices.push(card({
      name: 'start-new',
      glyph: 'sprout',
      title: 'Start a new tree',
      detail: 'An empty family. You can add people right away.',
      action: 'Start',
      onClick: startNew,
      extra: titleInput,
    }));

    const fileInput = h('input', { type: 'file', name: 'start-file-input', accept: '.html,.htm,.json,.ged', hidden: true });
    fileInput.addEventListener('change', async () => {
      const [file] = fileInput.files;
      fileInput.value = '';
      if (!file) return;
      try {
        finish({ kind: 'open', doc: await openFile(file), name: file.name });
      } catch (e) {
        fail(`${file.name} couldn't be opened: ${e.message}`);
      }
    });
    choices.push(card({
      name: 'start-open',
      glyph: 'folder',
      title: 'Open another file…',
      detail: 'A FamTee file (.html), FamTee data (.famtee.json) or a GEDCOM file (.ged) from other genealogy software.',
      action: 'Choose file…',
      onClick: () => fileInput.click(),
      extra: fileInput,
    }));

    const overlay = h('div', { class: 'start-overlay' },
      h('div', { class: 'start', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'start-title' },
        h('h1', { id: 'start-title' }, 'FamTee'),
        h('p', { class: 'start-intro' },
          'While you work, your changes are kept ', h('strong', {}, 'in this browser only'),
          '. Nothing is written to your disk until you click ', h('strong', {}, 'Download'),
          '. Each download is a new file named with the date, time and a fingerprint of its content, so earlier files are never overwritten.'),
        error,
        h('div', { class: 'start-choices' }, choices)));
    host.append(overlay);
    (overlay.querySelector('.start-choice.primary button.primary') ?? overlay.querySelector('button.primary'))?.focus();
  });
}

function card({ name, glyph, title, detail, warning = '', action, onClick, primary = false, extra = null }) {
  return h('section', { class: `start-choice${primary ? ' primary' : ''}`, dataset: { choice: name } },
    h('div', { class: 'start-choice-head' }, h('span', { class: 'start-choice-icon' }, icon(glyph)), h('h2', {}, title)),
    h('p', { class: 'muted' }, detail),
    warning ? h('p', { class: 'start-warning' }, warning) : null,
    h('div', { class: 'row' },
      extra && extra.tagName === 'INPUT' && extra.type !== 'file' ? extra : null,
      h('button', { type: 'button', class: primary ? 'primary' : '', onclick: onClick }, action),
      extra && !(extra.tagName === 'INPUT' && extra.type !== 'file') ? extra : null));
}
