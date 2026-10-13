// Reading and writing documents as JSON text and as the data block embedded in
// famtee.html (ADR 0001).

import { migrate } from './migrate.js';
import { validate } from './validate.js';

export const DATA_ELEMENT_ID = 'famtee-data';

const DATA_BLOCK = /(<script type="application\/json" id="famtee-data">)([\s\S]*?)(<\/script>)/;

export function serialize(doc, { pretty = true } = {}) {
  return JSON.stringify(doc, null, pretty ? 2 : 0);
}

// Escaping "<" keeps the JSON valid while making "</script>" impossible inside the block.
export function toScriptSafe(json) {
  return json.replace(/</g, '\\u003c');
}

// Parses, migrates and validates. Throws on unreadable input; returns validation
// errors alongside the document so the UI can decide how to present them.
export function loadDocument(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`Not valid JSON: ${e.message}`);
  }
  const { doc, readOnly, migratedFrom } = migrate(raw);
  const errors = readOnly ? [] : validate(doc);
  return { doc, readOnly, migratedFrom, errors };
}

// Returns the embedded document text, or null when the block is missing or empty.
export function readEmbedded(root = document) {
  const el = root.getElementById(DATA_ELEMENT_ID);
  const text = el?.textContent.trim();
  return text ? text : null;
}

// Returns `html` with the data block replaced by `doc`.
export function replaceDataBlock(html, doc) {
  if (!DATA_BLOCK.test(html)) throw new Error('No famtee-data block found in HTML');
  const json = toScriptSafe(serialize(doc, { pretty: false }));
  return html.replace(DATA_BLOCK, (_, open, _old, close) => open + json + close);
}
