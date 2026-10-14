import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, makeClient } from './test-helpers.mjs';

const tmp = useTempDb(); // antes de importar app.js
const { invoiceTotals, formatNumber } = await import('./invoices.js');

const PW = 'contrasena-larga-1';

let srv;
let a; // administradora
let clientId;

before(async () => {
  srv = await startServer();
  a = srv.client;
  await a.post('/api/auth/setup', { email: 'admin@example.com', name: 'Admin', password: PW });
  await a.put('/api/settings/issuer', {
    name: 'Wita Maternidad SL',
    taxId: 'B12345678',
    address: 'Calle Real 1',
    postalCode: '18001',
    city: 'Granada',
    province: 'Granada',
  });
  clientId = (
    await a.post('/api/clients', {
      name: 'Lucía Fernández',
      email: 'lucia@example.com',
      taxId: '12345678Z',
      address: 'Calle Falsa 2',
      postalCode: '18002',
      city: 'Granada',
    })
  ).data.id;
});
after(async () => {
  srv.close();
  await tmp.cleanup();
});

const draft = async (over = {}) =>
  (
    await a.post('/api/invoices', {
      clientId,
      date: '2026-03-10',
      items: [{ description: 'Hipnoparto', qty: 1, price: 280, vat: 0, discount: 0 }],
      ...over,
    })
  ).data;

// ---- cálculo -------------------------------------------------------------

test('totales con descuento, IVA e IRPF', () => {
  const items = [
    { qty: 2, price: 100, vat: 21, discount: 10 }, // base 180, IVA 37,80
    { qty: 1, price: 50, vat: 0, discount: 0 }, // base 50
  ];
  const t = invoiceTotals(items, 15);
  assert.equal(t.base, 230);
  assert.equal(t.vat, 37.8);
  assert.equal(t.irpf, 34.5); // 15% de 230
  assert.equal(t.total, 233.3); // 230 + 37,80 - 34,50
});

test('sin IRPF el total es base mas IVA', () => {
  assert.deepEqual(invoiceTotals([{ qty: 1, price: 100, vat: 21 }]), {
    base: 100,
    vat: 21,
    irpf: 0,
    total: 121,
  });
});

test('formato del numero', () => {
  assert.equal(formatNumber('', 2026, 3), '2026-0003');
  assert.equal(formatNumber('R', 2026, 12), 'R2026-0012');
});

// ---- borrador ------------------------------------------------------------

test('una factura nace como borrador y sin numero', async () => {
  const inv = await draft();
  assert.equal(inv.status, 'Borrador');
  assert.equal(inv.number, '');
  assert.equal(inv.locked, false);
  assert.equal(inv.totals.total, 280);
});

test('el borrador se edita entero', async () => {
  const inv = await draft();
  const res = await a.put(`/api/invoices/${inv.id}`, {
    date: '2026-03-15',
    notes: 'Cambiado',
    items: [{ description: 'Otra cosa', qty: 3, price: 20, vat: 10, discount: 50 }],
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.date, '2026-03-15');
  assert.equal(res.data.notes, 'Cambiado');
  assert.equal(res.data.totals.base, 30); // 3 * 20 con 50% de descuento
  assert.equal(res.data.totals.vat, 3);
});

test('el borrador se borra', async () => {
  const inv = await draft();
  assert.equal((await a.del(`/api/invoices/${inv.id}`)).status, 204);
  assert.equal((await a.get(`/api/invoices/${inv.id}`)).status, 404);
});

// ---- emisión -------------------------------------------------------------

test('emitir asigna numero correlativo y congela los datos fiscales', async () => {
  const uno = await draft();
  const res = await a.post(`/api/invoices/${uno.id}/issue`);
  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'Emitida');
  assert.equal(res.data.number, '2026-0001');
  assert.equal(res.data.locked, true);
  assert.ok(res.data.issuedAt, 'queda la marca de cuando se emitio');
  assert.equal(res.data.client.taxId, '12345678Z');
  assert.equal(res.data.issuer.taxId, 'B12345678');
  assert.match(res.data.hash, /^[0-9a-f]{64}$/, 'queda el hash del encadenado');

  const dos = await a.post(`/api/invoices/${(await draft()).id}/issue`);
  assert.equal(dos.data.number, '2026-0002', 'el correlativo sigue');
  assert.equal(dos.data.hashPrev, res.data.hash, 'enlazada con la anterior');
});

test('el correlativo reinicia cada ano', async () => {
  const inv = await draft({ date: '2027-01-04' });
  const res = await a.post(`/api/invoices/${inv.id}/issue`);
  assert.equal(res.data.number, '2027-0001');
});

