import { test, assert, assertEqual, assertThrows } from './harness.js';
import { ulid, newId } from '../src/store/ids.js';

test('ulid is 26 Crockford base32 chars', () => {
  assert(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(ulid()), ulid());
});

test('ulid sorts by time', () => {
  assert(ulid(1000) < ulid(2000));
  assertEqual(ulid(0).slice(0, 10), '0000000000');
});

test('ulids are unique', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => ulid()));
  assertEqual(ids.size, 1000);
});

test('newId uses the kind prefix', () => {
  assert(newId('person').startsWith('p-'));
  assert(newId('union').startsWith('u-'));
  assert(newId('graph').startsWith('g-'));
  assertThrows(() => newId('banana'), /Unknown id kind/);
});
