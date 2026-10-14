import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, makeClient } from './test-helpers.mjs';

const tmp = useTempDb(); // antes de importar app.js

const PW = 'contrasena-larga-1';

let srv;
let a; // administradora
let pro;
let clientId;
let invoiceNumber;

before(async () => {
  srv = await startServer();
  a = srv.client;
  await a.post('/api/auth/setup', { email: 'admin@example.com', name: 'Admin', password: PW });
  await a.post('/api/users', { email: 'pro@example.com', name: 'Pro', role: 'pro', password: PW });
  pro = makeClient(srv.base);
  await pro.post('/api/auth/login', { email: 'pro@example.com', password: PW });

  await a.put('/api/settings/issuer', {
    name: 'Wita Maternidad',
    taxId: 'B12345678',
    address: 'Calle Real 1',
    city: 'Granada',
  });

  clientId = (
    await a.post('/api/clients', {
      name: 'Lucía Fernández',
      email: 'lucia@example.com',
      phone: '600111222',
      dueDate: '2026-11-09',
      notes: 'Primer embarazo. Parto respetado.',
      taxId: '11223344A',
      address: 'Calle Falsa 2',
      city: 'Granada',
      consentAt: '2026-01-15',
      consentChannel: 'Email',
      consentVersion: '1',
    })
  ).data.id;

  const service = (await a.post('/api/services', { name: 'Hipnoparto', price: 280 })).data.id;
  await a.post('/api/appointments', {
    clientId,
    serviceId: service,
    date: '2026-02-01 17:00',
    notes: 'Sesión 1. Comentó ansiedad.',
  });
  const draft = (
    await a.post('/api/invoices', {
      clientId,
      date: '2026-02-05',
      items: [{ description: 'Hipnoparto', qty: 1, price: 280, vat: 0 }],
    })
  ).data;
  invoiceNumber = (await a.post(`/api/invoices/${draft.id}/issue`)).data.number;
});
after(async () => {
  srv.close();
  await tmp.cleanup();
});

// ---- consentimiento ------------------------------------------------------

test('la ficha guarda cuando, por donde y que texto se acepto', async () => {
  const c = (await a.get(`/api/clients/${clientId}`)).data;
  assert.equal(c.consentAt, '2026-01-15');
  assert.equal(c.consentChannel, 'Email');
  assert.equal(c.consentVersion, '1');

  const { privacy } = (await a.get('/api/settings')).data;
  assert.equal(privacy.consentVersion, '1');
  assert.match(privacy.consentText, /los de salud/);
  assert.equal(privacy.retentionYears, 5);
});

test('los canales de consentimiento son un catalogo editable', async () => {
  const { values } = (await a.get('/api/catalogs')).data;
  assert.ok(values.consentChannel.some((v) => v.value === 'Email'));
});

// ---- derecho de acceso y portabilidad ------------------------------------

test('la exportacion trae ficha, citas y facturas', async () => {
  const res = await a.get(`/api/clients/${clientId}/export`);
  assert.equal(res.status, 200);
  assert.equal(res.data.client.name, 'Lucía Fernández');
  assert.equal(res.data.client.notes, 'Primer embarazo. Parto respetado.');
  assert.equal(res.data.appointments.length, 1);
  assert.equal(res.data.appointments[0].service, 'Hipnoparto');
  assert.equal(res.data.invoices.length, 1);
  assert.equal(res.data.invoices[0].number, invoiceNumber);
  assert.ok(res.data.responsable.name, 'dice quien es el responsable del tratamiento');
  assert.match(res.headers.get('content-disposition'), /attachment/);
});

test('exportar una clienta que no existe da 404', async () => {
  assert.equal((await a.get('/api/clients/99999/export')).status, 404);
});

// ---- registro de accesos -------------------------------------------------

test('leer una ficha deja constancia de quien la leyo', async () => {
  await pro.get(`/api/clients/${clientId}`);
  const res = await a.get('/api/audit?action=client_view');
  const mio = res.data.rows.find((r) => r.userEmail === 'pro@example.com' && r.entityId === String(clientId));
  assert.ok(mio, 'la lectura del pro deberia estar registrada');
  assert.ok(mio.at, 'con su marca de tiempo');
});

test('listar clientas tambien deja constancia', async () => {
  await pro.get('/api/clients');
  const res = await a.get('/api/audit?action=client_list');
  assert.ok(res.data.rows.some((r) => r.userEmail === 'pro@example.com'));
});

