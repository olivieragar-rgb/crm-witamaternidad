import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer } from './test-helpers.mjs';

const tmp = useTempDb(); // antes de importar app.js

const PW = 'contrasena-larga-1';
let srv;
let a;
let clientId;

before(async () => {
  srv = await startServer();
  a = srv.client;
  await a.post('/api/auth/setup', { email: 'admin@example.com', name: 'Admin', password: PW });
  await a.put('/api/settings/issuer', { name: 'Doula Marina SL', taxId: 'B12345678', address: 'Calle Real 1', postalCode: '18001', city: 'Granada', province: 'Granada' });
  clientId = (await a.post('/api/clients', { name: 'Lucía Fernández', taxId: '12345678Z', address: 'Calle Falsa 2', postalCode: '18002', city: 'Granada', babySex: 'girl', babyBirthDate: '2026-09-01' })).data.id;
});
after(async () => {
  srv.close();
  await tmp.cleanup();
});

test('la ficha guarda el sexo y la fecha de nacimiento del bebé', async () => {
  const c = (await a.get(`/api/clients/${clientId}`)).data;
  assert.equal(c.babySex, 'girl');
  assert.equal(c.babyBirthDate, '2026-09-01');
});

test('notas: se añaden, se listan (la última primero), se editan y se borran, con rastro', async () => {
  assert.equal((await a.post(`/api/clients/${clientId}/notes`, { text: '   ' })).status, 400);
  const n1 = (await a.post(`/api/clients/${clientId}/notes`, { text: 'Primera visita' })).data;
  const n2 = (await a.post(`/api/clients/${clientId}/notes`, { text: 'Lactancia bien' })).data;
  assert.equal(n1.author, 'Admin');
  const list = (await a.get(`/api/clients/${clientId}/notes`)).data;
  assert.deepEqual(list.map((n) => n.text), ['Lactancia bien', 'Primera visita']);
  const ed = await a.put(`/api/clients/${clientId}/notes/${n1.id}`, { text: 'Primera visita (editada)' });
  assert.equal(ed.status, 200);
  assert.ok(ed.data.updatedAt);
  assert.equal((await a.del(`/api/clients/${clientId}/notes/${n2.id}`)).status, 204);
  assert.equal((await a.get(`/api/clients/${clientId}/notes`)).data.length, 1);
  assert.equal((await a.get('/api/clients/99999/notes')).status, 404);
  const log = (await a.get('/api/audit?action=client_note_add')).data;
  assert.ok(log.rows.some((r) => r.entityId === String(clientId)));
});

test('el peso del bebé se guarda en la visita y no se pierde al editar la cita', async () => {
  const v = (
    await a.post('/api/appointments', { clientId, date: '2026-09-15 10:00', status: 'Realizada', babyWeightKg: 3.45 })
  ).data;
  assert.equal(v.babyWeightKg, 3.45);
  const ed = (await a.put(`/api/appointments/${v.id}`, { notes: 'Todo bien' })).data;
  assert.equal(ed.babyWeightKg, 3.45, 'editar otro campo no borra el peso');
  const upd = (await a.put(`/api/appointments/${v.id}`, { babyWeightKg: 3.9 })).data;
  assert.equal(upd.babyWeightKg, 3.9);
});

test('anonimizar borra las notas, los pesos y los datos del bebé', async () => {
  const id = (await a.post('/api/clients', { name: 'Para anonimizar', babySex: 'boy', babyBirthDate: '2026-01-01' })).data.id;
  await a.post(`/api/clients/${id}/notes`, { text: 'dato de salud' });
  const v = (await a.post('/api/appointments', { clientId: id, date: '2026-02-01 10:00', babyWeightKg: 4.2 })).data;
  const res = await a.post(`/api/clients/${id}/anonymize`, {});
  assert.equal(res.status, 200);
  assert.equal(res.data.babySex, '');
  assert.equal(res.data.babyBirthDate, '');
  assert.equal((await a.get(`/api/clients/${id}/notes`)).data.length, 0);
  assert.equal((await a.get(`/api/appointments/${v.id}`)).data.babyWeightKg, 0);
});

