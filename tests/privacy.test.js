import { test, assert, assertEqual } from './harness.js';
import { isLiving, yearOf, privatize, LIVING_LABEL } from '../src/privacy/living.js';
import { addPerson, addUnion, addChild, updateNodeAttrs } from '../src/store/model.js';
import { addMedia, setPhoto } from '../src/store/media.js';
import { validate } from '../src/store/validate.js';
import { exportGedcom } from '../src/io/gedcom/export.js';
import { serialize } from '../src/store/serialize.js';
import { smallFamily } from './fixtures.js';

const NOW = new Date(2026, 9, 13);

test('years are found in stored dates of any kind', () => {
  assertEqual(yearOf('1950-03-14'), 1950);
  assertEqual(yearOf('ABT 1900'), 1900);
  assertEqual(yearOf('BET 1950 AND 1960'), 1950);
  assertEqual(yearOf('sometime in spring'), null);
  assertEqual(yearOf(undefined), null);
});

test('living rule: a recorded death or a birth 100+ years ago means deceased; when unsure, living', () => {
  assert(isLiving({}, NOW), 'nothing known: protect');
  assert(isLiving({ birth: { date: '1980' } }, NOW));
  assert(isLiving({ birth: { date: '1926-10-13' } }, NOW), 'exactly 100 years: still living');
  assert(!isLiving({ birth: { date: '1925' } }, NOW), 'born 101 years ago');
  assert(!isLiving({ birth: { date: 'ABT 1900' } }, NOW));
  assert(!isLiving({ birth: { date: '1990' }, death: { date: '2020' } }, NOW), 'recorded death');
  assert(!isLiving({ death: { place: 'Cairo' } }, NOW), 'a death place alone counts');
  assert(!isLiving({ birth: { date: '1990' }, status: 'deceased' }, NOW), 'explicit status wins');
  assert(isLiving({ birth: { date: '1900' }, status: 'living' }, NOW), 'explicit status wins');
});

test('privatize hides living people completely and keeps the tree shape', () => {
  const { doc, g, mum, dad, union, kid } = smallFamily();
  updateNodeAttrs(doc, g, mum, { name: { given: 'Ann', surname: 'Lee' }, sex: 'F', birth: { date: '1950', place: 'Cairo' },
    notes: 'secret note', nudge: { dx: 5, dy: 0 } });
  updateNodeAttrs(doc, g, dad, { name: { given: 'Bob', surname: 'Lee' }, birth: { date: '1920' }, death: { date: '1999' } });
  updateNodeAttrs(doc, g, kid, { name: { given: 'Cid', surname: 'Lee' }, birth: { date: '1980-02-02', place: 'Leeds' } });
  updateNodeAttrs(doc, g, union, { kind: 'married', start: '1975', place: 'Alexandria' });
  setPhoto(doc, g, kid, addMedia(doc, { mime: 'image/jpeg', data: 'data:image/jpeg;base64,/9j/4AAQ', width: 9, height: 9 }));
  const before = JSON.stringify(doc);

  const { doc: shared, hidden } = privatize(doc, { now: NOW });
  assertEqual(JSON.stringify(doc), before, 'the family itself is untouched');
  assertEqual(hidden, 2);
  const nodes = shared.graphs[g].nodes;
  assertEqual(nodes[mum].attrs, { name: { given: LIVING_LABEL }, sex: 'F', nudge: { dx: 5, dy: 0 } });
  assertEqual(nodes[kid].attrs, { name: { given: LIVING_LABEL } });
  assertEqual(nodes[dad].attrs.name.given, 'Bob', 'deceased people are kept as they are');
  assertEqual(nodes[union].attrs, { kind: 'married', start: '1975', place: 'Alexandria' }, 'one partner deceased: details kept');
  assertEqual(shared.graphs[g].edges.length, doc.graphs[g].edges.length, 'relationships kept');
  assertEqual(shared.media, {}, 'living people’s photos are not in the copy');
  assert(shared.meta.id !== doc.meta.id, 'a separate document');
  assertEqual(shared.meta.title, `${doc.meta.title} (shared)`);
  assertEqual(shared.meta.privacy.livingHidden, 2);
  assertEqual(validate(shared), []);

  const text = serialize(shared);
  for (const secret of ['Ann', 'Cid', 'Cairo', 'Leeds', '1950', '1980', 'secret note', '/9j/4AAQ']) {
    assert(!text.includes(secret), `"${secret}" must not appear in the shared copy`);
  }
});

test('a partnership of two living people loses its dates and place', () => {
  const { doc, g } = smallFamily();
  const a = addPerson(doc, g, { name: { given: 'Young' }, birth: { date: '1995' } });
  const b = addPerson(doc, g, { name: { given: 'Couple' } });
  const u = addUnion(doc, g, [a, b], { kind: 'married', start: '2020-06-01', place: 'Paris' });
  addChild(doc, g, u, addPerson(doc, g));
  const { doc: shared } = privatize(doc, { now: NOW });
  assertEqual(shared.graphs[g].nodes[u].attrs, { kind: 'married' });
});

test('a shared GEDCOM has no living names', () => {
  const { doc, g, mum } = smallFamily();
  updateNodeAttrs(doc, g, mum, { name: { given: 'Ann', surname: 'Lee' }, birth: { date: '1950' } });
  const { doc: shared } = privatize(doc, { now: NOW });
  const ged = exportGedcom(shared, g).text;
  assert(!ged.includes('Ann') && !ged.includes('Lee'));
  assert(ged.includes(`1 NAME ${LIVING_LABEL}`));
});