test('la copia fiscal no cambia aunque cambie la ficha de la clienta', async () => {
  const inv = (await a.post(`/api/invoices/${(await draft()).id}/issue`)).data;

  await a.put(`/api/clients/${clientId}`, { address: 'Calle Nueva 99', city: 'Sevilla' });

  const despues = (await a.get(`/api/invoices/${inv.id}`)).data;
  assert.equal(despues.client.address, 'Calle Falsa 2', 'la factura emitida conserva la direccion de entonces');
  assert.equal(despues.client.city, 'Granada');

  // Y la ficha si refleja el cambio.
  assert.equal((await a.get(`/api/clients/${clientId}`)).data.city, 'Sevilla');
  await a.put(`/api/clients/${clientId}`, { address: 'Calle Falsa 2', city: 'Granada' });
});

test('no se emite sin lineas, sin clienta o sin NIF de la clienta', async () => {
  const vacia = await draft({ items: [] });
  assert.match((await a.post(`/api/invoices/${vacia.id}/issue`)).data.error, /ninguna línea/);

  const sinClienta = await draft({ clientId: null });
  assert.match((await a.post(`/api/invoices/${sinClienta.id}/issue`)).data.error, /necesita una clienta/);

  const otra = (await a.post('/api/clients', { name: 'Sin NIF' })).data;
  const sinNif = await draft({ clientId: otra.id });
  assert.match((await a.post(`/api/invoices/${sinNif.id}/issue`)).data.error, /Falta el NIF/);
});

// ---- inmutabilidad -------------------------------------------------------

test('una factura emitida no se edita ni se borra', async () => {
  const inv = (await a.post(`/api/invoices/${(await draft()).id}/issue`)).data;

  const edit = await a.put(`/api/invoices/${inv.id}`, { notes: 'intento colar esto' });
  assert.equal(edit.status, 409);
  assert.match(edit.data.error, /rectificativa/);

  const del = await a.del(`/api/invoices/${inv.id}`);
  assert.equal(del.status, 409);

  const sigue = (await a.get(`/api/invoices/${inv.id}`)).data;
  assert.equal(sigue.notes, '', 'no se colo nada');
  assert.equal(sigue.number, inv.number);
});

test('emitir dos veces la misma factura falla', async () => {
  const inv = (await a.post(`/api/invoices/${(await draft()).id}/issue`)).data;
  assert.equal((await a.post(`/api/invoices/${inv.id}/issue`)).status, 409);
});

// ---- estado de cobro -----------------------------------------------------

test('el estado de cobro si se puede mover', async () => {
  const inv = (await a.post(`/api/invoices/${(await draft()).id}/issue`)).data;
  const enviada = await a.post(`/api/invoices/${inv.id}/status`, { status: 'Enviada' });
  assert.equal(enviada.data.status, 'Enviada');

  const pagada = await a.post(`/api/invoices/${inv.id}/status`, { status: 'Pagada', paidAt: '2026-04-01' });
  assert.equal(pagada.data.status, 'Pagada');
  assert.equal(pagada.data.paidAt, '2026-04-01');

  // Pero no a un estado que no es de cobro.
  assert.equal((await a.post(`/api/invoices/${inv.id}/status`, { status: 'Borrador' })).status, 409);
});

// ---- rectificativa -------------------------------------------------------

test('rectificar enlaza las dos facturas y marca la original', async () => {
  const original = (await a.post(`/api/invoices/${(await draft()).id}/issue`)).data;

  assert.equal(
    (await a.post(`/api/invoices/${original.id}/rectify`, {})).status,
    400,
    'el motivo es obligatorio',
  );

  const rect = await a.post(`/api/invoices/${original.id}/rectify`, { reason: 'Importe equivocado' });
  assert.equal(rect.status, 201);
  assert.equal(rect.data.status, 'Borrador', 'nace como borrador, para poder corregirla');
  assert.equal(rect.data.series, 'R');
  assert.equal(rect.data.rectifiesId, original.id);
  assert.equal(rect.data.items.length, original.items.length, 'copia las lineas de la original');

  // Mientras la rectificativa sea borrador, la original sigue igual.
  assert.equal((await a.get(`/api/invoices/${original.id}`)).data.status, 'Emitida');

  const emitida = await a.post(`/api/invoices/${rect.data.id}/issue`);
  assert.match(emitida.data.number, /^R\d{4}-\d{4}$/);

  const despues = (await a.get(`/api/invoices/${original.id}`)).data;
  assert.equal(despues.status, 'Rectificada');
  assert.equal(despues.rectifiedBy.id, rect.data.id, 'la original apunta a su rectificativa');

  // Un borrador no se rectifica: todavia no es una factura.
  const b = await draft();
  assert.equal((await a.post(`/api/invoices/${b.id}/rectify`, { reason: 'x' })).status, 409);
});

// ---- anulación -----------------------------------------------------------