test('borrar una ficha se lleva sus notas', async () => {
  const id = (await a.post('/api/clients', { name: 'Se borra' })).data.id;
  await a.post(`/api/clients/${id}/notes`, { text: 'x' });
  assert.equal((await a.del(`/api/clients/${id}`)).status, 204);
  const { get } = await import('./db.js');
  assert.ok(!(await get('SELECT 1 FROM client_notes WHERE clientId = ?', [id])));
});

test('al marcar una factura como pagada se anota la forma de pago', async () => {
  const inv = (
    await a.post('/api/invoices', {
      clientId,
      date: '2026-03-10',
      items: [{ description: 'Hipnoparto', qty: 1, price: 280, vat: 0, discount: 0 }],
    })
  ).data;
  const issued = await a.post(`/api/invoices/${inv.id}/issue`);
  assert.equal(issued.status, 200, JSON.stringify(issued.data));
  const paid = await a.post(`/api/invoices/${inv.id}/status`, { status: 'Pagada', paymentMethod: 'Bizum' });
  assert.equal(paid.status, 200);
  assert.equal(paid.data.paymentMethod, 'Bizum');
  assert.equal(paid.data.status, 'Pagada');
  const back = await a.post(`/api/invoices/${inv.id}/status`, { status: 'Emitida' });
  assert.equal(back.data.paymentMethod, 'Bizum', 'sin forma nueva, se conserva');
});

test('un gasto se descarga como PDF', async () => {
  const e = (
    await a.post('/api/expenses', { date: '2026-05-02', description: 'Material', supplier: 'Papelería Sol', supplierTaxId: 'B999', base: 100, vatRate: 21 })
  ).data;
  const res = await fetch(`${srv.base}/api/expenses/${e.id}/pdf`, { headers: { cookie: a.cookie() } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/pdf/);
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  const nf = await fetch(`${srv.base}/api/expenses/99999/pdf`, { headers: { cookie: a.cookie() } });
  assert.equal(nf.status, 404);
});

test('un gasto guarda su forma de pago y se puede buscar por ella', async () => {
  const e = (await a.post('/api/expenses', { description: 'Cuota web', base: 20, vatRate: 21, paymentMethod: 'Tarjeta' })).data;
  assert.equal(e.paymentMethod, 'Tarjeta');
  const upd = (await a.put(`/api/expenses/${e.id}`, { paymentMethod: 'Transferencia' })).data;
  assert.equal(upd.paymentMethod, 'Transferencia');
  const found = (await a.get('/api/expenses?q=Transferencia')).data.rows;
  assert.ok(found.some((r) => r.id === e.id));
});

test('secciones de la ficha: se guardan por separado, se validan y salen en el export', async () => {
  const id = (await a.post('/api/clients', { name: 'Elena Mora' })).data.id;
  assert.deepEqual((await a.get(`/api/clients/${id}/sections`)).data, {});
  assert.equal((await a.put(`/api/clients/${id}/sections/inventada`, { data: { x: 'y' } })).status, 404);

  const s1 = await a.put(`/api/clients/${id}/sections/salud`, { data: { alergias: ' Penicilina ', campoFalso: 'no' } });
  assert.equal(s1.status, 200);
  assert.deepEqual(s1.data.data, { alergias: 'Penicilina' }, 'solo campos conocidos y recortados');
  assert.equal(s1.data.updatedBy, 'Admin');
  await a.put(`/api/clients/${id}/sections/lactancia`, { data: { tipo: 'Mixta' } });

  const all = (await a.get(`/api/clients/${id}/sections`)).data;
  assert.deepEqual(Object.keys(all).sort(), ['lactancia', 'salud']);

  const exp = (await a.get(`/api/clients/${id}/export`)).data;
  assert.ok(exp.secciones.some((s) => s.seccion === 'Salud y antecedentes' && s.respuestas.Alergias === 'Penicilina'));

  // Vaciar una sección la quita.
  await a.put(`/api/clients/${id}/sections/salud`, { data: {} });
  assert.deepEqual(Object.keys((await a.get(`/api/clients/${id}/sections`)).data), ['lactancia']);

  // Anonimizar se las lleva.
  await a.post(`/api/clients/${id}/anonymize`, {});
  assert.deepEqual((await a.get(`/api/clients/${id}/sections`)).data, {});
  assert.equal((await a.put(`/api/clients/${id}/sections/salud`, { data: { alergias: 'x' } })).status, 409);
});
