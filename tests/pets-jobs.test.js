import { test, assert, assertEqual, assertThrows } from './harness.js';
import { addPetTo, removePet, removePerson, petsOfUnion, ownersOfPet, unionsOfPerson } from '../src/store/family.js';
import { addPerson, updateNodeAttrs } from '../src/store/model.js';
import { validate } from '../src/store/validate.js';
import { layoutGraph, PET_SIZE } from '../src/layout/layout.js';
import { createRenderer } from '../src/render/renderer.js';
import { countryOf, flagMarkup, FLAG_COUNTRIES } from '../src/render/flags.js';
import { jobIconName, petIconName, iconMarkup } from '../src/ui/icons.js';
import { exportGedcom } from '../src/io/gedcom/export.js';
import { importGedcom } from '../src/io/gedcom/import.js';
import { privatize } from '../src/privacy/living.js';
import { personSummary, petSummary, createSnapshot } from '../src/ui/snapshot.js';
import { loadViewPrefs, saveViewPrefs } from '../src/ui/prefs.js';
import { smallFamily } from './fixtures.js';

test('pets belong to a partnership, or to one person through a single-owner union', () => {
  const { doc, g, mum, dad, union } = smallFamily();
  const graph = doc.graphs[g];
  const biscuit = addPetTo(doc, g, mum, union, { name: 'Biscuit', species: 'dog' });
  assertEqual(biscuit.unionId, union);
  assertEqual(petsOfUnion(graph, union), [biscuit.petId]);
  assertEqual(ownersOfPet(graph, biscuit.petId).sort(), [mum, dad].sort());

  const a = addPetTo(doc, g, dad, null, { name: 'Miso', species: 'cat' });
  const b = addPetTo(doc, g, dad, null, { name: 'Pip', species: 'other' });
  assertEqual(a.unionId, b.unionId, 'one single-owner union for a person’s own pets');
  assertEqual(ownersOfPet(graph, a.petId), [dad]);
  assertThrows(() => addPetTo(doc, g, biscuit.petId, null), /Only people/);
  assertEqual(validate(doc), []);

  removePet(doc, g, a.petId);
  assert(graph.nodes[b.unionId], 'union kept while it still has a pet');
  removePet(doc, g, b.petId);
  assert(!graph.nodes[b.unionId], 'empty single-owner union removed with the last pet');
  assertEqual(validate(doc), []);
});

test('removing a pet owner keeps the pet; pet edges are validated', () => {
  const { doc, g, kid } = smallFamily();
  const { petId, unionId } = addPetTo(doc, g, kid, null, { name: 'Rex' });
  removePerson(doc, g, kid);
  assert(doc.graphs[g].nodes[petId], 'the pet stays');
  assert(doc.graphs[g].nodes[unionId], 'its union stays while it has a pet');
  assertEqual(validate(doc), []);
  doc.graphs[g].edges.push({ id: 'e-bad', type: 'pet', from: unionId, to: Object.keys(doc.graphs[g].nodes).find((id) => doc.graphs[g].nodes[id].type === 'person') });
  assertEqual(validate(doc).map((e) => e.code), ['edge-endpoints']);
});

test('pets are laid out below their owners and drawn as smaller cards with a dotted line', () => {
  const { doc, g, mum, union, kid } = smallFamily();
  const { petId } = addPetTo(doc, g, mum, union, { name: 'Biscuit', species: 'dog', birth: { date: '2019' } });
  const layout = layoutGraph(doc.graphs[g]);
  assertEqual(layout.nodes[petId].y, layout.nodes[kid].y, 'same row as the children');
  assertEqual([layout.nodes[petId].width, layout.nodes[petId].height], [PET_SIZE.width, PET_SIZE.height]);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  try {
    createRenderer(svg).render(doc, g);
    const card = svg.querySelector(`rect.card.pet[data-id="${petId}"]`);
    assert(card && card.classList.contains('species-dog'));
    assert(svg.querySelector('.edge-pet'), 'a pet line');
    assert([...svg.querySelectorAll('.name')].some((t) => t.textContent === 'Biscuit'));
    assert([...svg.querySelectorAll('.dates')].some((t) => t.textContent === 'Dog · 2019'));
    assert(svg.querySelector('.pet-icon'));
  } finally {
    svg.remove();
  }
});