test('anular necesita admin y motivo, y no borra la factura', async () => {
  const inv = (await a.post(`/api/invoices/${(await draft()).id}/issue`)).data;

  assert.equal((await a.post(`/api/invoices/${inv.id}/void`, {})).status, 400, 'el motivo es obligatorio');

  await a.post('/api/users', { email: 'pro@example.com', name: 'Pro', role: 'pro', password: PW });
  const pro = makeClient(srv.base);
  await pro.post('/api/auth/login', { email: 'pro@example.com', password: PW });
  assert.equal((await pro.post(`/api/invoices/${inv.id}/void`, { reason: 'x' })).status, 403);

  const res = await a.post(`/api/invoices/${inv.id}/void`, { reason: 'Duplicada' });
  assert.equal(res.data.status, 'Anulada');
  assert.equal((await a.get(`/api/invoices/${inv.id}`)).data.number, inv.number, 'la factura sigue ahi');
});

// ---- listado, filtros y paginación ---------------------------------------

test('el listado filtra por ano, mes y estado, y pagina', async () => {
  const todo = await a.get('/api/invoices');
  assert.ok(Array.isArray(todo.data.rows));
  assert.ok(todo.data.years.includes('2026') && todo.data.years.includes('2027'));

  const de2027 = await a.get('/api/invoices?year=2027');
  assert.ok(de2027.data.rows.length > 0);
  assert.ok(
    de2027.data.rows.every((r) => r.date.startsWith('2027')),
    'solo facturas de 2027',
  );

  const marzo = await a.get('/api/invoices?year=2026&month=03');
  assert.ok(marzo.data.rows.every((r) => r.date.slice(0, 7) === '2026-03'));

  const pagadas = await a.get('/api/invoices?status=Pagada');
  assert.ok(pagadas.data.rows.every((r) => r.status === 'Pagada'));

  const pendientes = await a.get('/api/invoices?status=pendientes');
  assert.ok(
    pendientes.data.rows.every((r) => !['Pagada', 'Anulada', 'Rectificada'].includes(r.status)),
    'pendientes excluye cobradas, anuladas y rectificadas',
  );

  const pag = await a.get('/api/invoices?pageSize=2&page=1');
  assert.equal(pag.data.rows.length, 2);
  assert.equal(pag.data.total, todo.data.total, 'el total es el de todas, no el de la pagina');
  const pag2 = await a.get('/api/invoices?pageSize=2&page=2');
  assert.notEqual(pag.data.rows[0].id, pag2.data.rows[0].id);
});

test('los totales del listado coinciden con los del detalle', async () => {
  const inv = await draft({ items: [{ description: 'X', qty: 2, price: 100, vat: 21, discount: 10 }] });
  await a.put(`/api/invoices/${inv.id}`, { irpfRate: 15 });
  const detalle = (await a.get(`/api/invoices/${inv.id}`)).data;
  const fila = (await a.get('/api/invoices')).data.rows.find((r) => r.id === inv.id);
  assert.deepEqual(fila.totals, detalle.totals);
});

// ---- integridad ----------------------------------------------------------

test('una clienta con facturas no se borra', async () => {
  const res = await a.del(`/api/clients/${clientId}`);
  assert.equal(res.status, 409);
  assert.match(res.data.error, /conservar/);
  assert.equal((await a.get(`/api/clients/${clientId}`)).status, 200);
});

// ---- PDF -----------------------------------------------------------------

test('el PDF se genera en el servidor', async () => {
  const inv = (await a.post(`/api/invoices/${(await draft()).id}/issue`)).data;
  const res = await fetch(`${srv.base}/api/invoices/${inv.id}/pdf`, {
    headers: { cookie: 'placeholder' },
  });
  assert.equal(res.status, 401, 'tambien el PDF exige sesion');

  const { invoicePdf } = await import('./invoice-pdf.js');
  const detalle = (await a.get(`/api/invoices/${inv.id}`)).data;
  const buf = await invoicePdf(detalle);
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buf.length > 1000, 'el PDF tiene contenido');
});

// ---- email ---------------------------------------------------------------

test('no se envia por email una factura sin emitir', async () => {
  const b = await draft();
  const res = await a.post(`/api/invoices/${b.id}/email`);
  assert.equal(res.status, 409);
  assert.match(res.data.error, /Emite la factura/);
});

// ---- ajustes -------------------------------------------------------------

test('solo admin cambia los ajustes', async () => {
  const pro = makeClient(srv.base);
  await pro.post('/api/auth/login', { email: 'pro@example.com', password: PW });
  assert.equal((await pro.get('/api/settings')).status, 200, 'leerlos si puede');
  assert.equal((await pro.put('/api/settings/issuer', { name: 'Otra' })).status, 403);

  assert.equal((await a.put('/api/settings/inventado', { x: 1 })).status, 404);
  // Las claves que no existen en el ajuste se ignoran.
  const res = await a.put('/api/settings/invoicing', { vatRate: 21, hackeado: 'si' });
  assert.equal(res.data.vatRate, 21);
  assert.equal(res.data.hackeado, undefined);
});
