import { test, assert, assertEqual, assertThrows } from './harness.js';
import { saveDraft, findNewerDraft, clearDraft, draftKey, debounce } from '../src/persist/autosave.js';
import { captureTemplate, isSelfContained, buildHtml, fileName, writeFile, documentContents } from '../src/persist/save.js';
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
    data,
  };
}

const brokenStorage = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
  removeItem() { throw new Error('denied'); },
};

test('drafts are found only when newer than the document', () => {
  const storage = memoryStorage();
  const { doc } = smallFamily();
  doc.meta.modified = '2026-01-01T00:00:00.000Z';
  assertEqual(findNewerDraft(storage, doc), null);
  const edited = structuredClone(doc);
  edited.meta.modified = '2026-01-02T00:00:00.000Z';
  assert(saveDraft(storage, edited));
  assert(storage.data.has(draftKey(doc)));
  assertEqual(findNewerDraft(storage, doc).doc, edited);
  assertEqual(findNewerDraft(storage, edited), null, 'not newer than itself');
  clearDraft(storage, doc);
  assertEqual(findNewerDraft(storage, doc), null);
});

test('autosave tolerates unavailable storage', () => {
  const { doc } = smallFamily();
  assertEqual(saveDraft(brokenStorage, doc), false);
  assertEqual(findNewerDraft(brokenStorage, doc), null);
  clearDraft(brokenStorage, doc);
  const storage = memoryStorage();
  storage.setItem(draftKey(doc), '{not json');
  assertEqual(findNewerDraft(storage, doc), null);
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

test('file names are safe', () => {
  const doc = { meta: { title: 'Hanna / Saleh: Família 2026!' } };
  assertEqual(fileName(doc, '.html'), 'hanna-saleh-familia-2026.html');
  assertEqual(fileName({ meta: { title: '***' } }, '.famtee.json'), 'family.famtee.json');
});

test('writeFile uses the File System Access API and reuses the handle', async () => {
  const written = [];
  let pickerCalls = 0;
  const handle = {
    async createWritable() {
      return { write: async (c) => written.push(c), close: async () => written.push('closed') };
    },
  };
  const env = { showSaveFilePicker: async (opts) => { pickerCalls++; assertEqual(opts.suggestedName, 'a.html'); return handle; } };
  const first = await writeFile({ contents: 'one', kind: 'html', suggestedName: 'a.html' }, env);
  assertEqual(first, { method: 'fsa', handle });
  await writeFile({ contents: 'two', kind: 'html', suggestedName: 'a.html', handle: first.handle }, env);
  assertEqual(pickerCalls, 1);
  assertEqual(written, ['one', 'closed', 'two', 'closed']);
});

test('writeFile falls back to a download', async () => {
  const clicks = [];
  const env = {
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    document: {
      body: { append: () => {} },
      createElement: () => ({ style: {}, click() { clicks.push([this.href, this.download]); }, remove() {} }),
    },
  };
  const result = await writeFile({ contents: 'x', kind: 'json', suggestedName: 'f.famtee.json' }, env);
  assertEqual(result.method, 'download');
  assertEqual(clicks, [['blob:x', 'f.famtee.json']]);
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
