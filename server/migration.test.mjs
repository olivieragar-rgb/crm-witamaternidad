import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Una base como la que puede haber en produccion: creada por la version
// anterior del CRM, antes de que existiera la numeracion correlativa, y con
// dos facturas que comparten numero. El codigo antiguo no lo impedia.
//
// Esto tumbaba la aplicacion entera: el indice UNIQUE sobre el numero no se
// podia crear, la preparacion de la base fallaba, y como corre antes de cada
// peticion, TODAS las rutas devolvian 500. Ni siquiera se llegaba al login.

const dir = mkdtempSync(join(tmpdir(), 'crm-migra-'));
const file = join(dir, 'legado.db');

before(() => {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      service TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT '', dueDate TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Nuevo contacto', notes TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price REAL NOT NULL DEFAULT 0,
      durationMin INTEGER NOT NULL DEFAULT 60, active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clientId INTEGER, serviceId INTEGER, date TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Programada',
      notes TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL DEFAULT '', clientId INTEGER, date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Borrador', notes TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoiceId INTEGER NOT NULL, description TEXT NOT NULL DEFAULT '',
      qty REAL NOT NULL DEFAULT 1, price REAL NOT NULL DEFAULT 0, vat REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`INSERT INTO clients (name, email) VALUES ('Lucía', 'lucia@example.com')`);
  // Dos facturas emitidas con el MISMO numero, que es lo que rompia todo.
  db.exec(`INSERT INTO invoices (number, clientId, date, status) VALUES ('2026-0001', 1, '2026-01-10', 'Pagada')`);
  db.exec(`INSERT INTO invoices (number, clientId, date, status) VALUES ('2026-0001', 1, '2026-02-10', 'Enviada')`);
  db.exec(`INSERT INTO invoices (number, clientId, date, status) VALUES ('2026-0002', 1, '2026-03-10', 'Pagada')`);
  db.exec(`INSERT INTO invoice_items (invoiceId, description, qty, price, vat) VALUES (1, 'Sesión', 1, 100, 0)`);
  db.exec(`INSERT INTO invoice_items (invoiceId, description, qty, price, vat) VALUES (2, 'Sesión', 1, 200, 0)`);
  db.exec(`INSERT INTO invoice_items (invoiceId, description, qty, price, vat) VALUES (3, 'Sesión', 1, 300, 0)`);
  db.close();

  process.env.CRM_DB_FILE = file;
  delete process.env.TURSO_DATABASE_URL;
});
after(async () => {
  const { close } = await import('./db.js');
  await close();
  rmSync(dir, { recursive: true, force: true });
});

test('una base con numeros de factura repetidos no tumba la aplicacion', async () => {
  const db = await import('./db.js');
  // Lo que importa: esto NO puede lanzar.
  await db.ready();

  const { migrationIssues } = db;
  assert.ok(
    migrationIssues.some((i) => i.step === 'duplicate-number' && i.detail.includes('2026-0001')),
    `deberia avisar del numero repetido: ${JSON.stringify(migrationIssues)}`,
  );
});

test('las facturas repetidas se conservan tal cual', async () => {
  const db = await import('./db.js');
  // Son documentos fiscales: renumerarlas por nuestra cuenta seria peor que
  // el problema. Siguen las tres, con su numero y su importe.
  const rows = await db.all('SELECT id, number, status FROM invoices ORDER BY id');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.number), ['2026-0001', '2026-0001', '2026-0002']);

  const items = await db.all('SELECT COUNT(*) AS n FROM invoice_items');
  assert.equal(items[0].n, 3, 'no se pierde ninguna linea');
});

test('el resto de la migracion si se aplica', async () => {
  const db = await import('./db.js');
  // Aunque un indice no se pueda crear, las columnas y las tablas nuevas
  // tienen que estar: la aplicacion debe quedar utilizable.
  const cols = (await db.all('PRAGMA table_info(clients)')).map((c) => c.name);
  for (const c of ['taxId', 'consentAt', 'anonymizedAt']) {
    assert.ok(cols.includes(c), `falta la columna ${c}`);
  }
  const tablas = (
    await db.all("SELECT name FROM sqlite_master WHERE type='table'")
  ).map((t) => t.name);
  for (const t of ['users', 'sessions', 'audit_log', 'settings', 'catalogs', 'expenses']) {
    assert.ok(tablas.includes(t), `falta la tabla ${t}`);
  }
});

test('la API responde con la base heredada', async () => {
  const { startServer, makeClient } = await import('./test-helpers.mjs');
  const srv = await startServer();
  const c = makeClient(srv.base);

  // Antes del arreglo, esto devolvia 500 en todas las rutas.
  const estado = await c.get('/api/setup-status');
  assert.equal(estado.status, 200);
  assert.deepEqual(estado.data, { needsSetup: true }, 'se puede crear la primera cuenta');

  const salud = await c.get('/api/health');
  assert.equal(salud.data.db, 'ok');
  assert.ok(salud.data.issues.length > 0, 'health avisa de lo que hay que arreglar');

  srv.close();
});
