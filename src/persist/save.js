// Saving the document (ADR 0006): the whole app as one HTML file, or the data as
// JSON. Chromium writes in place via the File System Access API; other browsers
// download a new copy.

import { replaceDataBlock, serialize } from '../store/serialize.js';

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

export function fileName(doc, ext) {
  const base = (doc.meta.title || 'family')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return `${base || 'family'}${ext}`;
}

export const FORMATS = {
  html: { ext: '.html', mime: 'text/html', description: 'FamTee file' },
  json: { ext: '.famtee.json', mime: 'application/json', description: 'FamTee data' },
};

export function documentContents(kind, doc, template) {
  return kind === 'html' ? buildHtml(template, doc) : serialize(doc);
}

// Writes `contents`. Returns { method: 'fsa' | 'download', handle } or throws.
// A user cancelling the file picker raises an AbortError, which callers ignore.
// `env` is injectable for tests.
export async function writeFile({ contents, kind, suggestedName, handle = null }, env = globalThis) {
  const format = FORMATS[kind];
  if (typeof env.showSaveFilePicker === 'function') {
    const target = handle ?? (await env.showSaveFilePicker({
      suggestedName,
      types: [{ description: format.description, accept: { [format.mime]: [format.ext] } }],
    }));
    const writable = await target.createWritable();
    await writable.write(contents);
    await writable.close();
    return { method: 'fsa', handle: target };
  }
  download(contents, format.mime, suggestedName, env);
  return { method: 'download', handle: null };
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