test('solo admin ve el registro de accesos', async () => {
  assert.equal((await pro.get('/api/audit')).status, 403);
  const res = await a.get('/api/audit');
  assert.equal(res.status, 200);
  assert.ok(res.data.total > 0);
  assert.ok(res.data.rows.length <= res.data.pageSize);
});

// ---- conservación --------------------------------------------------------

test('el listado de conservacion propone las fichas sin actividad', async () => {
  const res = await a.get('/api/clients/retention');
  assert.equal(res.status, 200);
  assert.equal(res.data.retentionYears, 5);
  assert.ok(
    !res.data.rows.some((r) => r.id === clientId),
    'una clienta con actividad de este ano no esta inactiva',
  );

  // Una ficha vieja de verdad si sale.
  const vieja = (await a.post('/api/clients', { name: 'Antigua' })).data;
  const db = await import('./db.js');
  await db.run("UPDATE clients SET createdAt = '2015-01-01' WHERE id = ?", [vieja.id]);
  const despues = await a.get('/api/clients/retention');
  assert.ok(despues.data.rows.some((r) => r.id === vieja.id));
});

// ---- derecho de supresión ------------------------------------------------

test('anonimizar vacia los datos personales y conserva la factura', async () => {
  const res = await a.post(`/api/clients/${clientId}/anonymize`, { reason: 'Lo pidió la clienta' });
  assert.equal(res.status, 200);

  const c = res.data;
  assert.equal(c.name, `Clienta anonimizada #${clientId}`);
  for (const f of ['email', 'phone', 'dueDate', 'notes', 'taxId', 'address', 'city']) {
    assert.equal(c[f], '', `${f} deberia quedar vacio`);
  }
  assert.ok(c.anonymizedAt, 'queda la marca de cuando se anonimizo');
  assert.equal(c.consentAt, '', 'el consentimiento ya no aplica');

  // Las notas de las citas tambien son datos de salud.
  const citas = (await a.get('/api/appointments')).data;
  assert.equal(citas.find((x) => x.clientId === clientId).notes, '');

  // Y la factura sigue ahi, con su copia fiscal intacta: Hacienda obliga a
  // conservarla y el RGPD lo admite como base legal.
  const facturas = (await a.get('/api/invoices')).data.rows;
  const factura = facturas.find((i) => i.number === invoiceNumber);
  assert.ok(factura, 'la factura no se borra');
  const detalle = (await a.get(`/api/invoices/${factura.id}`)).data;
  assert.equal(detalle.client.name, 'Lucía Fernández', 'el documento fiscal conserva su copia');
  assert.equal(detalle.client.taxId, '11223344A');
  assert.equal(detalle.totals.total, 280);
});

test('anonimizar no destruye los datos fiscales de una factura antigua', async () => {
  // Las facturas emitidas por versiones anteriores del CRM no tienen copia
  // fiscal: reconstruian los datos leyendo la ficha. Anonimizar sin cuidado
  // les borraba el nombre y el NIF.
  const db = await import('./db.js');
  const otra = (await a.post('/api/clients', { name: 'Antigua SL', taxId: '99887766X', city: 'Madrid' })).data;
  const borrador = (
    await a.post('/api/invoices', {
      clientId: otra.id,
      date: '2024-06-01',
      items: [{ description: 'Sesion', qty: 1, price: 100, vat: 0 }],
    })
  ).data;
  await a.post('/api/invoices/' + borrador.id + '/issue');
  // Simular una factura de antes: emitida pero sin copia fiscal.
  await db.run("UPDATE invoices SET clientSnapshot = '', issuerSnapshot = '' WHERE id = ?", [borrador.id]);

  await a.post('/api/clients/' + otra.id + '/anonymize', { reason: 'prueba' });

  const detalle = (await a.get('/api/invoices/' + borrador.id)).data;
  assert.equal(detalle.client.name, 'Antigua SL', 'la factura conserva a quien se le emitio');
  assert.equal(detalle.client.taxId, '99887766X');
  assert.ok(detalle.issuer.name, 'y quien la emitio');
});

test('anonimizar deja constancia en el registro', async () => {
  const res = await a.get('/api/audit?action=client_anonymize');
  const fila = res.data.rows.find((r) => r.entityId === String(clientId));
  assert.ok(fila);
  assert.equal(fila.detail, 'Lo pidió la clienta');
  assert.equal(fila.userEmail, 'admin@example.com');
});

test('no se anonimiza dos veces', async () => {
  assert.equal((await a.post(`/api/clients/${clientId}/anonymize`, {})).status, 409);
});

test('una ficha anonimizada ya no sale en conservacion', async () => {
  const res = await a.get('/api/clients/retention');
  assert.ok(!res.data.rows.some((r) => r.id === clientId));
});
