// Shared test documents.

import { createDocument, addPerson, addUnion, addChild } from '../src/store/model.js';

// Two parents with one child in the root graph.
export function smallFamily() {
  const doc = createDocument({ title: 'Test' });
  const g = doc.meta.rootGraph;
  const mum = addPerson(doc, g, { name: { given: 'Ann' } });
  const dad = addPerson(doc, g, { name: { given: 'Bob' } });
  const union = addUnion(doc, g, [mum, dad]);
  const kid = addPerson(doc, g, { name: { given: 'Cid' } });
  addChild(doc, g, union, kid);
  return { doc, g, mum, dad, union, kid };
}
