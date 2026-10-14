import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer } from './test-helpers.mjs';

const tmp = useTempDb(); // antes de importar app.js
const { fill, addDays, daysBetween } = await import('./reminders.js');

const PW = 'contrasena-larga-1';
const hoy = () => new Date().toISOString().slice(0, 10);
const dias = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

let srv;
let a;
let clientId;
let db;

before(async () => {
  srv = await startServer();
  a = srv.client;
  db = await import('./db.js');
  await a.post('/api/auth/setup', { email: 'admin@example.com', name: 'Admin', password: PW });
  await a.put('/api/settings/issuer', { name: 'Wita', taxId: 'B1', address: 'C/1', city: 'Granada' });
  clientId = (
    await a.post('/api/clients', { name: 'Lucía', email: 'lucia@example.com', taxId: '11223344A' })
  ).data.id;
});
after(async () => {
  srv.close();
  await tmp.cleanup();
});

async function emitir({ date, dueDate = '', price = 100 }) {
  const draft = (
    await a.post('/api/invoices', {
      clientId,
      date,
      dueDate,
      items: [{ description: 'Sesión', qty: 1, price, vat: 0 }],
    })
  ).data;
  return (await a.post(`/api/invoices/${draft.id}/issue`)).data;
}

// ---- plantillas ----------------------------------------------------------

test('fill sustituye los marcadores y deja vacios los que no conoce', () => {
  assert.equal(fill('Hola {{clienta}}, son {{total}}', { clienta: 'Ana', total: '60 €' }), 'Hola Ana, son 60 €');
  assert.equal(fill('{{inventado}} fin', {}), ' fin');
  assert.equal(fill('', {}), '');
  assert.equal(fill(null, {}), '');
  // Sin marcadores, el texto se queda igual.
  assert.equal(fill('texto normal', { x: 1 }), 'texto normal');
});

test('addDays y daysBetween', () => {
  assert.equal(addDays('2026-03-28', 3), '2026-03-31', 'el cambio de hora no desplaza');
  assert.equal(addDays('', 3), null);
  assert.equal(daysBetween('2026-03-01', '2026-03-11'), 10);
});

// ---- qué está vencido ----------------------------------------------------

test('una factura con vencimiento pasado sale como vencida', async () => {
  const inv = await emitir({ date: dias(-40), dueDate: dias(-10), price: 250 });
  const r = (await a.get('/api/reminders')).data;
  const fila = r.overdue.find((o) => o.id === inv.id);
  assert.ok(fila, 'deberia estar entre las vencidas');
  assert.equal(fila.limit, dias(-10));
  assert.equal(fila.daysLate, 10);
  assert.equal(fila.total, 250);
  assert.equal(fila.clientEmail, 'lucia@example.com');
});

test('sin vencimiento se usan los dias de cortesia', async () => {
  // Cortesia de 15 dias: una factura de hace 20 esta vencida, una de hace 5 no.
  const vieja = await emitir({ date: dias(-20) });
  const reciente = await emitir({ date: dias(-5) });

  const r = (await a.get('/api/reminders')).data;
  assert.equal(r.config.graceDays, 15);
  assert.ok(r.overdue.some((o) => o.id === vieja.id), 'la de hace 20 dias ya vencio');
  assert.ok(!r.overdue.some((o) => o.id === reciente.id), 'la de hace 5 todavia no');

  // Si se bajan los dias de cortesia, la reciente pasa a estar vencida.
  await a.put('/api/settings/reminders', { graceDays: 1 });
  const r2 = (await a.get('/api/reminders')).data;
  assert.ok(r2.overdue.some((o) => o.id === reciente.id));
  await a.put('/api/settings/reminders', { graceDays: 15 });
});

test('una factura pagada deja de estar vencida', async () => {
  const inv = await emitir({ date: dias(-40), dueDate: dias(-30) });
  assert.ok((await a.get('/api/reminders')).data.overdue.some((o) => o.id === inv.id));

  await a.post(`/api/invoices/${inv.id}/status`, { status: 'Pagada' });
  assert.ok(!(await a.get('/api/reminders')).data.overdue.some((o) => o.id === inv.id));
});

test('un borrador no vence nunca', async () => {
  const draft = (
    await a.post('/api/invoices', {
      clientId,
      date: dias(-200),
      items: [{ description: 'x', qty: 1, price: 50, vat: 0 }],
    })
  ).data;
  assert.ok(!(await a.get('/api/reminders')).data.overdue.some((o) => o.id === draft.id));
});

// ---- citas próximas ------------------------------------------------------

test('las citas de los proximos dias salen, las lejanas no', async () => {
  const service = (await a.post('/api/services', { name: 'Hipnoparto' })).data.id;
  const manana = (
    await a.post('/api/appointments', { clientId, serviceId: service, date: `${dias(1)} 17:00`, mode: 'Online' })
  ).data;
  const lejana = (
    await a.post('/api/appointments', { clientId, serviceId: service, date: `${dias(30)} 17:00` })
  ).data;
  const pasada = (
    await a.post('/api/appointments', { clientId, serviceId: service, date: `${dias(-3)} 17:00` })
  ).data;

  const r = (await a.get('/api/reminders')).data;
  const ids = r.appointments.map((x) => x.id);
  assert.ok(ids.includes(manana.id), 'la de manana si');
  assert.ok(!ids.includes(lejana.id), 'la de dentro de un mes no');
  assert.ok(!ids.includes(pasada.id), 'una pasada tampoco');
});

