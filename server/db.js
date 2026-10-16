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
  // En Vercel el sistema de ficheros es de solo lectura, asi que sin las
  // credenciales de Turso no hay base posible. Mejor decirlo que fallar con
  // un error de permisos que no explica nada.
  if (process.env.VERCEL && !process.env.CRM_DB_FILE) {
    const err = new Error(
      'Faltan TURSO_DATABASE_URL y TURSO_AUTH_TOKEN en las variables de entorno del proyecto.',
    );
    err.code = 'NO_DATABASE_CONFIGURED';
    throw err;
  }
  const { DatabaseSync } = await import('node:sqlite');
  // CRM_DB_FILE deja a las pruebas trabajar sobre una base aparte.
  const db = new DatabaseSync(process.env.CRM_DB_FILE || join(here, 'crm.db'));
  db.exec('PRAGMA foreign_keys = ON;');
  return {
    all: (sql, args = []) => db.prepare(sql).all(...args),
    get: (sql, args = []) => db.prepare(sql).get(...args) ?? null,
    run: (sql, args = []) => {
      const r = db.prepare(sql).run(...args);
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
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
    close: () => client.close(),
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
/** Cierra la conexion. Lo usan las pruebas para poder borrar su base temporal. */
export async function close() {
  if (!implPromise) return;
  await (await implPromise).close();
  implPromise = undefined;
  readyPromise = undefined;
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
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'pro',
    passwordHash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    lastLoginAt TEXT,
    failedAttempts INTEGER NOT NULL DEFAULT 0,
    lockedUntil TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tokenHash TEXT NOT NULL UNIQUE,
    userId INTEGER NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    expiresAt TEXT NOT NULL,
    lastSeenAt TEXT NOT NULL DEFAULT (datetime('now')),
    ip TEXT NOT NULL DEFAULT '', userAgent TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (userId);
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    userId INTEGER, userEmail TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT '', entity TEXT NOT NULL DEFAULT '',
    entityId TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '', userAgent TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log (at DESC);
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '{}',
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
    supplier TEXT NOT NULL DEFAULT '', supplierTaxId TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    base REAL NOT NULL DEFAULT 0, vatRate REAL NOT NULL DEFAULT 0,
    deductible INTEGER NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (date DESC);
  CREATE TABLE IF NOT EXISTS catalogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, value TEXT NOT NULL,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_catalogs_type ON catalogs (type, sortOrder);
  -- Cuestionario de alta de la clienta. Las respuestas van en JSON porque los
  -- dos cuestionarios no comparten ni una pregunta y las preguntas van a
  -- cambiar: en columnas seria una migracion por pregunta.
  --
  -- El unico es la pareja (clientId, kind) y no la clienta: una misma clienta
  -- puede contratar preparacion al parto y, meses despues, lactancia.
  CREATE TABLE IF NOT EXISTS client_forms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clientId INTEGER NOT NULL,
    kind TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pendiente',
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_client_forms ON client_forms (clientId, kind);
`;

// Columnas e indices que se anadieron despues de la primera version. Se
// aplican con ALTER TABLE y no recreando las tablas, porque la base de
// produccion ya tiene datos reales.
const COLUMNS = [
  ['clients', 'taxId', "TEXT NOT NULL DEFAULT ''"],
  ['clients', 'address', "TEXT NOT NULL DEFAULT ''"],
  ['clients', 'postalCode', "TEXT NOT NULL DEFAULT ''"],
  ['clients', 'city', "TEXT NOT NULL DEFAULT ''"],
  ['clients', 'province', "TEXT NOT NULL DEFAULT ''"],
  ['clients', 'country', "TEXT NOT NULL DEFAULT 'España'"],

  // El numero se compone de serie + ano fiscal + correlativo, y el correlativo
  // reinicia cada ano, asi que la clave unica son los tres juntos.
  ['invoices', 'series', "TEXT NOT NULL DEFAULT ''"],
  ['invoices', 'fiscalYear', 'INTEGER'],
  ['invoices', 'seq', 'INTEGER'],
  ['invoices', 'issuedAt', 'TEXT'],
  ['invoices', 'dueDate', "TEXT NOT NULL DEFAULT ''"],
  ['invoices', 'paidAt', "TEXT NOT NULL DEFAULT ''"],
  ['invoices', 'paymentMethod', "TEXT NOT NULL DEFAULT ''"],
  ['invoices', 'irpfRate', 'REAL NOT NULL DEFAULT 0'],
  ['invoices', 'exemptionNote', "TEXT NOT NULL DEFAULT ''"],
  ['invoices', 'rectifiesId', 'INTEGER'],
  ['invoices', 'rectifyReason', "TEXT NOT NULL DEFAULT ''"],
  ['invoices', 'issuerSnapshot', "TEXT NOT NULL DEFAULT ''"],
  ['invoices', 'clientSnapshot', "TEXT NOT NULL DEFAULT ''"],
  ['invoices', 'hash', "TEXT NOT NULL DEFAULT ''"],
  ['invoices', 'hashPrev', "TEXT NOT NULL DEFAULT ''"],

  ['invoice_items', 'discount', 'REAL NOT NULL DEFAULT 0'],

  // RGPD: constancia del consentimiento y marca de ficha anonimizada.
  ['clients', 'consentAt', "TEXT NOT NULL DEFAULT ''"],
  ['clients', 'consentChannel', "TEXT NOT NULL DEFAULT ''"],
  ['clients', 'consentVersion', "TEXT NOT NULL DEFAULT ''"],
  ['clients', 'anonymizedAt', "TEXT NOT NULL DEFAULT ''"],

  // Fecha del ultimo recordatorio enviado, para no repetirlo sin querer.
  ['invoices', 'remindedAt', "TEXT NOT NULL DEFAULT ''"],

  // Art. 6.1.i del RD 1619/2012: la fecha en que se realizo la operacion,
  // obligatoria en la factura cuando no coincide con la de expedicion.
  ['invoices', 'operationDate', "TEXT NOT NULL DEFAULT ''"],
  // Art. 6.1.m: mencion de inversion del sujeto pasivo.
  ['invoices', 'reverseCharge', 'INTEGER NOT NULL DEFAULT 0'],
  ['appointments', 'remindedAt', "TEXT NOT NULL DEFAULT ''"],
];

const INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices (date DESC);
  CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices (clientId);
  CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices (status);
  CREATE INDEX IF NOT EXISTS idx_items_invoice ON invoice_items (invoiceId);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number ON invoices (number) WHERE number <> '';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_series_seq
    ON invoices (series, fiscalYear, seq) WHERE seq IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_catalogs_unique ON catalogs (type, lower(trim(value)));
`;

let readyPromise;
export function ready() {
  if (!readyPromise) {
    // Si la preparacion falla, se olvida la promesa rechazada: de lo
    // contrario la instancia se queda devolviendo el mismo error para
    // siempre y ni siquiera un reintento puede recuperarla.
    readyPromise = init().catch((e) => {
      readyPromise = undefined;
      throw e;
    });
  }
  return readyPromise;
}

async function init() {
  await (await impl()).exec(SCHEMA);
  await migrate();
  // Las listas desplegables arrancan con los valores de fabrica; a partir de
  // ahi se editan desde Ajustes.
  const { seedCatalogs } = await import('./catalogs.js');
  await seedCatalogs();
  // Los datos de ejemplo inventan nombres y telefonos de clientas: solo en
  // local. En produccion la base arranca vacia y la rellena su usuaria.
  if (!useTurso && !process.env.CRM_DB_FILE) await seed();
}

/**
 * Problemas encontrados al migrar que no impiden arrancar pero hay que
 * resolver. Los expone /api/health.
 * @type {Array<{ step: string, detail: string }>}
 */
export const migrationIssues = [];

async function migrate() {
  migrationIssues.length = 0;

  for (const [table, column, ddl] of COLUMNS) {
    const cols = await all(`PRAGMA table_info(${table})`);
    if (cols.some((c) => c.name === column)) continue;
    await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }

  // Tiene que ir antes de los indices: el UNIQUE de catalogs no se puede
  // crear mientras haya opciones repetidas.
  await dedupeCatalogs();

  // Los indices se crean uno a uno. Un indice UNIQUE sobre datos que ya
  // existian puede fallar si esos datos lo violan, y eso no puede dejar la
  // aplicacion entera sin arrancar: se anota y se sigue.
  for (const sql of INDEXES.split(';').map((x) => x.trim()).filter(Boolean)) {
    try {
      await run(sql);
    } catch (e) {
      migrationIssues.push({ step: 'index', detail: `${nameOfIndex(sql)}: ${e.code || e.name}` });
    }
  }

  // La primera version de la columna se creo con el pais sin tilde.
  await run("UPDATE clients SET country = 'España' WHERE country = 'Espana'");
  await backfillInvoiceSeries();
  await backfillInvoiceSnapshots();
  await checkDuplicateNumbers();
}

/**
 * Opciones de lista repetidas. Las sembraron dos arranques a la vez (en un
 * despliegue sin estado cada instancia comprueba "¿hay opciones?" y siembra
 * si no): cada opcion salia dos veces en el desplegable. Se queda una por
 * (tipo, valor sin mayusculas ni espacios), prefiriendo la que esta activa.
 * Borrar es seguro: las fichas guardan el texto de la opcion, no su id.
 */
async function dedupeCatalogs() {
  const rows = await all('SELECT id, type, value, active FROM catalogs ORDER BY id');
  const grupos = new Map();
  for (const r of rows) {
    const clave = `${r.type}\u0000${String(r.value).trim().toLowerCase()}`;
    (grupos.get(clave) ?? grupos.set(clave, []).get(clave)).push(r);
  }
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    const conservar = grupo.find((r) => r.active) ?? grupo[0];
    for (const r of grupo) if (r !== conservar) await run('DELETE FROM catalogs WHERE id = ?', [r.id]);
  }
}

const nameOfIndex = (sql) => (/INDEX(?: IF NOT EXISTS)? (\w+)/i.exec(sql) || [, '?'])[1];

/**
 * Numeros de factura repetidos. El codigo anterior no garantizaba que fueran
 * unicos, asi que una base con historial puede traerlos. No se tocan: son
 * documentos fiscales y renumerarlos por nuestra cuenta seria peor que el
 * problema. Se avisa para que se corrijan a mano.
 */
async function checkDuplicateNumbers() {
  const dups = await all(
    `SELECT number, COUNT(*) AS n FROM invoices
     WHERE number <> '' GROUP BY number HAVING n > 1 ORDER BY number`,
  );
  for (const d of dups) {
    migrationIssues.push({ step: 'duplicate-number', detail: `${d.number} aparece ${d.n} veces` });
  }
}

// Las facturas emitidas antes de que existiera la copia de datos fiscales
// reconstruian esos datos leyendo la ficha de la clienta. Eso tiene dos
// problemas: la factura cambiaba si se corregia la ficha, y anonimizar a la
// clienta le borraba el nombre y el NIF. Se les rellena la copia con lo que
// dice la ficha ahora, que es la mejor reconstruccion posible.
async function backfillInvoiceSnapshots() {
  const pending = await all(
    "SELECT id, clientId FROM invoices WHERE clientSnapshot = '' AND seq IS NOT NULL AND clientId IS NOT NULL",
  );
  for (const inv of pending) {
    const client = await get(
      'SELECT name, taxId, address, postalCode, city, province, country, email FROM clients WHERE id = ?',
      [inv.clientId],
    );
    if (!client) continue;
    await run('UPDATE invoices SET clientSnapshot = ? WHERE id = ?', [JSON.stringify(client), inv.id]);
  }
}

// Las facturas anteriores a la serie y el correlativo traian el numero en un
// campo de texto con formato AAAA-NNNN. Las ya emitidas conservan exactamente
// ese numero y se les reconstruye ano y correlativo. Los borradores lo
// pierden: ahora el numero se asigna al emitir y no al crear.
async function backfillInvoiceSeries() {
  const pending = await all('SELECT id, number, date, status FROM invoices WHERE seq IS NULL');
  for (const inv of pending) {
    const m = /^(\d{4})-(\d{4})$/.exec(String(inv.number || ''));
    if (inv.status === 'Borrador' || !m) {
      await run("UPDATE invoices SET number = '' WHERE id = ?", [inv.id]);
      continue;
    }
    try {
      await run('UPDATE invoices SET fiscalYear = ?, seq = ?, issuedAt = ? WHERE id = ?', [
        Number(m[1]),
        Number(m[2]),
        inv.date || null,
        inv.id,
      ]);
    } catch (e) {
      // Dos facturas con el mismo numero chocarian aqui. Se deja la factura
      // como esta y se avisa: el dato es fiscal y lo arregla una persona.
      migrationIssues.push({
        step: 'backfill',
        detail: `factura ${inv.id} (${inv.number}): ${e.code || e.name}`,
      });
    }
  }
}

async function seed() {
  const count = async (t) => (await get(`SELECT COUNT(*) AS n FROM ${t}`)).n;

  // Cuenta de desarrollo, para poder abrir el CRM en local sin tener que
  // crear una cuenta cada vez que se borra la base.
  //
  // Esto SOLO corre en local: seed() no se llama cuando hay Turso (es decir,
  // en produccion) ni en las pruebas. Las credenciales estan escritas en el
  // README a proposito, porque no protegen nada: viven en un fichero SQLite
  // del propio ordenador al que solo responde localhost.
  if ((await count('users')) === 0) {
    const { hashPassword } = await import('./passwords.js');
    await run(
      "INSERT INTO users (email, name, role, passwordHash, active) VALUES (?, ?, 'admin', ?, 1)",
      ['dev@local.test', 'Desarrollo', await hashPassword('desarrollo-local')],
    );
  }
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
