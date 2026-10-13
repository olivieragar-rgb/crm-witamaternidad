import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalize, searchItems } from './search.js';

const contacts = [
  { name: 'José Álvarez', email: 'jose@acme.es' },
  { name: 'María Núñez', email: 'maria@beta.com' },
  { name: 'Olivier Agar', email: 'olivier@gamma.io' },
];
const text = (c) => `${c.name} ${c.email}`;

test('normalize strips accents, case and outer whitespace', () => {
  assert.equal(normalize('  ÁLVAREZ '), 'alvarez');
});

test('empty query returns the list unchanged', () => {
  assert.equal(searchItems(contacts, '   ', text), contacts);
});

test('matches ignoring accents and case', () => {
  assert.deepEqual(searchItems(contacts, 'jose', text).map((c) => c.name), ['José Álvarez']);
  assert.deepEqual(searchItems(contacts, 'NUNEZ', text).map((c) => c.name), ['María Núñez']);
});

test('matches on email and returns nothing when absent', () => {
  assert.equal(searchItems(contacts, 'gamma.io', text).length, 1);
  assert.equal(searchItems(contacts, 'zzz', text).length, 0);
});
