import test from 'node:test';
import assert from 'node:assert/strict';
import { sortRows, nextSort } from './lib/sort.js';

const filas = [
  { id: 1, name: 'Marta', due: '2026-12-07', n: '10' },
  { id: 2, name: 'Ángela', due: '', n: '2' },
  { id: 3, name: 'Lucía', due: '2026-11-09', n: '1' },
  { id: 4, name: 'nerea', due: '', n: '' },
];
const por = {
  name: (r) => r.name,
  due: (r) => r.due,
  n: (r) => r.n,
};
const ids = (rs) => rs.map((r) => r.id);

test('sin columna activa no toca el orden', () => {
  assert.deepEqual(ids(sortRows(filas, { key: null, dir: 'asc' }, por)), [1, 2, 3, 4]);
});

test('ordena sin fijarse en acentos ni mayusculas', () => {
  // Ángela, Lucía, Marta, nerea
  assert.deepEqual(ids(sortRows(filas, { key: 'name', dir: 'asc' }, por)), [2, 3, 1, 4]);
  assert.deepEqual(ids(sortRows(filas, { key: 'name', dir: 'desc' }, por)), [4, 1, 3, 2]);
});

test('los numeros se ordenan como numeros', () => {
  assert.deepEqual(ids(sortRows(filas, { key: 'n', dir: 'asc' }, por)), [3, 2, 1, 4]);
});

test('los vacios van al final, suba o baje el orden', () => {
  assert.deepEqual(ids(sortRows(filas, { key: 'due', dir: 'asc' }, por)), [3, 1, 2, 4]);
  assert.deepEqual(ids(sortRows(filas, { key: 'due', dir: 'desc' }, por)), [1, 3, 2, 4]);
});

test('es estable: las que empatan conservan su orden', () => {
  const sinFecha = sortRows(filas, { key: 'due', dir: 'asc' }, por).filter((r) => !r.due);
  assert.deepEqual(ids(sinFecha), [2, 4]);
});

test('no modifica la lista original', () => {
  const copia = ids(filas);
  sortRows(filas, { key: 'name', dir: 'desc' }, por);
  assert.deepEqual(ids(filas), copia);
});

test('una columna que no existe no rompe nada', () => {
  assert.equal(sortRows(filas, { key: 'inventada', dir: 'asc' }, por), filas);
});

test('pulsar la cabecera: asc, desc y vuelta al principio', () => {
  let s = { key: null, dir: 'asc' };
  s = nextSort(s, 'name');
  assert.deepEqual(s, { key: 'name', dir: 'asc' });
  s = nextSort(s, 'name');
  assert.deepEqual(s, { key: 'name', dir: 'desc' });
  s = nextSort(s, 'name');
  assert.deepEqual(s, { key: null, dir: 'asc' });
  // Cambiar de columna empieza siempre en ascendente.
  s = nextSort({ key: 'name', dir: 'desc' }, 'due');
  assert.deepEqual(s, { key: 'due', dir: 'asc' });
});
