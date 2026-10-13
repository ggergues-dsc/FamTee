import { test, assert, assertEqual } from './harness.js';
import { personSummary, createSnapshot } from '../src/ui/snapshot.js';
import { addGroup, addLink, addGraph, addPerson, updateNodeAttrs } from '../src/store/model.js';
import { endpoint } from '../src/store/schema.js';
import { smallFamily } from './fixtures.js';

test('person summary lists dates, family, groups and other graphs', () => {
  const { doc, g, mum, dad, union, kid } = smallFamily();
  updateNodeAttrs(doc, g, mum, { sex: 'F', birth: { date: '1950', place: 'Cork' } });
  updateNodeAttrs(doc, g, union, { kind: 'married', start: '1972' });
  addGroup(doc, g, [mum, dad], { label: 'Household' });
  const other = addGraph(doc, { title: 'Lee family' });
  addLink(doc, { type: 'same-as', from: endpoint(g, mum), to: endpoint(other, addPerson(doc, other)) });

  const s = personSummary(doc, g, mum, new Date('2026-10-13'));
  assertEqual([s.name, s.dates, s.sex, s.living], ['Ann', 'b. 1950', 'F', true]);
  assertEqual(s.rows, [
    ['Born', '1950 · Cork'],
    ['Partner', 'Bob (married 1972)'],
    ['Children', 'Cid'],
    ['Groups', 'Household'],
    ['Elsewhere', 'Same person in Lee family'],
  ]);
  assertEqual(personSummary(doc, g, kid).rows, [['Parents', 'Ann, Bob']], 'only rows with something to say');
  updateNodeAttrs(doc, g, kid, { death: { date: '2020' } });
  assertEqual(personSummary(doc, g, kid).living, false);
});

test('snapshot sits beside the card and stays inside the canvas', () => {
  const { doc, g, mum } = smallFamily();
  const host = document.createElement('div');
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 900px; height: 500px;';
  const area = document.createElement('div');
  area.style.cssText = 'position: absolute; left: 0; top: 0; width: 600px; height: 500px;';
  const card = document.createElement('div');
  host.append(area, card);
  document.body.append(host);
  const snap = createSnapshot(host, area);
  const place = (left) => {
    card.style.cssText = `position: absolute; left: ${left}px; top: 100px; width: 160px; height: 56px;`;
    snap.hide();
    snap.show(doc, g, mum, card);
    return host.querySelector('.snapshot');
  };
  try {
    let el = place(40);
    assert(el.classList.contains('on-right'), 'room on the right: shown on the right');
    assert(el.getBoundingClientRect().left >= 200, 'right of the card');
    el = place(420);
    assert(el.classList.contains('on-left'), 'no room on the right of the canvas: shown on the left');
    assert(el.getBoundingClientRect().right <= 420, 'left of the card');
    assert(el.getBoundingClientRect().right <= 600, 'never over the side panel');
    assertEqual(el.getAttribute('role'), 'tooltip');
    snap.hide();
    assertEqual(host.querySelectorAll('.snapshot').length, 0);
  } finally {
    host.remove();
  }
});
