import test from 'node:test';
import assert from 'node:assert/strict';
import { options } from './options.js';

const lista = (...vals) => vals.map((v, i) => ({ id: i + 1, value: v, active: true }));

test('devuelve solo las activas, en orden', () => {
  const l = [...lista('A', 'B', 'C')];
  l[1].active = false;
  assert.deepEqual(options(l), ['A', 'C']);
});

test('una opcion repetida sale una sola vez', () => {
  assert.deepEqual(options(lista('Online', 'Presencial', 'Online')), ['Online', 'Presencial']);
});

test('repetida aunque cambien mayusculas o espacios', () => {
  assert.deepEqual(options(lista('Online', ' online ', 'ONLINE', 'Lactancia')), ['Online', 'Lactancia']);
});

test('el valor que ya tenia la ficha se conserva aunque ya no este en la lista', () => {
  assert.deepEqual(options(lista('A', 'B'), 'Vieja'), ['Vieja', 'A', 'B']);
});

test('el valor de la ficha no se duplica si ya esta (ni con otras mayusculas)', () => {
  assert.deepEqual(options(lista('Online', 'Presencial'), 'Online'), ['Online', 'Presencial']);
  assert.deepEqual(options(lista('Online', 'Presencial'), 'online'), ['Online', 'Presencial']);
});

test('sin lista no revienta', () => {
  assert.deepEqual(options(undefined, ''), []);
  assert.deepEqual(options(null, 'X'), ['X']);
});
