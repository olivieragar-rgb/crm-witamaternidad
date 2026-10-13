// Data layer with two drivers behind one async interface:
//   - local dev   -> node:sqlite (file crm.db), no extra services
//   - production  -> Turso / libSQL (serverless-friendly) when TURSO_DATABASE_URL is set
// Routes only use the async helpers (all/get/run), so they don't care which runs.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const useTurso = !!process.env.TURSO_DATABASE_URL;

let implPromise;
function impl() {
  if (!implPromise) implPromise = useTurso ? makeLibsql() : makeNodeSqlite();
  return implPromise;
}

async function makeNodeSqlite() {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(here, 'crm.db'));
  db.exec('PRAGMA foreign_keys = ON;');
  return {
    all: (sql, args = []) => db.prepare(sql).all(...args),
    get: (sql, args = []) => db.prepare(sql).get(...args) ?? null,
    run: (sql, args = []) => {
      const r = db.prepare(sql).run(...args);
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    exec: (sql) => db.exec(sql),
  };
}

async function makeLibsql() {
  const { createClient } = await import('@libsql/client');
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const toObj = (columns) => (row) => {
    const o = {};
    columns.forEach((c, i) => (o[c] = row[i]));
    return o;
  };
  return {
    all: async (sql, args = []) => {
      const r = await client.execute({ sql, args });
      return r.rows.map(toObj(r.columns));
    },
    get: async (sql, args = []) => {
      const r = await client.execute({ sql, args });
      return r.rows.length ? r.rows.map(toObj(r.columns))[0] : null;
    },
    run: async (sql, args = []) => {
      const r = await client.execute({ sql, args });
      return {
        changes: Number(r.rowsAffected),
        lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : null,
      };
    },
    exec: (sql) => client.executeMultiple(sql),
  };
}

export async function all(sql, args) {
  return (await impl()).all(sql, args);
}
export async function get(sql, args) {
  return (await impl()).get(sql, args);
}
export async function run(sql, args) {
  return (await impl()).run(sql, args);
}

// ---- schema + seed -------------------------------------------------------

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
    service TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT '', dueDate TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Nuevo contacto', notes TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price REAL NOT NULL DEFAULT 0,
    durationMin INTEGER NOT NULL DEFAULT 60, active INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clientId INTEGER, serviceId INTEGER, date TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Programada', notes TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL DEFAULT '', clientId INTEGER, date TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Borrador', notes TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoiceId INTEGER NOT NULL, description TEXT NOT NULL DEFAULT '',
    qty REAL NOT NULL DEFAULT 1, price REAL NOT NULL DEFAULT 0, vat REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

let readyPromise;
export function ready() {
  if (!readyPromise) readyPromise = init();
  return readyPromise;
}

async function init() {
  await (await impl()).exec(SCHEMA);
  await seed();
}

async function seed() {
  const count = async (t) => (await get(`SELECT COUNT(*) AS n FROM ${t}`)).n;
  const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const dayTime = (offset, hhmm) => `${day(offset)} ${hhmm}`;
  const thisMonth = (dd) => new Date().toISOString().slice(0, 8) + dd;
  const year = new Date().getFullYear();

  if ((await count('services')) === 0) {
    const s = 'INSERT INTO services (name, description, price, durationMin, active) VALUES (?, ?, ?, ?, 1)';
    await run(s, ['Hipnoparto · Programa completo', 'Preparación al parto en 5 sesiones.', 280, 90]);
    await run(s, ['Consulta de lactancia', 'Valoración y plan de lactancia.', 60, 75]);
    await run(s, ['Sesión online', 'Acompañamiento por videollamada.', 45, 60]);
    await run(s, ['Sesión suelta de preparación', 'Sesión individual presencial.', 65, 90]);
  }

  if ((await count('clients')) === 0) {
    const c = `INSERT INTO clients (name, email, phone, service, mode, dueDate, status, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    await run(c, ['Lucía Fernández', 'lucia@example.com', '600111222', 'Hipnoparto / Preparación al parto', 'Presencial (Granada)', day(26), 'Activa', 'Primer embarazo. Interesada en parto respetado.']);
    await run(c, ['Marta Ruiz', 'marta@example.com', '600333444', 'Lactancia', 'Online', '', 'Activa', 'Consulta de lactancia a las 3 semanas posparto.']);
    await run(c, ['Nerea Gómez', 'nerea@example.com', '600555666', 'Consulta online', 'Online', day(54), 'Nuevo contacto', 'Escribió por el blog de hipnoparto.']);
  }

  if ((await count('appointments')) === 0) {
    const a = 'INSERT INTO appointments (clientId, serviceId, date, mode, status, notes) VALUES (?, ?, ?, ?, ?, ?)';
    await run(a, [1, 1, dayTime(3, '17:00'), 'Presencial (Granada)', 'Programada', 'Sesión 1 de 5.']);
    await run(a, [2, 2, dayTime(-5, '10:30'), 'Online', 'Realizada', 'Buen agarre, seguimiento en 1 semana.']);
    await run(a, [3, 3, dayTime(8, '18:00'), 'Online', 'Programada', 'Primera toma de contacto.']);
  }

  if ((await count('invoices')) === 0) {
    const inv = 'INSERT INTO invoices (number, clientId, date, status, notes) VALUES (?, ?, ?, ?, ?)';
    const item = 'INSERT INTO invoice_items (invoiceId, description, qty, price, vat) VALUES (?, ?, ?, ?, ?)';
    const prev = new Date();
    prev.setMonth(prev.getMonth() - 1, 18);
    const i0 = (await run(inv, [`${year}-0001`, 3, prev.toISOString().slice(0, 10), 'Pagada', ''])).lastInsertRowid;
    await run(item, [i0, 'Sesión suelta de preparación', 2, 65, 0]);
    const i1 = (await run(inv, [`${year}-0002`, 1, thisMonth('05'), 'Pagada', ''])).lastInsertRowid;
    await run(item, [i1, 'Hipnoparto · Programa completo', 1, 280, 0]);
    const i2 = (await run(inv, [`${year}-0003`, 2, thisMonth('12'), 'Enviada', ''])).lastInsertRowid;
    await run(item, [i2, 'Consulta de lactancia', 1, 60, 0]);
  }
}
