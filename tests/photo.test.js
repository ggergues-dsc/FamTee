import { test, assert, assertEqual, assertThrows } from './harness.js';
import { photoFromFile, PHOTO_MAX } from '../src/io/photo.js';
import {
  addMedia, setPhoto, withoutUnusedMedia, mediaUsage, usedMediaIds, isSafeImageData, imageBytes, formatSize,
} from '../src/store/media.js';
import { addGraph } from '../src/store/model.js';
import { copyPersonTo } from '../src/store/family.js';
import { validate } from '../src/store/validate.js';
import { Store } from '../src/store/store.js';
import { documentContents } from '../src/persist/save.js';
import { saveDraft, draftKey } from '../src/persist/autosave.js';
import { createRenderer } from '../src/render/renderer.js';
import { exportGedcom } from '../src/io/gedcom/export.js';
import { smallFamily } from './fixtures.js';

async function imageFile(width, height, type = 'image/png', name = 'photo.png') {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  g.fillStyle = '#c33';
  g.fillRect(0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type));
  return new File([blob], name, { type });
}

// A tiny valid JPEG data URI for model tests (no decoding needed).
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const PHOTO = { mime: 'image/jpeg', data: JPEG, width: 10, height: 10 };

async function assertRejects(promise, pattern) {
  try {
    await promise;
  } catch (e) {
    assert(pattern.test(e.message), `threw "${e.message}", expected ${pattern}`);
    return;
  }
  throw new Error(`expected rejection matching ${pattern}`);
}

test('photos are shrunk to fit 256 px and re-encoded as JPEG', async () => {
  const photo = await photoFromFile(await imageFile(1000, 500));
  assertEqual([photo.width, photo.height, photo.mime], [PHOTO_MAX, 128, 'image/jpeg']);
  assert(photo.data.startsWith('data:image/jpeg;base64,') && isSafeImageData(photo.data));
  const small = await photoFromFile(await imageFile(40, 30, 'image/jpeg', 'small.jpg'));
  assertEqual([small.width, small.height], [40, 30], 'never enlarged');
});