test('job and birth-country badges on person cards', () => {
  const { doc, g, mum, kid } = smallFamily();
  updateNodeAttrs(doc, g, mum, { occupation: 'Nurse', birth: { place: 'Cork, Ireland' } });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  try {
    createRenderer(svg).render(doc, g);
    assertEqual(svg.querySelectorAll('.job-badge').length, 1);
    assertEqual(svg.querySelectorAll('.flag').length, 1);
    const title = svg.querySelector(`rect.card[data-id="${mum}"] title`).textContent;
    assert(title.includes('Nurse') && title.includes('Born in Ireland'), title);
    const nameX = (id) => Number([...svg.querySelectorAll('.name')].find((t) => t.textContent === doc.graphs[g].nodes[id].attrs.name.given).getAttribute('x'));
    const cardX = (id) => Number(svg.querySelector(`rect.card[data-id="${id}"]`).getAttribute('x'));
    assert(nameX(mum) - cardX(mum) < nameX(kid) - cardX(kid), 'the text moves left to make room for the badges');
    const job = svg.querySelector('.job-badge circle');
    assertEqual(Number(job.getAttribute('r')), 14, 'a 28 px job badge');
    assert(svg.querySelector('.flag').getAttribute('transform').includes(`scale(${26 / 15})`), 'a 26 px wide flag');
  } finally {
    svg.remove();
  }
});

test('flags: country from the end of the birthplace, with common other names', () => {
  assertEqual(countryOf('Cork, Ireland'), 'Ireland');
  assertEqual(countryOf('Boston, Massachusetts, USA'), 'United States');
  assertEqual(countryOf('Leeds, england'), 'England');
  assertEqual(countryOf('Amsterdam, Holland'), 'Netherlands');
  assertEqual(countryOf('Beirut, Lebanon.'), 'Lebanon');
  assertEqual(countryOf('Atlantis'), null);
  assertEqual(countryOf(''), null);
  assert(FLAG_COUNTRIES.length >= 50);
  for (const c of FLAG_COUNTRIES) assert(flagMarkup(c).includes('flag-edge'), c);
});

test('job icons match words in the title', () => {
  assertEqual(['Car mechanic', 'Dairy farmer', 'GP', 'Staff nurse', 'Maths teacher', 'Civil engineer', 'Electrician', 'Joiner', 'School pupil', 'Accountant']
    .map(jobIconName), ['jobMechanic', 'jobFarmer', 'jobMedical', 'jobMedical', 'jobTeacher', 'jobEngineer', 'jobElectrician', 'jobCarpenter', 'jobStudent', 'jobOther']);
  assertEqual(['dog', 'cat', 'other', undefined].map(petIconName), ['dog', 'cat', 'paw', 'paw']);
});

test('snapshot shows job, employer and pets', () => {
  const { doc, g, mum, union } = smallFamily();
  updateNodeAttrs(doc, g, mum, { occupation: 'Nurse', employer: 'Leeds General Infirmary', birth: { place: 'Cork, Ireland' } });
  addPetTo(doc, g, mum, union, { name: 'Biscuit', species: 'dog' });
  const s = personSummary(doc, g, mum);
  assertEqual(s.country, 'Ireland');
  const rows = Object.fromEntries(s.rows);
  assertEqual([rows.Job, rows.Employer, rows.Pets], ['Nurse', 'Leeds General Infirmary', 'Biscuit (dog)']);
});

test('GEDCOM: job and employer round-trip as OCCU/AGNC; pets are reported as not included', () => {
  const { doc, g, mum, union } = smallFamily();
  updateNodeAttrs(doc, g, mum, { occupation: 'Nurse', employer: 'Leeds General Infirmary' });
  addPetTo(doc, g, mum, union, { name: 'Biscuit', species: 'dog' });
  const { text, warnings } = exportGedcom(doc, g);
  assert(text.includes('1 OCCU Nurse') && text.includes('2 AGNC Leeds General Infirmary'), text);
  assert(warnings.some((w) => w.includes('1 pet(s)')), warnings.join('; '));
  assert(!text.includes('Biscuit'), 'pets are not written');
  const back = importGedcom(text, { title: 'Back' }).graph;
  const ann = Object.values(back.nodes).find((n) => n.attrs.name?.given === 'Ann');
  assertEqual([ann.attrs.occupation, ann.attrs.employer], ['Nurse', 'Leeds General Infirmary']);
});

test('privacy: a living person’s job and employer are hidden in a shared copy', () => {
  const { doc, g, mum } = smallFamily();
  updateNodeAttrs(doc, g, mum, { occupation: 'Nurse', employer: 'Leeds General Infirmary' });
  const shared = privatize(doc).doc;
  assertEqual(shared.graphs[g].nodes[mum].attrs.occupation, undefined);
  assertEqual(shared.graphs[g].nodes[mum].attrs.employer, undefined);
  assert(unionsOfPerson(shared.graphs[g], mum).length === 1);
});

