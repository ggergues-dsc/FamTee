// Embedded photos (ADR 0013). Images live once in doc.media and nodes refer to
// them by id (attrs.photo), so a person copied into another graph shares the image.
//
// doc.media is APPEND-ONLY while the app runs: entries are added, never changed or
// removed. That lets undo snapshots share it instead of copying megabytes of image
// data on every edit (see Store). Entries no longer referenced are dropped when
// the document is written out (withoutUnusedMedia).

import { newId } from './ids.js';
import { getNode } from './model.js';

// Only inline raster images are accepted; anything else could smuggle in content
// that isn't a picture.
export const SAFE_IMAGE_DATA = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

export function isSafeImageData(data) {
  return typeof data === 'string' && SAFE_IMAGE_DATA.test(data);
}

// Adds { mime, data, width, height, thumb? } and returns its id. `data` is the medium
// size; the optional `thumb: { data, width, height }` is a miniature for small avatars.
// The same image added twice gets the existing id.
export function addMedia(doc, entry) {
  if (!isSafeImageData(entry.data)) throw new Error('Not a supported image');
  if (entry.thumb && !isSafeImageData(entry.thumb.data)) throw new Error('Not a supported image');
  doc.media ??= {};
  for (const [id, m] of Object.entries(doc.media)) if (m.data === entry.data) return id;
  const id = newId('media');
  doc.media[id] = { mime: entry.mime, data: entry.data, width: entry.width, height: entry.height };
  if (entry.thumb) doc.media[id].thumb = { data: entry.thumb.data, width: entry.thumb.width, height: entry.thumb.height };
  return id;
}

// The image data to show at a given size: the miniature for small avatars when there
// is a safe one, otherwise the medium image (older files have only that). Null if unsafe.
export function mediaData(media, size = 'medium') {
  if (!media || !isSafeImageData(media.data)) return null;
  if (size === 'thumb' && isSafeImageData(media.thumb?.data)) return media.thumb.data;
  return media.data;
}

// Sets or (with null) clears a node's photo.
export function setPhoto(doc, graphId, nodeId, mediaId) {
  const node = getNode(doc, graphId, nodeId);
  if (mediaId === null || mediaId === undefined) {
    delete node.attrs.photo;
    return;
  }
  if (!doc.media?.[mediaId]) throw new Error(`Unknown photo: ${mediaId}`);
  node.attrs.photo = mediaId;
}

export function usedMediaIds(doc) {
  const used = new Set();
  for (const graph of Object.values(doc.graphs)) {
    for (const node of Object.values(graph.nodes)) if (node.attrs?.photo) used.add(node.attrs.photo);
  }
  return used;
}

// A shallow copy of the document for writing out, without unreferenced images.
export function withoutUnusedMedia(doc) {
  if (!doc.media) return doc;
  const used = usedMediaIds(doc);
  const media = Object.fromEntries(Object.entries(doc.media).filter(([id]) => used.has(id)));
  return { ...doc, media };
}

// Decoded size in bytes of a base64 data URI.
export function imageBytes(data) {
  const base64 = data.slice(data.indexOf(',') + 1);
  return Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
}

// "under 1 KB", "23 KB", "2.4 MB".
export function formatSize(bytes) {
  if (bytes < 1024) return 'under 1 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// { count, bytes } of the images that would be saved.
export function mediaUsage(doc) {
  const media = Object.values(withoutUnusedMedia(doc).media ?? {});
  return { count: media.length, bytes: media.reduce((n, m) => n + imageBytes(m.data) + (m.thumb?.data ? imageBytes(m.thumb.data) : 0), 0) };
}
