// Document identity for downloads (ADR 0017). Each download records, in meta.revision:
//   hash      SHA-256 of the document's content (everything except meta.revision)
//   savedAt   when it was downloaded (ISO, UTC)
//   parent    the hash of the version it was based on (null for the first download)
// The hash and time also go into the file name, so downloads never overwrite each other.

import { sha256 } from './sha256.js';

export function contentHash(doc) {
  const { revision, ...meta } = doc.meta;
  return sha256(JSON.stringify({ ...doc, meta }));
}

// Returns a copy of doc stamped with a new revision (the input is not changed).
// `parent` is the hash of the version this one is based on; by default the one the
// document itself records.
export function stampRevision(doc, { now = new Date(), parent = doc.meta.revision?.hash ?? null } = {}) {
  const unstamped = { ...doc, meta: { ...doc.meta } };
  delete unstamped.meta.revision;
  const hash = contentHash(unstamped);
  return { ...unstamped, meta: { ...unstamped.meta, revision: { hash, savedAt: now.toISOString(), parent } } };
}

// 'none' (never downloaded), 'ok' (content matches its recorded hash) or 'modified'
// (changed outside FamTee after it was downloaded).
export function checkRevision(doc) {
  const hash = doc.meta?.revision?.hash;
  if (!hash) return 'none';
  return contentHash(doc) === hash ? 'ok' : 'modified';
}

export const shortHash = (hash) => (hash ? hash.slice(0, 6) : '');

// "hanna-family-2026-10-13-153012-ab12cd.html": local date and time, then the hash.
export function downloadName(doc, ext, now = new Date()) {
  const slug = (doc.meta.title || 'family')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase() || 'family';
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const hash = shortHash(doc.meta.revision?.hash);
  return `${slug}-${stamp}${hash ? `-${hash}` : ''}${ext}`;
}
