import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer } from './test-helpers.mjs';

const tmp = useTempDb(); // antes de importar app.js
const { addDays, overlaps, windowFor } = await import('./oncall.js');

const PW = 'contrasena-larga-1';

let srv;
let a;

before(async () => {
  srv = await startServer();
  a = srv.client;
  await a.post('/api/auth/setup', { email: 'admin@example.com', name: 'Admin', password: PW });
});
after(async () => {
  srv.close();
  await tmp.cleanup();
});

const nueva = (name, dueDate) => a.post('/api/clients', { name, dueDate });

// ---- cálculo ------------------------------------------------------------

test('addDays no se mueve con la zona horaria', () => {
  assert.equal(addDays('2026-03-10', 7), '2026-03-17');
  assert.equal(addDays('2026-03-10', -7), '2026-03-03');
  // Cambio de hora en Espana: el ultimo domingo de marzo.
  assert.equal(addDays('2026-03-28', 2), '2026-03-30');
  // Fin de mes y ano bisiesto.
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('no-es-fecha', 1), null);
});

test('overlaps en intervalos cerrados', () => {
  const a1 = { start: '2026-03-01', end: '2026-03-10' };
  assert.equal(overlaps(a1, { start: '2026-03-05', end: '2026-03-15' }), true);
  assert.equal(overlaps(a1, { start: '2026-03-10', end: '2026-03-20' }), true, 'tocarse por un dia cuenta');
  assert.equal(overlaps(a1, { start: '2026-03-11', end: '2026-03-20' }), false);
  assert.equal(overlaps(a1, { start: '2026-02-01', end: '2026-02-28' }), false);
  // Una contenida en la otra.
  assert.equal(overlaps(a1, { start: '2026-03-03', end: '2026-03-04' }), true);
});

test('la ventana sale de la FPP y de la configuracion', () => {
  const w = windowFor('2026-06-15', { weeksBefore: 3, weeksAfter: 2 });
  assert.deepEqual(w, { start: '2026-05-25', end: '2026-06-29' });
  assert.equal(windowFor('', { weeksBefore: 3, weeksAfter: 2 }), null);
});

// ---- API ----------------------------------------------------------------

test('las ventanas marcan con quien se solapan', async () => {
  const lucia = (await nueva('Lucía', '2026-06-15')).data; // guardia 25 may - 29 jun
  const marta = (await nueva('Marta', '2026-06-20')).data; // guardia 30 may - 04 jul -> choca
  const nerea = (await nueva('Nerea', '2026-10-01')).data; // muy lejos -> no choca

  const { config, windows } = (await a.get('/api/oncall')).data;
  assert.deepEqual(config, { weeksBefore: 3, weeksAfter: 2 });

  const w = (id) => windows.find((x) => x.id === id);
  assert.deepEqual(w(lucia.id).overlapsWith.map((o) => o.name), ['Marta']);
  assert.deepEqual(w(marta.id).overlapsWith.map((o) => o.name), ['Lucía'], 'el solape se marca en las dos');
  assert.deepEqual(w(nerea.id).overlapsWith, []);
  assert.equal(w(lucia.id).start, '2026-05-25');
  assert.equal(w(lucia.id).end, '2026-06-29');
});

test('una clienta sin FPP no genera guardia', async () => {
  await a.post('/api/clients', { name: 'Sin fecha' });
  const { windows } = (await a.get('/api/oncall')).data;
  assert.ok(!windows.some((w) => w.name === 'Sin fecha'));
});

test('conflicts avisa antes de guardar, y se excluye a si misma al editar', async () => {
  // Una FPP que choca con Lucía y Marta.
  const choca = (await a.get('/api/oncall/conflicts?dueDate=2026-06-18')).data;
  assert.deepEqual(choca.window, { start: '2026-05-28', end: '2026-07-02' });
  assert.deepEqual(choca.conflicts.map((c) => c.name).sort(), ['Lucía', 'Marta']);

  // Una FPP libre.
  const libre = (await a.get('/api/oncall/conflicts?dueDate=2027-01-15')).data;
  assert.deepEqual(libre.conflicts, []);

  // Al editar a Lucía con su propia fecha, no se cuenta a si misma.
  const { windows } = (await a.get('/api/oncall')).data;
  const lucia = windows.find((w) => w.name === 'Lucía');
  const propia = (await a.get(`/api/oncall/conflicts?dueDate=2026-06-15&excludeId=${lucia.id}`)).data;
  assert.deepEqual(propia.conflicts.map((c) => c.name), ['Marta'], 'solo la otra, no ella misma');
});

test('sin FPP, conflicts no inventa ventana', async () => {
  const res = (await a.get('/api/oncall/conflicts?dueDate=')).data;
  assert.equal(res.window, null);
  assert.deepEqual(res.conflicts, []);
});

test('cambiar la ventana en Ajustes cambia los solapamientos', async () => {
  // Con una semana antes y una despues, Lucía (15 jun) y Marta (20 jun) ya no
  // chocan: sus ventanas pasan a ser 8-22 jun y 13-27 jun... siguen chocando.
  // Con cero semanas, cada una cubre solo su dia y dejan de chocar.
  await a.put('/api/settings/oncall', { weeksBefore: 0, weeksAfter: 0 });
  const { windows } = (await a.get('/api/oncall')).data;
  assert.ok(windows.every((w) => w.overlapsWith.length === 0), 'sin ventana no hay solape');

  await a.put('/api/settings/oncall', { weeksBefore: 3, weeksAfter: 2 });
  const vuelta = (await a.get('/api/oncall')).data.windows;
  assert.ok(vuelta.find((w) => w.name === 'Lucía').overlapsWith.length === 1);
});

test('una ficha anonimizada desaparece de las guardias', async () => {
  const { windows } = (await a.get('/api/oncall')).data;
  const marta = windows.find((w) => w.name === 'Marta');
  await a.post(`/api/clients/${marta.id}/anonymize`, { reason: 'prueba' });

  const despues = (await a.get('/api/oncall')).data.windows;
  assert.ok(!despues.some((w) => w.id === marta.id));
  assert.deepEqual(
    despues.find((w) => w.name === 'Lucía').overlapsWith,
    [],
    'y deja de contarse como solapamiento',
  );
});

test('la guardia exige sesion', async () => {
  const { makeClient } = await import('./test-helpers.mjs');
  const anon = makeClient(srv.base);
  assert.equal((await anon.get('/api/oncall')).status, 401);
  assert.equal((await anon.get('/api/oncall/conflicts?dueDate=2026-06-15')).status, 401);
});
