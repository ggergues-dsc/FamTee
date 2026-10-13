import { test, assert, assertEqual } from './harness.js';
import { relationOptions, applyConnection, describeConnection } from '../src/ui/connect.js';
import { addPerson, updateNodeAttrs } from '../src/store/model.js';
import { partnersOfUnion, parentUnionsOf } from '../src/store/family.js';
import { validate } from '../src/store/validate.js';
import { smallFamily } from './fixtures.js';

const why = (options) => Object.fromEntries(options.map(([value, , reason]) => [value, reason]));

test('connect popover offers only relations that can apply, and says why not', () => {
  const { doc, g, mum, dad, kid } = smallFamily();
  const graph = doc.graphs[g];
  const rosa = addPerson(doc, g, { name: { given: 'Rosa', surname: 'Garcia' } });
  assertEqual(why(relationOptions(graph, rosa, kid)), { partner: '', child: '', parent: 'Cid already has two parents', sibling: '', other: '' });
  assertEqual(why(relationOptions(graph, rosa, mum)).sibling, 'add Ann’s parents first');
  assertEqual(why(relationOptions(graph, dad, mum)).partner, 'already partners');
  assertEqual(why(relationOptions(graph, kid, mum)).child, 'already their child');
  assertEqual(why(relationOptions(graph, mum, kid)).parent, 'already their parent');
  assertEqual(why(relationOptions(graph, kid, rosa)).sibling, 'add Rosa’s parents first');
});

test('connect popover describes, then applies, the chosen relation', () => {
  const { doc, g, mum, union, kid } = smallFamily();
  const graph = doc.graphs[g];
  const rosa = addPerson(doc, g, { name: { given: 'Rosa', surname: 'Garcia' } });
  updateNodeAttrs(doc, g, kid, { name: { given: 'David', surname: 'Smith' } });
  assertEqual(describeConnection(graph, rosa, kid, { how: 'partner', kind: 'married', start: '2001' }),
    'Rosa Garcia becomes David Smith’s partner (married 2001).');
  assertEqual(describeConnection(graph, rosa, mum, { how: 'child', unionId: union }), 'Rosa Garcia becomes the child of Ann and Bob.');
  assertEqual(describeConnection(graph, rosa, kid, { how: 'other', label: 'godparent' }),
    'Rosa Garcia is linked to David Smith as “godparent”, outside the family lines.');

  assertEqual(applyConnection(doc, g, rosa, kid, { how: 'sibling' }), union);
  assertEqual(parentUnionsOf(graph, rosa), [union]);
  const baby = addPerson(doc, g);
  const u = applyConnection(doc, g, baby, rosa, { how: 'child', unionId: null });
  assertEqual(partnersOfUnion(graph, u), [rosa]);
  assert(validate(doc).length === 0);
});
