import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, makeClient } from './test-helpers.mjs';

const tmp = useTempDb(); // antes de importar app.js

const PW = 'contrasena-larga-1';

let srv;
let a;
let clientId;

before(async () => {
  srv = await startServer();
  a = srv.client;
  await a.post('/api/auth/setup', { email: 'admin@example.com', name: 'Admin', password: PW });
  await a.put('/api/settings/issuer', {
    name: 'Wita', taxId: 'B1', address: 'C/ Real 1', postalCode: '18001', city: 'Granada',
  });
  clientId = (
    await a.post('/api/clients', { name: 'Lucía Fernández; con punto y coma', dueDate: '2026-12-01' })
  ).data.id;
  const servicio = (await a.post('/api/services', { name: 'Hipnoparto', durationMin: 90 })).data.id;
  await a.post('/api/appointments', {
    clientId, serviceId: servicio, date: '2026-11-10 17:00', mode: 'Presencial (Granada)',
    notes: 'Sesión 1',
  });
  await a.post('/api/appointments', {
    clientId, serviceId: servicio, date: '2026-11-20 10:30', status: 'Cancelada',
  });
});
after(async () => {
  srv.close();
  await tmp.cleanup();
});

// ---- el enlace arranca apagado --------------------------------------------

test('el calendario no se publica hasta que se genera el enlace', async () => {
  const cfg = (await a.get('/api/settings')).data.calendar;
  assert.equal(cfg.feedToken, '', 'publicar datos personales tiene que ser una decision');

  // Y sin token, cualquier URL que se pruebe da 404.
  const anon = makeClient(srv.base);
  assert.equal((await anon.get('/api/calendar/loquesea.ics')).status, 404);
});

test('solo admin genera el enlace', async () => {
  await a.post('/api/users', { email: 'pro@example.com', name: 'Pro', role: 'pro', password: PW });
  const pro = makeClient(srv.base);
  await pro.post('/api/auth/login', { email: 'pro@example.com', password: PW });
  assert.equal((await pro.post('/api/settings/calendar/token', {})).status, 403);
});

// ---- el feed --------------------------------------------------------------

test('con enlace, el feed se sirve sin sesion', async () => {
  const cfg = (await a.post('/api/settings/calendar/token', {})).data;
  assert.match(cfg.feedToken, /^[A-Za-z0-9_-]{30,}$/, 'token largo y aleatorio');

  // Sin sesion: lo piden los servidores de Google, que no pueden entrar.
  const anon = makeClient(srv.base);
  const res = await anon.get(`/api/calendar/${cfg.feedToken}.ics`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/calendar; charset=utf-8');

  const ics = res.data;
  assert.match(ics, /^BEGIN:VCALENDAR/);
  assert.match(ics, /END:VCALENDAR\s*$/);
  assert.match(ics, /VERSION:2\.0/);
  assert.match(ics, /X-WR-TIMEZONE:Europe\/Madrid/);
  // Las lineas de un .ics acaban en CRLF.
  assert.ok(ics.includes('\r\n'), 'los finales de linea son CRLF');
});

test('la cita sale con su hora, su duracion y su sitio', async () => {
  const { feedToken } = (await a.get('/api/settings')).data.calendar;
  const ics = (await makeClient(srv.base).get(`/api/calendar/${feedToken}.ics`)).data;

  assert.match(ics, /DTSTART;TZID=Europe\/Madrid:20261110T170000/);
  // 90 minutos de servicio: de 17:00 a 18:30.
  assert.match(ics, /DTEND;TZID=Europe\/Madrid:20261110T183000/);
  assert.match(ics, /LOCATION:Presencial \(Granada\)/);
  assert.match(ics, /UID:cita-1@wita-crm/);
});

test('el punto y coma del nombre va escapado', async () => {
  // Sin escapar, un nombre con coma o punto y coma rompe el fichero entero.
  const { feedToken } = (await a.get('/api/settings')).data.calendar;
  const ics = (await makeClient(srv.base).get(`/api/calendar/${feedToken}.ics`)).data;
  assert.ok(ics.includes('Lucía Fernández\\; con punto y coma'), 'el ; tiene que ir con barra');
});

test('una cita cancelada no se publica', async () => {
  const { feedToken } = (await a.get('/api/settings')).data.calendar;
  const ics = (await makeClient(srv.base).get(`/api/calendar/${feedToken}.ics`)).data;
  assert.ok(!ics.includes('UID:cita-2@wita-crm'));
});

test('la fecha probable de parto sale como evento de un dia completo', async () => {
  const { feedToken } = (await a.get('/api/settings')).data.calendar;
  const ics = (await makeClient(srv.base).get(`/api/calendar/${feedToken}.ics`)).data;
  // FPP 2026-12-01: ese dia y nada mas. DTEND es exclusivo, asi que el 2.
  assert.match(ics, /DTSTART;VALUE=DATE:20261201/);
  assert.match(ics, /DTEND;VALUE=DATE:20261202/);
  assert.match(ics, /SUMMARY:Fecha probable de parto/);
  assert.ok(!/Guardia/.test(ics), 'ya no hay guardias');
});

// ---- privacidad -----------------------------------------------------------

test('se puede publicar sin los nombres de las clientas', async () => {
  await a.put('/api/settings/calendar', { includeClientNames: false });
  const { feedToken } = (await a.get('/api/settings')).data.calendar;
  const ics = (await makeClient(srv.base).get(`/api/calendar/${feedToken}.ics`)).data;

  assert.ok(!ics.includes('Lucía'), 'no deberia aparecer el nombre');
  assert.ok(!ics.includes('Sesión 1'), 'ni las notas, que son datos de salud');
  assert.match(ics, /SUMMARY:Cita/);

  await a.put('/api/settings/calendar', { includeClientNames: true });
});

test('revocar el enlace deja fuera a quien lo tuviera', async () => {
  const { feedToken } = (await a.get('/api/settings')).data.calendar;
  const anon = makeClient(srv.base);
  assert.equal((await anon.get(`/api/calendar/${feedToken}.ics`)).status, 200);

  await a.post('/api/settings/calendar/token', { revoke: true });
  assert.equal(
    (await anon.get(`/api/calendar/${feedToken}.ics`)).status,
    404,
    'la URL antigua tiene que dejar de valer al momento',
  );
});

test('un token que no es el bueno da 404', async () => {
  const nuevo = (await a.post('/api/settings/calendar/token', {})).data.feedToken;
  const anon = makeClient(srv.base);
  assert.equal((await anon.get(`/api/calendar/${nuevo}.ics`)).status, 200);
  assert.equal((await anon.get(`/api/calendar/${nuevo}x.ics`)).status, 404);
  assert.equal((await anon.get('/api/calendar/.ics')).status, 404);
});