test('una cita ya realizada no se recuerda', async () => {
  const service = (await a.post('/api/services', { name: 'Lactancia' })).data.id;
  const cita = (
    await a.post('/api/appointments', {
      clientId, serviceId: service, date: `${dias(1)} 10:00`, status: 'Realizada',
    })
  ).data;
  const r = (await a.get('/api/reminders')).data;
  assert.ok(!r.appointments.some((x) => x.id === cita.id));
});

// ---- vista previa --------------------------------------------------------

test('la vista previa muestra el texto ya sustituido', async () => {
  const inv = await emitir({ date: dias(-40), dueDate: dias(-20), price: 60 });
  const p = (await a.get(`/api/reminders/preview/invoice/${inv.id}`)).data;
  assert.equal(p.to, 'lucia@example.com');
  assert.match(p.subject, new RegExp(inv.number));
  assert.match(p.body, /Lucía/);
  assert.match(p.body, /60\.00 €/);
  assert.ok(!p.body.includes('{{'), 'no deberia quedar ningun marcador sin sustituir');

  const service = (await a.post('/api/services', { name: 'Sesión online' })).data.id;
  const cita = (
    await a.post('/api/appointments', {
      clientId, serviceId: service, date: `${dias(1)} 18:30`, mode: 'Online',
    })
  ).data;
  const pc = (await a.get(`/api/reminders/preview/appointment/${cita.id}`)).data;
  assert.match(pc.body, /18:30/);
  assert.match(pc.body, /Sesión online/);
  assert.match(pc.body, /Online/);
  assert.ok(!pc.body.includes('{{'));
});

test('la plantilla se puede cambiar desde Ajustes', async () => {
  await a.put('/api/settings/reminders', { invoiceSubject: 'Oye {{clienta}}, la {{numero}}' });
  const inv = await emitir({ date: dias(-40), dueDate: dias(-20) });
  const p = (await a.get(`/api/reminders/preview/invoice/${inv.id}`)).data;
  assert.match(p.subject, /^Oye Lucía, la /);
  await a.put('/api/settings/reminders', { invoiceSubject: 'Recordatorio de la factura {{numero}}' });
});

// ---- envío ---------------------------------------------------------------

test('no se recuerda una factura ya cobrada ni una inexistente', async () => {
  const inv = await emitir({ date: dias(-40), dueDate: dias(-20) });
  await a.post(`/api/invoices/${inv.id}/status`, { status: 'Pagada' });
  const res = await a.post(`/api/reminders/invoice/${inv.id}`);
  assert.equal(res.status, 409);
  assert.match(res.data.error, /no está pendiente/);

  assert.equal((await a.post('/api/reminders/invoice/99999')).status, 404);
});

test('sin email en la ficha no se puede recordar', async () => {
  const sinEmail = (await a.post('/api/clients', { name: 'Sin email', taxId: '99887766X' })).data;
  const draft = (
    await a.post('/api/invoices', {
      clientId: sinEmail.id, date: dias(-40),
      items: [{ description: 'x', qty: 1, price: 10, vat: 0 }],
    })
  ).data;
  const inv = (await a.post(`/api/invoices/${draft.id}/issue`)).data;
  const res = await a.post(`/api/reminders/invoice/${inv.id}`);
  assert.equal(res.status, 400);
  assert.match(res.data.error, /no tiene email/);
});

test('el envio solo falla por falta de configuracion de correo', async () => {
  // Sin GMAIL_USER no se envia nada, pero el error distingue ese caso de un
  // fallo real, y hasta ahi todas las comprobaciones han pasado.
  const inv = await emitir({ date: dias(-40), dueDate: dias(-20) });
  const res = await a.post(`/api/reminders/invoice/${inv.id}`);
  assert.equal(res.status, 400);
  assert.match(res.data.error, /Email no configurado/);
  // Y no marca como recordada una factura que no se ha llegado a enviar.
  const fila = await db.get('SELECT remindedAt FROM invoices WHERE id = ?', [inv.id]);
  assert.equal(fila.remindedAt, '');
});

test('el inicio cuenta las facturas vencidas', async () => {
  const d = (await a.get('/api/dashboard')).data;
  assert.ok(typeof d.overdueInvoices === 'number');
  const r = (await a.get('/api/reminders')).data;
  assert.equal(d.overdueInvoices, r.overdue.length, 'el contador y la lista tienen que coincidir');
});

test('los recordatorios exigen sesion', async () => {
  const { makeClient } = await import('./test-helpers.mjs');
  const anon = makeClient(srv.base);
  assert.equal((await anon.get('/api/reminders')).status, 401);
  assert.equal((await anon.post('/api/reminders/invoice/1')).status, 401);
});
