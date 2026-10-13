import { test, assert, assertEqual, assertThrows } from './harness.js';
import { loadDocument, readEmbedded, replaceDataBlock, serialize, toScriptSafe } from '../src/store/serialize.js';
import { updateNodeAttrs } from '../src/store/model.js';
import { smallFamily } from './fixtures.js';

const SHELL = '<html><body><script type="application/json" id="famtee-data"></script><script>app()</script></body></html>';

test('serialize and loadDocument round-trip', () => {
  const { doc } = smallFamily();
  const loaded = loadDocument(serialize(doc));
  assertEqual(loaded.doc, doc);
  assertEqual(loaded.errors, []);
  assert(!loaded.readOnly);
});

test('loadDocument reports invalid JSON and validation errors', () => {
  assertThrows(() => loadDocument('{nope'), /Not valid JSON/);
  const { doc } = smallFamily();
  doc.meta.rootGraph = 'g-missing';
  assertEqual(loadDocument(serialize(doc)).errors.map((e) => e.code), ['root-graph']);
});

test('script-safe JSON cannot close the script tag and still parses', () => {
  const json = JSON.stringify({ note: '</script><script>alert(1)</script>' });
  const safe = toScriptSafe(json);
  assert(!safe.includes('<'));
  assertEqual(JSON.parse(safe), JSON.parse(json));
});

test('replaceDataBlock embeds a document that survives HTML parsing', () => {
  const { doc, g, mum } = smallFamily();
  updateNodeAttrs(doc, g, mum, { notes: 'tricky </script> & <b>text</b>' });
  const html = replaceDataBlock(SHELL, doc);
  assert(html.endsWith('<script>app()</script></body></html>'));
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  assertEqual(loadDocument(readEmbedded(parsed)).doc, doc);
  assertEqual(replaceDataBlock(replaceDataBlock(html, doc), doc), html, 'replacing twice is stable');
});

test('readEmbedded returns null for an empty block', () => {
  const parsed = new DOMParser().parseFromString(SHELL, 'text/html');
  assertEqual(readEmbedded(parsed), null);
  assertThrows(() => replaceDataBlock('<html></html>', {}), /No famtee-data block/);
});