test('the Country and Job switches hide those badges, and the text takes the room', () => {
  const { doc, g, mum } = smallFamily();
  updateNodeAttrs(doc, g, mum, { occupation: 'Nurse', birth: { place: 'Cork, Ireland' } });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  try {
    const renderer = createRenderer(svg);
    const nameX = () => Number([...svg.querySelectorAll('.name')].find((t) => t.textContent === 'Ann').getAttribute('x'));
    const count = () => [svg.querySelectorAll('.job-badge').length, svg.querySelectorAll('.flag').length];
    renderer.render(doc, g);
    const withBoth = nameX();
    assertEqual(count(), [1, 1]);
    renderer.render(doc, g, { badges: { flags: false } });
    assertEqual(count(), [1, 0], 'flags hidden');
    renderer.render(doc, g, { badges: { jobs: false } });
    assertEqual(count(), [0, 1], 'jobs hidden');
    renderer.render(doc, g, { badges: { flags: false, jobs: false } });
    assertEqual(count(), [0, 0]);
    assert(nameX() > withBoth, 'with no badges the name centres in the whole card');
  } finally {
    svg.remove();
  }
});

test('view preferences: badges shown by default; choices are remembered', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assertEqual(loadViewPrefs(storage), { panelCollapsed: false, panelMode: 'edit', showFlags: true, showJobs: true });
  saveViewPrefs(storage, { panelCollapsed: true, panelMode: 'view', showFlags: false, showJobs: true });
  assertEqual(loadViewPrefs(storage), { panelCollapsed: true, panelMode: 'view', showFlags: false, showJobs: true });
  store.set('famtee:panel', '{"collapsed":true,"mode":"view"}'); // saved before the switches existed
  assertEqual(loadViewPrefs(storage).showFlags, true);
  store.set('famtee:panel', 'not json');
  assertEqual(loadViewPrefs(storage).panelMode, 'edit', 'unreadable: defaults');
  assertEqual(loadViewPrefs(null).showJobs, true, 'no storage: defaults');
  saveViewPrefs({ setItem() { throw new Error('quota'); } }, {}); // never throws
});

test('pet snapshot: name, type, sex, breed and dates, with owners but no lineage', () => {
  const { doc, g, mum, union } = smallFamily();
  const { petId } = addPetTo(doc, g, mum, union, { name: 'Biscuit', species: 'dog', sex: 'M', breed: 'Labrador', birth: { date: '2015' }, death: { date: '2024' } });
  const s = petSummary(doc, g, petId);
  assertEqual([s.name, s.dates, s.species, s.alive], ['Biscuit', '2015 – 2024', 'dog', false]);
  assertEqual(s.rows, [['Type', 'Dog'], ['Sex', 'Male'], ['Breed', 'Labrador'], ['Born', '2015'], ['Died', '2024'], ['Owners', 'Ann, Bob']]);
  assert(!s.rows.some(([label]) => ['Parents', 'Partner', 'Children'].includes(label)), 'no lineage');
  const { petId: rio } = addPetTo(doc, g, mum, null, { name: 'Rio' });
  assertEqual(petSummary(doc, g, rio).rows, [['Type', 'Other animal'], ['Sex', 'Unknown'], ['Owners', 'Ann']]);

  const host = document.createElement('div');
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 900px; height: 500px;';
  const card = document.createElement('div');
  card.style.cssText = 'position: absolute; left: 40px; top: 100px; width: 124px; height: 44px;';
  host.append(card);
  document.body.append(host);
  try {
    createSnapshot(host).show(doc, g, petId, card);
    const el = host.querySelector('.snapshot-pet');
    assert(el, 'a pet card');
    assertEqual([...el.querySelectorAll('dt')].map((dt) => dt.textContent), ['Type', 'Sex', 'Breed', 'Born', 'Died', 'Owners']);
    assertEqual(el.querySelector('.chip').textContent, 'Died');
    assert(el.querySelector('.snapshot-pet-portrait .icon-svg'), 'the animal icon');
  } finally {
    host.remove();
  }
});

test('dog and cat icons are different drawings', () => {
  assert(iconMarkup('dog') && iconMarkup('cat') && iconMarkup('dog') !== iconMarkup('cat'));
});