test('non-images and damaged images are refused with a readable message', async () => {
  await assertRejects(photoFromFile(new File(['hello'], 'notes.txt', { type: 'text/plain' })), /notes\.txt isn't a JPEG, PNG, WebP or GIF/);
  await assertRejects(photoFromFile(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })), /isn't a JPEG/);
  await assertRejects(photoFromFile(new File(['garbage'], 'broken.png', { type: 'image/png' })), /couldn't be read/);
});

test('media store: add, dedupe, set and clear; only safe images', () => {
  const { doc, g, mum, dad } = smallFamily();
  const id = addMedia(doc, PHOTO);
  assert(id.startsWith('m-'));
  assertEqual(addMedia(doc, { ...PHOTO }), id, 'same image is stored once');
  setPhoto(doc, g, mum, id);
  setPhoto(doc, g, dad, id);
  assertEqual(doc.graphs[g].nodes[mum].attrs.photo, id);
  assertEqual(usedMediaIds(doc), new Set([id]));
  setPhoto(doc, g, mum, null);
  assert(!('photo' in doc.graphs[g].nodes[mum].attrs));
  assertThrows(() => setPhoto(doc, g, mum, 'm-missing'), /Unknown photo/);
  for (const data of ['data:text/html;base64,PGI+', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,ab"onload']) {
    assertThrows(() => addMedia(doc, { ...PHOTO, data }), /Not a supported image/);
  }
  assertEqual(validate(doc), []);
});

test('validation catches missing photos and unsafe media', () => {
  const { doc, g, mum } = smallFamily();
  doc.graphs[g].nodes[mum].attrs.photo = 'm-missing';
  assertEqual(validate(doc).map((e) => e.code), ['photo']);
  doc.graphs[g].nodes[mum].attrs.photo = 'm-bad';
  doc.media = { 'm-bad': { data: 'data:text/html;base64,PGI+' } };
  assertEqual(validate(doc).map((e) => e.code), ['media-data']);
  doc.media = [];
  assert(validate(doc).some((e) => e.code === 'media'));
});

test('unused photos are dropped when written out, and counted only if used', () => {
  const { doc, g, mum } = smallFamily();
  const used = addMedia(doc, PHOTO);
  addMedia(doc, { ...PHOTO, data: 'data:image/png;base64,iVBORw0KGgo=' });
  setPhoto(doc, g, mum, used);
  assertEqual(Object.keys(withoutUnusedMedia(doc).media), [used]);
  assertEqual(Object.keys(doc.media).length, 2, 'the live document is untouched');
  assertEqual(mediaUsage(doc), { count: 1, bytes: imageBytes(JPEG) });
  assertEqual(Object.keys(JSON.parse(documentContents('json', doc, '')).media), [used]);
  const storage = new Map();
  saveDraft({ setItem: (k, v) => storage.set(k, v) }, doc);
  assertEqual(Object.keys(JSON.parse(storage.get(draftKey(doc))).doc.media), [used]);
});

test('image sizes are computed from base64 and shown readably', () => {
  assertEqual(imageBytes('data:image/png;base64,AAAA'), 3);
  assertEqual(imageBytes('data:image/png;base64,AAA='), 2);
  assertEqual(imageBytes('data:image/png;base64,AA=='), 1);
  assertEqual([formatSize(500), formatSize(23 * 1024), formatSize(2.4 * 1024 * 1024)], ['under 1 KB', '23 KB', '2.4 MB']);
});

test('a person copied into another graph shares the photo', () => {
  const { doc, g, mum } = smallFamily();
  setPhoto(doc, g, mum, addMedia(doc, PHOTO));
  const other = addGraph(doc);
  const copy = copyPersonTo(doc, g, mum, other);
  assertEqual(doc.graphs[other].nodes[copy].attrs.photo, doc.graphs[g].nodes[mum].attrs.photo);
  assertEqual(Object.keys(doc.media).length, 1);
});

test('undo snapshots share the photo store instead of copying it', () => {
  const { doc, g, mum } = smallFamily();
  const store = new Store(doc);
  store.apply('Add photo', (d) => setPhoto(d, g, mum, addMedia(d, PHOTO)));
  store.apply('Rename', (d) => { d.meta.title = 'x'; });
  assert(store.undoStack.every((s) => s.doc.media === store.doc.media), 'one shared media object');
  store.undo();
  store.undo();
  assert(!store.doc.graphs[g].nodes[mum].attrs.photo, 'undo removes the photo from the person');
  assertEqual(Object.keys(store.doc.media).length, 1, 'the image stays (append-only)…');
  assertEqual(Object.keys(JSON.parse(documentContents('json', store.doc, '')).media), [], '…but is not saved');
  assertEqual(validate(store.doc), []);
});

test('cards show the photo; one pattern per image, reused across renders', () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  const { doc, g, mum, dad, kid } = smallFamily();
  const id = addMedia(doc, PHOTO);
  setPhoto(doc, g, mum, id);
  setPhoto(doc, g, dad, id);
  const renderer = createRenderer(svg);
  renderer.render(doc, g);
  renderer.render(doc, g);
  assertEqual(svg.querySelectorAll('defs pattern').length, 1);
  assertEqual(svg.querySelector('defs pattern image').getAttribute('href'), JPEG);
  const avatars = [...svg.querySelectorAll('.avatar:not(.placeholder)')];
  assertEqual(avatars.map((a) => a.dataset.id).sort(), [mum, dad].sort());
  assertEqual([...svg.querySelectorAll('.avatar.placeholder')].map((a) => a.dataset.id), [kid], 'no photo: a placeholder portrait');
  assertEqual(svg.querySelectorAll('.portrait-art').length, 1);
  assert(avatars.every((a) => a.getAttribute('fill') === `url(#${svg.querySelector('defs pattern').id})`));
  const nameX = (nodeId) => Number([...svg.querySelectorAll('.name')]
    .find((t) => t.textContent === { [mum]: 'Ann', [kid]: 'Cid' }[nodeId]).getAttribute('x'));
  const cardX = (nodeId) => Number(svg.querySelector(`.card[data-id="${nodeId}"]`).getAttribute('x')) + 80;
  assert(nameX(mum) > cardX(mum) + 10, 'text moves right of the photo');
  assertEqual(nameX(kid), nameX(mum) - cardX(mum) + cardX(kid), 'placeholder portrait: text placed as with a photo');

  doc.media[id] = { ...doc.media[id], data: 'javascript:alert(1)' }; // bypassing validation
  const fresh = createRenderer(svg);
  fresh.render(doc, g);
  assertEqual(svg.querySelectorAll('.avatar:not(.placeholder)').length, 0, 'unsafe data is never rendered');
  svg.remove();
});

test('GEDCOM export lists photos as not included', () => {
  const { doc, g, mum } = smallFamily();
  setPhoto(doc, g, mum, addMedia(doc, PHOTO));
  assert(exportGedcom(doc, g).warnings.some((w) => w.includes('1 photo(s)')));
});
