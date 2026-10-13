import { test, assert, assertEqual, assertThrows } from './harness.js';
import {
  saveDraft, loadDraft, draftRelation, lastSessionDraft, clearDraft, draftKey, recordDownload, lastDownload, debounce,
} from '../src/persist/autosave.js';
import { captureTemplate, isSelfContained, buildHtml, downloadFile, documentContents } from '../src/persist/save.js';
import { stampRevision } from '../src/persist/revision.js';
import { createDocument } from '../src/store/model.js';
import { parseImport } from '../src/persist/import.js';
import { readEmbedded, loadDocument, serialize } from '../src/store/serialize.js';
import { updateNodeAttrs } from '../src/store/model.js';
import { smallFamily } from './fixtures.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    key: (i) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
    data,
  };
}

const brokenStorage = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
  removeItem() { throw new Error('denied'); },
};

test('drafts remember the version they started from', () => {
  const storage = memoryStorage();
  const file = stampRevision(smallFamily().doc);
  assertEqual(draftRelation(storage, file).relation, 'none');

  const work = structuredClone(file);
  work.meta.title = 'edited';
  assert(saveDraft(storage, work, { baseHash: file.meta.revision.hash, now: new Date(Date.UTC(2026, 9, 13)) }));
  const { relation, draft } = draftRelation(storage, file);
  assertEqual(relation, 'continues');
  assertEqual(draft.doc.meta.title, 'edited');
  assertEqual(draft.savedAt, '2026-10-13T00:00:00.000Z');
  assertEqual(lastSessionDraft(storage).doc.meta.id, file.meta.id, 'remembered as the last session');

  const otherVersion = stampRevision({ ...file, meta: { ...file.meta, title: 'someone else saved this' } });
  assertEqual(draftRelation(storage, otherVersion).relation, 'diverged', 'file is a different version than the draft’s base');
  clearDraft(storage, file);
  assertEqual(loadDraft(storage, file.meta.id), null);
});

test('only the 5 most recent drafts are kept', () => {
  const storage = memoryStorage();
  const docs = Array.from({ length: 7 }, () => createDocument());
  docs.forEach((d, i) => saveDraft(storage, d, { now: new Date(Date.UTC(2026, 0, 1 + i)) }));
  assertEqual(docs.map((d) => loadDraft(storage, d.meta.id) !== null), [false, false, true, true, true, true, true]);
  assertEqual(lastSessionDraft(storage).doc.meta.id, docs[6].meta.id);
});

test('downloads are recorded per family', () => {
  const storage = memoryStorage();
  const stamped = stampRevision(smallFamily().doc, { now: new Date(Date.UTC(2026, 9, 13, 15, 30)) });
  recordDownload(storage, stamped, 'family-x.html');
  assertEqual(lastDownload(storage, stamped.meta.id), { hash: stamped.meta.revision.hash, savedAt: '2026-10-13T15:30:00.000Z', filename: 'family-x.html' });
  assertEqual(lastDownload(storage, 'other'), null);
});

test('browser storage problems never throw', () => {
  const { doc } = smallFamily();
  assertEqual(saveDraft(brokenStorage, doc), false);
  assertEqual(loadDraft(brokenStorage, doc.meta.id), null);
  assertEqual(lastSessionDraft(brokenStorage), null);
  assertEqual(draftRelation(brokenStorage, doc).relation, 'none');
  clearDraft(brokenStorage, doc);
  recordDownload(brokenStorage, stampRevision(doc), 'x');
  const storage = memoryStorage();
  storage.setItem(draftKey(doc), '{not json');
  assertEqual(loadDraft(storage, doc.meta.id), null);
});

test('debounce runs once after quiet, flush runs now', async () => {
  let calls = 0;
  const d = debounce(() => calls++, 20);
  d(); d(); d();
  assertEqual(calls, 0);
  await new Promise((r) => setTimeout(r, 50));
  assertEqual(calls, 1);
  d();
  d.flush();
  await new Promise((r) => setTimeout(r, 50));
  assertEqual(calls, 2);
});

test('the page template saves a document that loads back', () => {
  const { doc, g, mum } = smallFamily();
  updateNodeAttrs(doc, g, mum, { notes: '</script><b>x</b> ünïcode' });
  const html = buildHtml(captureTemplate(), doc);
  assert(html.startsWith('<!doctype html>'));
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  assertEqual(loadDocument(readEmbedded(parsed)).doc, doc);
  assertEqual(parsed.querySelectorAll('b').length, 0);
});

test('only single-file pages can save themselves', () => {
  const parse = (s) => new DOMParser().parseFromString(s, 'text/html');
  assert(isSelfContained(parse('<style></style><script>x()</script>')));
  assert(!isSelfContained(parse('<script type="module" src="./main.js"></script>')));
  assert(!isSelfContained(parse('<link rel="stylesheet" href="a.css">')));
});

test('downloadFile always downloads (never writes in place)', () => {
  const clicks = [];
  const env = {
    showSaveFilePicker: () => { throw new Error('must not be used'); },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    document: {
      body: { append: () => {} },
      createElement: () => ({ style: {}, click() { clicks.push([this.href, this.download]); }, remove() {} }),
    },
  };
  downloadFile({ contents: 'x', kind: 'html', filename: 'family-2026-10-13-153012-ab12cd.html' }, env);
  assertEqual(clicks, [['blob:x', 'family-2026-10-13-153012-ab12cd.html']]);
});

test('documentContents produces HTML or JSON', () => {
  const { doc } = smallFamily();
  assertEqual(JSON.parse(documentContents('json', doc, '')), doc);
  assert(documentContents('html', doc, captureTemplate()).includes(doc.meta.id));
});

test('import reads JSON files and FamTee HTML files', () => {
  const { doc } = smallFamily();
  assertEqual(parseImport(serialize(doc)).doc, doc);
  assertEqual(parseImport(buildHtml(captureTemplate(), doc)).doc, doc);
  assertThrows(() => parseImport('<html><body>hi</body></html>'), /no FamTee data/);
  assertThrows(() => parseImport('not json'), /Not valid JSON/);
  assertThrows(() => parseImport('{"schemaVersion":1}'), /Not a FamTee file/);
});
