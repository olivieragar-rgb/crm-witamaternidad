import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Los desplegables salen de la tabla `catalogs`. Si una lista esta sembrada
// dos veces, cada opcion aparece dos veces en los formularios (en citas, el
// Estado: Programada, Realizada, Cancelada, Programada, Realizada...).
//
// Como pasa: en un despliegue sin estado (Vercel) cada instancia que arranca
// comprueba "¿hay opciones?" y, si no, siembra las de fabrica. Dos arranques a
// la vez ven la tabla vacia los dos y siembran los dos.

const dir = mkdtempSync(join(tmpdir(), 'crm-catalogos-'));
const file = join(dir, 'duplicados.db');

before(() => {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE catalogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL, value TEXT NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
  `);
  const add = db.prepare('INSERT INTO catalogs (type, value, sortOrder, active) VALUES (?, ?, ?, ?)');
  // El estado de cita, sembrado dos veces.
  for (let vuelta = 0; vuelta < 2; vuelta++) {
    ['Programada', 'Realizada', 'Cancelada'].forEach((v, i) => add.run('appointmentStatus', v, i, 1));
  }
  // Una variante de mayusculas y una opcion que quien edita ya habia apagado.
  add.run('mode', 'Online', 0, 0); // la primera esta desactivada...
  add.run('mode', 'online', 1, 1); // ...y su repetida, activa: tiene que sobrevivir la activa
  add.run('mode', 'Presencial (Granada)', 2, 1);
  db.close();

  process.env.CRM_DB_FILE = file;
  delete process.env.TURSO_DATABASE_URL;
});

after(async () => {
  const { close } = await import('./db.js');
  await close();
  rmSync(dir, { recursive: true, force: true });
});

const valores = async (type) => {
  const { all } = await import('./db.js');
  return (await all('SELECT value, active FROM catalogs WHERE type = ? ORDER BY sortOrder, id', [type])).map(
    (r) => r.value + (r.active ? '' : ' (off)'),
  );
};

test('al arrancar se quitan las opciones sembradas dos veces', async () => {
  const { ready } = await import('./db.js');
  await ready();
  assert.deepEqual(await valores('appointmentStatus'), ['Programada', 'Realizada', 'Cancelada']);
});

test('de dos opciones iguales se queda la que esta activa', async () => {
  assert.deepEqual(await valores('mode'), ['online', 'Presencial (Granada)']);
});

test('la base ya no admite una opcion repetida, ni con otras mayusculas', async () => {
  const { run } = await import('./db.js');
  await assert.rejects(run("INSERT INTO catalogs (type, value) VALUES ('appointmentStatus', 'Programada')"));
  await assert.rejects(run("INSERT INTO catalogs (type, value) VALUES ('appointmentStatus', ' programada ')"));
  // En otro tipo si vale: son listas distintas.
  await run("INSERT INTO catalogs (type, value) VALUES ('paymentMethod', 'Programada')");
  await run("DELETE FROM catalogs WHERE type = 'paymentMethod' AND value = 'Programada'");
});

test('dos siembras a la vez no duplican la lista', async () => {
  const { run } = await import('./db.js');
  await run("DELETE FROM catalogs WHERE type = 'paymentMethod'");
  const { seedCatalogs } = await import('./catalogs.js');
  await Promise.all([seedCatalogs(), seedCatalogs(), seedCatalogs()]);
  assert.deepEqual(await valores('paymentMethod'), ['Transferencia', 'Bizum', 'Efectivo', 'Tarjeta']);
});
