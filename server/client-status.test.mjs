import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// "Nuevo contacto" ya no es un estado de clienta: solo Activa y Finalizada.
// Una base ya creada lo tiene en tres sitios: la lista de Ajustes, las fichas
// que lo usan y el DEFAULT de la columna, que SQLite no deja cambiar. Hay que
// limpiar los dos primeros y esquivar el tercero.

const dir = mkdtempSync(join(tmpdir(), 'crm-estado-'));
const file = join(dir, 'antigua.db');
let srv;
let a;

before(async () => {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      service TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT '', dueDate TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Nuevo contacto', notes TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE catalogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL, value TEXT NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
  `);
  const cat = db.prepare("INSERT INTO catalogs (type, value, sortOrder) VALUES ('clientStatus', ?, ?)");
  ['Nuevo contacto', 'Activa', 'Finalizada'].forEach((v, i) => cat.run(v, i));
  const cli = db.prepare('INSERT INTO clients (name, status) VALUES (?, ?)');
  cli.run('Ana', 'Nuevo contacto');
  cli.run('Bea', 'Activa');
  cli.run('Eva', 'Finalizada');
  db.close();

  process.env.CRM_DB_FILE = file;
  delete process.env.TURSO_DATABASE_URL;
  const { startServer } = await import('./test-helpers.mjs');
  srv = await startServer();
  a = srv.client;
  await a.post('/api/auth/setup', { email: 'admin@example.com', name: 'Admin', password: 'contrasena-larga-1' });
});

after(async () => {
  srv.close();
  const { close } = await import('./db.js');
  await close();
  rmSync(dir, { recursive: true, force: true });
});

test('las fichas que estaban en "Nuevo contacto" pasan a Activa y las demás no se tocan', async () => {
  const rows = (await a.get('/api/clients')).data;
  const estado = Object.fromEntries(rows.map((c) => [c.name, c.status]));
  assert.deepEqual(estado, { Ana: 'Activa', Bea: 'Activa', Eva: 'Finalizada' });
});

test('la opción sale de la lista de Ajustes', async () => {
  const { values } = (await a.get('/api/catalogs')).data;
  assert.deepEqual(values.clientStatus.map((v) => v.value), ['Activa', 'Finalizada']);
});

test('una clienta nueva sin estado queda Activa aunque la columna de esta base diga otra cosa', async () => {
  const { all } = await import('./db.js');
  const col = (await all('PRAGMA table_info(clients)')).find((c) => c.name === 'status');
  assert.match(col.dflt_value, /Nuevo contacto/, 'la base antigua conserva su DEFAULT: es el caso a esquivar');

  const creada = await a.post('/api/clients', { name: 'Sin estado' });
  assert.equal(creada.status, 201);
  assert.equal(creada.data.status, 'Activa');
});

test('el estado por defecto es el primero activo de la lista', async () => {
  const { values } = (await a.get('/api/catalogs')).data;
  const activa = values.clientStatus.find((v) => v.value === 'Activa');
  await a.put(`/api/catalogs/${activa.id}`, { active: false });
  assert.equal((await a.post('/api/clients', { name: 'Otra' })).data.status, 'Finalizada');
  await a.put(`/api/catalogs/${activa.id}`, { active: true });
});

test('si se pide un estado concreto se respeta', async () => {
  assert.equal((await a.post('/api/clients', { name: 'Con estado', status: 'Finalizada' })).data.status, 'Finalizada');
});

test('el panel de inicio ya no cuenta "nuevos contactos"', async () => {
  const d = (await a.get('/api/dashboard')).data;
  assert.ok(!('newClients' in d));
  assert.equal(d.activeClients, 3, 'Ana, Bea y la que se creó sin estado');
});
