import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, makeClient } from './test-helpers.mjs';

const tmp = useTempDb(); // antes de importar app.js

const PW = 'contrasena-larga-1';
let srv;
let a; // administradora
let pro; // otra usuaria
let proId;

before(async () => {
  srv = await startServer();
  a = srv.client;
  await a.post('/api/auth/setup', { email: 'admin@example.com', name: 'Admin', password: PW });
  const created = await a.post('/api/users', { email: 'pro@example.com', name: 'Pro', role: 'pro', password: PW });
  proId = created.data.id;
  pro = makeClient(srv.base);
  await pro.post('/api/auth/login', { email: 'pro@example.com', password: PW });
});
after(async () => {
  srv.close();
  await tmp.cleanup();
});

const ids = (layout) => layout.blocks.map((b) => b.id);

test('sin haber elegido nada, Inicio sale como de fábrica', async () => {
  const res = await a.get('/api/prefs/dashboard');
  assert.equal(res.status, 200);
  assert.equal(res.data.columns, 2);
  assert.equal(res.data.listSize, 5);
  assert.equal(res.data.compact, false);
  assert.ok(res.data.blocks.length >= 7 && res.data.blocks.every((b) => b.visible));
});

test('lo que se guarda es lo que se lee después', async () => {
  const base = (await a.get('/api/prefs/dashboard')).data;
  const orden = [...ids(base)].reverse().map((id) => ({ id, visible: id !== 'births' }));
  const put = await a.put('/api/prefs/dashboard', { blocks: orden, columns: 1, compact: true, listSize: 10 });
  assert.equal(put.status, 200);

  const leido = (await a.get('/api/prefs/dashboard')).data;
  assert.deepEqual(ids(leido), ids(put.data));
  assert.deepEqual(ids(leido), [...ids(base)].reverse(), 'el orden elegido');
  assert.equal(leido.blocks.find((b) => b.id === 'births').visible, false);
  assert.deepEqual([leido.columns, leido.compact, leido.listSize], [1, true, 10]);
});

test('cada usuaria tiene lo suyo', async () => {
  // La administradora lo tiene cambiado (test anterior); la otra, no.
  const suya = (await pro.get('/api/prefs/dashboard')).data;
  assert.equal(suya.columns, 2);
  assert.ok(suya.blocks.every((b) => b.visible));

  await pro.put('/api/prefs/dashboard', { columns: 1, listSize: 3 });
  assert.equal((await pro.get('/api/prefs/dashboard')).data.listSize, 3);
  assert.equal((await a.get('/api/prefs/dashboard')).data.listSize, 10, 'la otra no se toca');
});

test('lo que se guarda se sanea: sin bloques inventados, y con los que falten', async () => {
  const res = await a.put('/api/prefs/dashboard', {
    blocks: [{ id: 'inventado', visible: true }, { id: 'births', visible: false }, { id: 'births' }],
    columns: 9,
    listSize: 1000,
    compact: 'sí',
  });
  assert.equal(res.status, 200);
  assert.ok(!ids(res.data).includes('inventado'));
  assert.equal(ids(res.data).filter((i) => i === 'births').length, 1);
  assert.ok(ids(res.data).includes('stat-clients'), 'los que faltaban se añaden');
  assert.deepEqual([res.data.columns, res.data.compact, res.data.listSize], [2, false, 5]);
});

test('un cuerpo que no es una preferencia no rompe nada', async () => {
  // Vacío o con cosas que no son suyas: se queda con lo de fábrica.
  for (const body of [{}, [], { blocks: 'x', columns: 'a' }]) {
    const res = await a.put('/api/prefs/dashboard', body);
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(res.data.columns, 2);
  }
  // Y lo que ni siquiera es un objeto lo para el lector de JSON de la API.
  for (const body of ['hola', 7]) {
    assert.equal((await a.put('/api/prefs/dashboard', body)).status, 400, JSON.stringify(body));
  }
});

test('volver a lo de fábrica', async () => {
  await a.put('/api/prefs/dashboard', { columns: 1, compact: true });
  const res = await a.del('/api/prefs/dashboard');
  assert.equal(res.status, 200);
  assert.deepEqual([res.data.columns, res.data.compact], [2, false]);
  assert.equal((await a.get('/api/prefs/dashboard')).data.columns, 2);
});

test('una preferencia guardada ilegible no deja sin pantalla', async () => {
  const { run } = await import('./db.js');
  const me = (await a.get('/api/auth/me')).data;
  await run("INSERT OR REPLACE INTO user_prefs (userId, key, value) VALUES (?, 'dashboard', '{esto no es json')", [me.id]);
  const res = await a.get('/api/prefs/dashboard');
  assert.equal(res.status, 200);
  assert.equal(res.data.columns, 2);
});

test('una preferencia que no existe responde 404, y todo exige sesión', async () => {
  assert.equal((await a.get('/api/prefs/inventada')).status, 404);
  assert.equal((await a.put('/api/prefs/inventada', {})).status, 404);
  const anon = makeClient(srv.base);
  assert.equal((await anon.get('/api/prefs/dashboard')).status, 401);
  assert.equal((await anon.put('/api/prefs/dashboard', {})).status, 401);
});

test('borrar una usuaria se lleva sus preferencias', async () => {
  await pro.put('/api/prefs/dashboard', { columns: 1 });
  const { get } = await import('./db.js');
  assert.ok(await get("SELECT 1 AS x FROM user_prefs WHERE userId = ? AND key = 'dashboard'", [proId]));
  assert.equal((await a.del(`/api/users/${proId}`)).status, 204);
  assert.ok(!(await get('SELECT 1 AS x FROM user_prefs WHERE userId = ?', [proId])), 'ya no queda nada suyo');
});

test('las listas de Inicio enseñan tantos elementos como se pide: 3, 5 o 10', async () => {
  for (let i = 1; i <= 12; i++) {
    await a.post('/api/clients', { name: `Clienta ${i}`, dueDate: `2999-01-${String(i).padStart(2, '0')}` });
  }
  const largo = async (q) => (await a.get(`/api/dashboard${q}`)).data.upcomingBirths.length;
  assert.equal(await largo(''), 5, 'sin pedir nada, cinco');
  assert.equal(await largo('?limit=3'), 3);
  assert.equal(await largo('?limit=10'), 10);
  assert.equal(await largo('?limit=7'), 5, 'un tamaño que no existe vuelve a cinco');
  assert.equal(await largo('?limit=-1'), 5);
  assert.equal(await largo('?limit=abc'), 5);
});
