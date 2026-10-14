import { test, assert, assertEqual, assertThrows } from './harness.js';
import { addPetTo, removePet, removePerson, petsOfUnion, ownersOfPet, unionsOfPerson } from '../src/store/family.js';
import { addPerson, updateNodeAttrs } from '../src/store/model.js';
import { validate } from '../src/store/validate.js';
import { layoutGraph, PET_SIZE } from '../src/layout/layout.js';
import { createRenderer } from '../src/render/renderer.js';
import { countryOf, flagMarkup, FLAG_COUNTRIES } from '../src/render/flags.js';
import { jobIconName, petIconName } from '../src/ui/icons.js';
import { exportGedcom } from '../src/io/gedcom/export.js';
import { importGedcom } from '../src/io/gedcom/import.js';
import { privatize } from '../src/privacy/living.js';
import { personSummary } from '../src/ui/snapshot.js';
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
