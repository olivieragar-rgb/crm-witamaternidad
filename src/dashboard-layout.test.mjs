import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCKS, DEFAULT_DASHBOARD, sanitizeDashboard, moveBlock, blocksOf, setVisible,
} from './lib/dashboard-layout.js';

const ids = (layout, group) => blocksOf(layout, group).map((b) => b.id);

test('lo de fábrica muestra todo, en dos columnas y con cinco elementos por lista', () => {
  const d = sanitizeDashboard(undefined);
  assert.deepEqual(d, DEFAULT_DASHBOARD);
  assert.equal(d.blocks.length, BLOCKS.length);
  assert.ok(d.blocks.every((b) => b.visible));
  assert.equal(d.columns, 2);
  assert.equal(d.compact, false);
  assert.equal(d.listSize, 5);
});

test('una preferencia rota se sustituye por lo de fábrica, no da error', () => {
  for (const mala of [null, 42, 'hola', [], { blocks: 'x' }, { blocks: [null, 3, 'a'] }]) {
    assert.deepEqual(sanitizeDashboard(mala), DEFAULT_DASHBOARD, JSON.stringify(mala));
  }
});

test('se conserva el orden y lo oculto que haya elegido', () => {
  const d = sanitizeDashboard({
    blocks: [
      { id: 'births', visible: false },
      { id: 'appointments', visible: true },
      { id: 'pending', visible: true },
    ],
  });
  assert.deepEqual(ids(d, 'panels'), ['births', 'appointments', 'pending']);
  assert.equal(d.blocks.find((b) => b.id === 'births').visible, false);
});

test('los bloques que faltan se añaden al final y a la vista', () => {
  const d = sanitizeDashboard({ blocks: [{ id: 'births', visible: false }] });
  assert.equal(d.blocks.length, BLOCKS.length);
  assert.equal(d.blocks[0].id, 'births');
  assert.ok(d.blocks.slice(1).every((b) => b.visible), 'lo nuevo sale, no se oculta solo');
});

test('se descartan los bloques que no existen y los repetidos', () => {
  const d = sanitizeDashboard({
    blocks: [{ id: 'inventado', visible: true }, { id: 'births' }, { id: 'births', visible: false }],
  });
  assert.ok(!d.blocks.some((b) => b.id === 'inventado'));
  assert.equal(d.blocks.filter((b) => b.id === 'births').length, 1);
  assert.equal(d.blocks.find((b) => b.id === 'births').visible, true, 'vale el primero');
});

test('las opciones fuera de rango vuelven a su valor de fábrica', () => {
  const d = sanitizeDashboard({ columns: 7, compact: 'sí', listSize: 99 });
  assert.equal(d.columns, 2);
  assert.equal(d.compact, false);
  assert.equal(d.listSize, 5);
  const ok = sanitizeDashboard({ columns: 1, compact: true, listSize: 10 });
  assert.deepEqual([ok.columns, ok.compact, ok.listSize], [1, true, 10]);
});

test('sanitizar dos veces da lo mismo', () => {
  const una = sanitizeDashboard({ blocks: [{ id: 'births', visible: false }], columns: 1 });
  assert.deepEqual(sanitizeDashboard(una), una);
});

test('subir y bajar un bloque lo cambia con su vecino del mismo grupo', () => {
  const d = DEFAULT_DASHBOARD;
  assert.deepEqual(ids(moveBlock(d, 'stat-pending', -1), 'stats').slice(0, 2), ['stat-pending', 'stat-clients']);
  assert.deepEqual(ids(moveBlock(d, 'stat-clients', 1), 'stats').slice(0, 2), ['stat-pending', 'stat-clients']);
});

test('un bloque no salta de las cifras a los paneles', () => {
  const d = DEFAULT_DASHBOARD;
  assert.equal(moveBlock(d, 'stat-clients', -1), d, 'ya es el primero');
  const ultimaCifra = ids(d, 'stats').at(-1);
  assert.equal(moveBlock(d, ultimaCifra, 1), d, 'es la última cifra: debajo empiezan los paneles');
  assert.equal(moveBlock(d, 'pending', -1), d, 'es el primer panel');
  assert.equal(moveBlock(d, 'appointments', 1), d);
});

test('mover no pierde ni repite bloques, y no toca la lista original', () => {
  const antes = JSON.stringify(DEFAULT_DASHBOARD);
  const d = moveBlock(moveBlock(DEFAULT_DASHBOARD, 'births', -1), 'stat-revenue', -1);
  assert.equal(JSON.stringify(DEFAULT_DASHBOARD), antes);
  assert.deepEqual([...d.blocks.map((b) => b.id)].sort(), BLOCKS.map((b) => b.id).sort());
});

test('mover un bloque que no existe no hace nada', () => {
  assert.equal(moveBlock(DEFAULT_DASHBOARD, 'nada', 1), DEFAULT_DASHBOARD);
});

test('setVisible cambia solo el bloque pedido', () => {
  const d = setVisible(DEFAULT_DASHBOARD, 'births', false);
  assert.deepEqual(d.blocks.filter((b) => !b.visible).map((b) => b.id), ['births']);
  assert.ok(DEFAULT_DASHBOARD.blocks.every((b) => b.visible), 'sin tocar el original');
});
