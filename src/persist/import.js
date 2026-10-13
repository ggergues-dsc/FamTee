// Importing a document from a .famtee.json file or from another FamTee .html file.

import { loadDocument, readEmbedded } from '../store/serialize.js';

// Returns the loadDocument() result. Throws when the input holds no FamTee data.
export function parseImport(text) {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<')) {
    const parsed = new DOMParser().parseFromString(text, 'text/html');
    const embedded = readEmbedded(parsed);
    if (!embedded) throw new Error('This HTML file contains no FamTee data');
    return loadDocument(embedded);
  }
  const result = loadDocument(text);
  if (result.doc?.format !== 'famtee') throw new Error('Not a FamTee file');
  return result;
}
