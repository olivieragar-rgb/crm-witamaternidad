import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, makeClient } from './test-helpers.mjs';

const tmp = useTempDb(); // antes de importar app.js

const PW = 'contrasena-larga-1';

let srv;
let a; // administradora
let pro;

before(async () => {
  srv = await startServer();
  a = srv.client;
  await a.post('/api/auth/setup', { email: 'admin@example.com', name: 'Admin', password: PW });
  await a.post('/api/users', { email: 'pro@example.com', name: 'Pro', role: 'pro', password: PW });
  pro = makeClient(srv.base);
  await pro.post('/api/auth/login', { email: 'pro@example.com', password: PW });
});
after(async () => {
  srv.close();
  await tmp.cleanup();
});

// ---- ajustes --------------------------------------------------------------

test('los ajustes arrancan con los valores de fabrica', async () => {
  const s = (await a.get('/api/settings')).data;
  assert.equal(s.issuer.name, '', 'los datos fiscales los rellena la usuaria');
  assert.equal(s.issuer.country, 'España');
  assert.equal(s.invoicing.rectifySeries, 'R');
  assert.match(s.invoicing.exemptionNote, /20\.Uno\.3/, 'trae la nota de exencion sanitaria');
  assert.equal(s.brand.name, 'Wita');
  assert.match(s.emailTemplate.subject, /\{\{numero\}\}/);
});

test('guardar ajustes solo cambia las claves conocidas', async () => {
  const res = await a.put('/api/settings/brand', { name: 'Otro Negocio', colado: 'no' });
  assert.equal(res.data.name, 'Otro Negocio');
  assert.equal(res.data.colado, undefined);
  assert.equal(res.data.sidebarFooter, 'WawaywawO', 'lo que no se toca se conserva');

  // Y persiste.
  assert.equal((await a.get('/api/settings')).data.brand.name, 'Otro Negocio');
  await a.put('/api/settings/brand', { name: 'Wita' });
});

// ---- catálogos ------------------------------------------------------------

test('los catalogos se siembran con los valores de fabrica', async () => {
  const { types, values } = (await a.get('/api/catalogs')).data;
  assert.ok(types.clientService && types.mode && types.paymentMethod);
  assert.deepEqual(
    values.clientStatus.map((v) => v.value),
    ['Nuevo contacto', 'Activa', 'Finalizada'],
  );
  assert.ok(values.clientStatus.every((v) => v.active));
});

test('un pro lee los catalogos pero no los cambia', async () => {
  assert.equal((await pro.get('/api/catalogs')).status, 200);
  assert.equal((await pro.post('/api/catalogs', { type: 'mode', value: 'X' })).status, 403);
  assert.equal((await pro.put('/api/catalogs/1', { value: 'X' })).status, 403);
  assert.equal((await pro.del('/api/catalogs/1')).status, 403);
});

test('anadir, renombrar, desactivar y borrar una opcion', async () => {
  const add = await a.post('/api/catalogs', { type: 'mode', value: 'Domicilio' });
  assert.equal(add.status, 201);
  const creada = add.data.mode.find((v) => v.value === 'Domicilio');
  assert.ok(creada, 'aparece en la lista');

  assert.equal(
    (await a.post('/api/catalogs', { type: 'mode', value: 'Domicilio' })).status,
    409,
    'no se repite',
  );
  assert.equal((await a.post('/api/catalogs', { type: 'mode', value: '  ' })).status, 400);
  assert.equal((await a.post('/api/catalogs', { type: 'inventado', value: 'X' })).status, 400);

  const renombrada = await a.put(`/api/catalogs/${creada.id}`, { value: 'A domicilio' });
  assert.ok(renombrada.data.mode.some((v) => v.value === 'A domicilio'));

  const desactivada = await a.put(`/api/catalogs/${creada.id}`, { active: false });
  assert.equal(desactivada.data.mode.find((v) => v.id === creada.id).active, false);

  const borrada = await a.del(`/api/catalogs/${creada.id}`);
  assert.ok(!borrada.data.mode.some((v) => v.id === creada.id));
});

test('desactivar una opcion no toca las fichas que ya la usaban', async () => {
  const { values } = (await a.get('/api/catalogs')).data;
  const online = values.mode.find((v) => v.value === 'Online');

  const clienta = (await a.post('/api/clients', { name: 'Marta', mode: 'Online' })).data;
  await a.put(`/api/catalogs/${online.id}`, { active: false });

  const despues = (await a.get(`/api/clients/${clienta.id}`)).data;
  assert.equal(despues.mode, 'Online', 'la ficha conserva lo que tenia');

  await a.put(`/api/catalogs/${online.id}`, { active: true });
});

test('renombrar una opcion tampoco reescribe el pasado', async () => {
  const { values } = (await a.get('/api/catalogs')).data;
  const opt = values.clientStatus.find((v) => v.value === 'Activa');

  const clienta = (await a.post('/api/clients', { name: 'Nerea', status: 'Activa' })).data;
  await a.put(`/api/catalogs/${opt.id}`, { value: 'En seguimiento' });

  assert.equal(
    (await a.get(`/api/clients/${clienta.id}`)).data.status,
    'Activa',
    'cambiar la lista de opciones no deberia reescribir lo ya guardado',
  );
  await a.put(`/api/catalogs/${opt.id}`, { value: 'Activa' });
});

test('un campo numerico que no viene usa su valor por defecto, no null', async () => {
  // La columna es NOT NULL: meter null ahi devolvia un 500 en vez de aplicar
  // el valor por defecto.
  const res = await a.post('/api/services', { name: 'Solo nombre' });
  assert.equal(res.status, 201);
  assert.equal(res.data.price, 0);
  assert.equal(res.data.durationMin, 60);
  assert.equal(res.data.active, 1);
});

test('un campo de texto que no viene usa el DEFAULT de la tabla', async () => {
  // Una cita creada sin estado tiene que quedar Programada. Antes el INSERT
  // metia cadena vacia y pisaba el valor por defecto de la columna.
  const c = (await a.post('/api/clients', { name: 'Para la cita' })).data;
  const cita = await a.post('/api/appointments', { clientId: c.id, date: '2026-12-01 10:00' });
  assert.equal(cita.status, 201);
  assert.equal(cita.data.status, 'Programada');
  assert.equal(cita.data.mode, '', 'lo que no tiene DEFAULT si queda vacio');

  // Y una clienta sin estado queda como nuevo contacto.
  assert.equal((await a.post('/api/clients', { name: 'Sin estado' })).data.status, 'Nuevo contacto');
});

test('la cuenta de desarrollo no existe fuera de local', async () => {
  // Las pruebas corren con CRM_DB_FILE, igual que produccion corre con Turso:
  // en ninguno de los dos casos se siembra nada, asi que dev@local.test no
  // puede aparecer.
  const db = await import('./db.js');
  const dev = await db.get("SELECT id FROM users WHERE email = 'dev@local.test'");
  assert.equal(dev, null, 'la cuenta de desarrollo solo se crea en la base local');
});

test('la siembra no duplica al reiniciar', async () => {
  const { seedCatalogs } = await import('./catalogs.js');
  const antes = (await a.get('/api/catalogs')).data.values.mode.length;
  await seedCatalogs();
  assert.equal((await a.get('/api/catalogs')).data.values.mode.length, antes);
});
