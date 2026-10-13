import { test, assert, assertEqual } from './harness.js';
import { startScreen } from '../src/ui/start.js';
import { attributeRows } from '../src/ui/panel.js';
import { stampRevision } from '../src/persist/revision.js';
import { addMedia, setPhoto } from '../src/store/media.js';
import { addGroup, updateNodeAttrs } from '../src/store/model.js';
import { smallFamily } from './fixtures.js';

const host = () => document.body;
const choice = (name) => document.querySelector(`.start-choice[data-choice="${name}"]`);
const btn = (name) => choice(name)?.querySelector('button.primary, button:not(.link)');
const settle = () => new Promise((r) => setTimeout(r, 0));

test('start screen: explains saving and offers the file, a new tree and another file', async () => {
  const doc = stampRevision(smallFamily().doc, { now: new Date(Date.UTC(2026, 9, 13, 15, 30)) });
  const pending = startScreen(host(), { embedded: { doc, integrity: 'ok' }, openFile: async () => null });
  const overlay = document.querySelector('.start-overlay');
  assert(overlay.textContent.includes('in this browser only') && overlay.textContent.includes('Download'), 'explains saving');
  assertEqual(choice('start-file').querySelector('h2').textContent, `Open “${doc.meta.title}”`);
  assert(choice('start-file').textContent.includes('3 people'));
  assert(choice('start-file').textContent.includes(`fingerprint ${doc.meta.revision.hash.slice(0, 6)}`));
  assert(!choice('start-continue'), 'no draft, no continue option');
  assert(choice('start-new') && choice('start-open'));
  btn('start-file').click();
  assertEqual(await pending, { kind: 'file' });
  assert(!document.querySelector('.start-overlay'), 'screen removed');
});

test('start screen: warns about a modified file and a diverged session; continue and discard', async () => {
  const { doc } = smallFamily();
  const draft = { doc: structuredClone(doc), savedAt: '2026-10-13T15:00:00Z', baseHash: 'old' };
  let discarded = 0;
  let pending = startScreen(host(), {
    embedded: { doc, integrity: 'modified' }, draft, relation: 'diverged',
    openFile: async () => null, discardDraft: () => discarded++,
  });
  assert(choice('start-file').querySelector('.start-warning').textContent.includes('changed outside FamTee'));
  assert(choice('start-continue').querySelector('.start-warning').textContent.includes('different saved version'));
  assert(choice('start-continue').classList.contains('primary'), 'unsaved work is the suggested choice');
  btn('start-continue').click();
  assertEqual(await pending, { kind: 'continue' });

  pending = startScreen(host(), { embedded: null, draft, relation: 'other', openFile: async () => null, discardDraft: () => discarded++ });
  const discard = choice('start-continue').querySelector('button.link');
  discard.click();
  assertEqual(discarded, 0, 'first click only arms');
  discard.click();
  assertEqual(discarded, 1);
  assert(!choice('start-continue'));
  choice('start-new').querySelector('input').value = '  Hanna family ';
  btn('start-new').click();
  assertEqual(await pending, { kind: 'new', title: 'Hanna family' });
});

test('start screen: a new tree gets a default name; opening a bad file shows why and stays open', async () => {
  let pending = startScreen(host(), { embedded: { error: 'broken JSON' }, openFile: async () => { throw new Error('not a FamTee file'); } });
  assert(document.querySelector('.start-error').textContent.includes('broken JSON'));
  assert(!choice('start-file'));
  const input = choice('start-open').querySelector('input[type="file"]');
  const transfer = new DataTransfer();
  transfer.items.add(new File(['x'], 'notes.txt'));
  input.files = transfer.files;
  input.dispatchEvent(new Event('change'));
  await settle();
  await settle();
  assert(document.querySelector('.start-error').textContent.includes('notes.txt couldn\'t be opened: not a FamTee file'));
  assert(document.querySelector('.start-overlay'), 'still open');
  choice('start-new').querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  assertEqual(await pending, { kind: 'new', title: 'My family' });

  pending = startScreen(host(), { openFile: async (file) => ({ opened: file.name }) });
  const input2 = choice('start-open').querySelector('input[type="file"]');
  const t2 = new DataTransfer();
  t2.items.add(new File(['0 HEAD'], 'tree.ged'));
  input2.files = t2.files;
  input2.dispatchEvent(new Event('change'));
  assertEqual(await pending, { kind: 'open', doc: { opened: 'tree.ged' }, name: 'tree.ged' });
});

test('all attributes lists every stored attribute, including ones without a form field', () => {
  const { doc, g, mum, union } = smallFamily();
  updateNodeAttrs(doc, g, mum, {
    name: { given: 'Ann', surname: 'Lee', suffix: 'Jr.' }, sex: 'F', birth: { date: '1950', place: 'Cairo' },
    nudge: { dx: 40, dy: 0 }, occupation: 'Engineer', tags: ['a', 'b'],
  });
  setPhoto(doc, g, mum, addMedia(doc, { mime: 'image/jpeg', data: 'data:image/jpeg;base64,/9j/4AAQ', width: 256, height: 192 }));
  const rows = Object.fromEntries(attributeRows(doc, g, mum, doc.graphs[g].nodes[mum]));
  assertEqual(rows.Type, 'person');
  assertEqual(rows.ID, mum);
  assertEqual(rows['Name · suffix'], 'Jr.', 'suffix has no form field but is shown');
  assertEqual(rows['Born · place'], 'Cairo');
  assertEqual(rows.Sex, 'Female');
  assertEqual(rows['Manual position'], 'moved 40, 0 from the automatic layout');
  assertEqual(rows.occupation, 'Engineer', 'unknown imported fields are shown as stored');
  assertEqual(rows.tags, 'a, b');
  assert(rows.Photo.startsWith('256×192 JPEG'));
  const unionRows = Object.fromEntries(attributeRows(doc, g, union, doc.graphs[g].nodes[union]));
  assertEqual(unionRows.Type, 'partnership');
  const group = addGroup(doc, g, [mum], { label: 'Home' });
  assertEqual(Object.fromEntries(attributeRows(doc, g, group, doc.graphs[g].nodes[group])).Members, 'Ann Lee');
});
