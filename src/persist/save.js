// Writing the document to disk (ADR 0006, 0017): the whole app as one HTML file, or
// the data as JSON, always as a download. Nothing is overwritten in place.

import { replaceDataBlock, serialize } from '../store/serialize.js';
import { withoutUnusedMedia } from '../store/media.js';

// The page's own HTML as it was at startup, before any rendering changed the DOM.
// Call this before the app touches the document.
export function captureTemplate(root = document) {
  return '<!doctype html>\n' + root.documentElement.outerHTML;
}

// A page loaded from separate ES modules (development mode) cannot be saved as a
// self-contained file; only the built single file can.
export function isSelfContained(root = document) {
  return !root.querySelector('script[type="module"], script[src], link[rel="stylesheet"]');
}

export function buildHtml(template, doc) {
  return replaceDataBlock(template, doc);
}


export const FORMATS = {
  html: { ext: '.html', mime: 'text/html', description: 'FamTee file' },
  json: { ext: '.famtee.json', mime: 'application/json', description: 'FamTee data' },
  gedcom: { ext: '.ged', mime: 'application/x-gedcom', description: 'GEDCOM file' },
};

// Unreferenced photos (left behind by undo or removal) are dropped on the way out.
export function documentContents(kind, doc, template) {
  const out = withoutUnusedMedia(doc);
  return kind === 'html' ? buildHtml(template, out) : serialize(out);
}

// Downloads `contents` as a file (ADR 0017: the only way FamTee writes to disk).
// `env` is injectable for tests.
export function downloadFile({ contents, kind, filename }, env = globalThis) {
  download(contents, FORMATS[kind].mime, filename, env);
}

function download(contents, mime, name, env) {
  const url = env.URL.createObjectURL(new Blob([contents], { type: mime }));
  const a = env.document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  env.document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => env.URL.revokeObjectURL(url), 10000);
}
