import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer } from './test-helpers.mjs';

const tmp = useTempDb(); // antes de importar app.js

const PW = 'contrasena-larga-1';

let srv;
let a; // administradora
let lactancia; // clienta de lactancia
let parto; // clienta de preparación al parto

before(async () => {
  srv = await startServer();
  a = srv.client;
  await a.post('/api/auth/setup', { email: 'admin@example.com', name: 'Admin', password: PW });

  lactancia = (
    await a.post('/api/clients', {
      name: 'Lucía Fernández',
      service: 'Lactancia',
      consentAt: '2026-02-01',
      consentChannel: 'Email',
    })
  ).data.id;

  parto = (
    await a.post('/api/clients', {
      name: 'Marta Ruiz',
      service: 'Hipnoparto / Preparación al parto',
      dueDate: '2026-12-01',
    })
  ).data.id;
});

after(async () => {
  srv.close();
  await tmp.cleanup();
});

test('un cuestionario sin rellenar se lee vacío y pendiente', async () => {
  const r = await a.get(`/api/clients/${lactancia}/form?kind=lactancia`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { kind: 'lactancia', data: {}, status: 'pendiente', updatedAt: '' });
});

test('se guarda a medias y sigue pendiente', async () => {
  const r = await a.put(`/api/clients/${lactancia}/form`, {
    kind: 'lactancia',
    data: { babyName: 'Leo', birthDate: '2026-09-20' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'pendiente');
  assert.equal(r.data.data.babyName, 'Leo');

  const leido = await a.get(`/api/clients/${lactancia}/form?kind=lactancia`);
  assert.equal(leido.data.data.birthDate, '2026-09-20');
  assert.ok(leido.data.updatedAt, 'tiene que quedar fecha de actualización');
});

test('con todas las obligatorias queda completo, y guardar otra vez no duplica', async () => {
  const completo = {
    babyName: 'Leo',
    birthDate: '2026-09-20',
    birthType: 'Cesárea de urgencia',
    gestWeeksAtBirth: '38',
    birthWeight: '3.450 kg',
    currentWeight: '4.100 kg',
    separation: 'Sí',
    painWhenFeeding: 'Sí',
    feedsPer24h: '10 tomas, 20 min',
    howDidYouHearAboutUs: 'Instagram',
  };
  const r = await a.put(`/api/clients/${lactancia}/form`, { kind: 'lactancia', data: completo });
  assert.equal(r.data.status, 'completo');

  const otra = await a.put(`/api/clients/${lactancia}/form`, { kind: 'lactancia', data: completo });
  assert.equal(otra.status, 200);
  const resumen = await a.get('/api/clients/forms');
  assert.equal(resumen.data[lactancia].length, 1, 'el único (clientId, kind) evita el duplicado');
});

test('la respuesta de "Otro" se guarda tal cual la escribió', async () => {
  const r = await a.put(`/api/clients/${lactancia}/form`, {
    kind: 'lactancia',
    data: { babyName: 'Leo', separation: 'Solo dos horas en observación' },
  });
  assert.equal(r.data.data.separation, 'Solo dos horas en observación');
});

test('las claves que no son preguntas del cuestionario se descartan', async () => {
  const r = await a.put(`/api/clients/${parto}/form`, {
    kind: 'parto',
    data: { birthNumber: 'Primero', gestWeeks: '32', status: 'completo', id: 99, inventado: 'x' },
  });
  assert.deepEqual(r.data.data, { birthNumber: 'Primero', gestWeeks: '32' });
  assert.equal(r.data.status, 'completo');
});

test('una clienta puede tener los dos cuestionarios', async () => {
  await a.put(`/api/clients/${parto}/form`, { kind: 'lactancia', data: { babyName: 'Nuevo' } });
  const resumen = await a.get('/api/clients/forms');
  const kinds = resumen.data[parto].map((f) => f.kind).sort();
  assert.deepEqual(kinds, ['lactancia', 'parto']);
});

test('un cuestionario que no existe es un 400', async () => {
  const r = await a.put(`/api/clients/${lactancia}/form`, { kind: 'reiki', data: {} });
  assert.equal(r.status, 400);
  const g = await a.get(`/api/clients/${lactancia}/form?kind=reiki`);
  assert.equal(g.status, 400);
});

test('una clienta que no existe es un 404', async () => {
  const r = await a.put('/api/clients/9999/form', { kind: 'parto', data: {} });
  assert.equal(r.status, 404);
  const g = await a.get('/api/clients/9999/form?kind=parto');
  assert.equal(g.status, 404);
});

test('el resumen trae el estado de cada clienta', async () => {
  const r = await a.get('/api/clients/forms');
  assert.equal(r.status, 200);
  const suyo = r.data[lactancia].find((f) => f.kind === 'lactancia');
  assert.equal(suyo.status, 'pendiente'); // la última escritura fue parcial
});

test('leer y guardar quedan en el registro de accesos', async () => {
  const r = await a.get('/api/audit?entity=client_forms');
  const acciones = new Set(r.data.rows.map((x) => x.action));
  assert.ok(acciones.has('client_form_view'));
  assert.ok(acciones.has('client_form_update'));
  assert.ok(acciones.has('client_form_list'));
});
