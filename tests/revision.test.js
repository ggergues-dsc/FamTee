import { test, assert, assertEqual } from './harness.js';
import { sha256 } from '../src/persist/sha256.js';
import { contentHash, stampRevision, checkRevision, downloadName, shortHash } from '../src/persist/revision.js';
import { updateNodeAttrs } from '../src/store/model.js';
import { smallFamily } from './fixtures.js';

test('sha256 matches the standard test vectors', () => {
  assertEqual(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assertEqual(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assertEqual(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  assertEqual(sha256('a'.repeat(1000000)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  assertEqual(sha256('é😀'), sha256('é😀'), 'UTF-8 multi-byte input');
  assertEqual(sha256('é').length, 64);
});

test('stamping records hash, time and parent without changing the input', () => {
  const { doc } = smallFamily();
  const t1 = new Date(Date.UTC(2026, 9, 13, 15, 30, 12));
  const v1 = stampRevision(doc, { now: t1 });
  assert(!doc.meta.revision, 'input untouched');
  assertEqual(v1.meta.revision.savedAt, '2026-10-13T15:30:12.000Z');
  assertEqual(v1.meta.revision.parent, null);
  assertEqual(v1.meta.revision.hash, contentHash(doc), 'hash covers content, not the revision');
  assertEqual(checkRevision(v1), 'ok');
  assertEqual(checkRevision(doc), 'none');

  const edited = structuredClone(v1);
  updateNodeAttrs(edited, edited.meta.rootGraph, Object.keys(edited.graphs[edited.meta.rootGraph].nodes)[0], { notes: 'x' });
  assertEqual(checkRevision(edited), 'modified', 'edited outside FamTee');
  const v2 = stampRevision(edited, { now: new Date(Date.UTC(2026, 9, 13, 16, 0, 0)) });
  assertEqual(v2.meta.revision.parent, v1.meta.revision.hash, 'chain to the previous version');
  assert(v2.meta.revision.hash !== v1.meta.revision.hash);
  assertEqual(stampRevision(v1, { now: t1 }).meta.revision.hash, v1.meta.revision.hash, 'same content, same hash');
  assertEqual(stampRevision(edited, { parent: 'abc' }).meta.revision.parent, 'abc', 'explicit parent');
});

test('download names carry title, local date-time and short hash', () => {
  const { doc } = smallFamily();
  doc.meta.title = 'Hanna / Saleh Família';
  const now = new Date(2026, 9, 13, 15, 30, 12); // local time
  const stamped = stampRevision(doc, { now });
  const name = downloadName(stamped, '.html', now);
  assertEqual(name, `hanna-saleh-familia-2026-10-13-153012-${shortHash(stamped.meta.revision.hash)}.html`);
  assertEqual(downloadName({ meta: { title: '' } }, '.ged', now), 'family-2026-10-13-153012.ged');
});
