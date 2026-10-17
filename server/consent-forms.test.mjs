import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, makeClient } from './test-helpers.mjs';

const tmp = useTempDb(); // antes de importar app.js

const PW = 'contrasena-larga-1';
let srv;
let a; // administradora
let lucia; // id de la clienta
const CONSENT = 'Autorizo el tratamiento de mis datos de salud para recibir acompañamiento.';

before(async () => {
  srv = await startServer();
  a = srv.client;
  await a.post('/api/auth/setup', { email: 'admin@example.com', name: 'Admin', password: PW });
  await a.put('/api/settings/issuer', {
    name: 'Doula Marina SL',
    taxId: 'B12345678',
    address: 'Calle Real 1',
    postalCode: '18001',
    city: 'Granada',
    province: 'Granada',
    email: 'hola@marina.example',
    phone: '600111222',
  });
  lucia = (
    await a.post('/api/clients', { name: 'Lucía Fernández', email: 'lucia@example.com', phone: '611222333', taxId: '12345678Z' })
  ).data.id;
});
after(async () => {
  srv.close();
  await tmp.cleanup();
});

/** Texto de un PDF de pdfkit, con los saltos de línea y los espacios aplanados. */
async function textoDelPdf(buf) {
  const { inflateSync } = await import('node:zlib');
  const dec = new TextDecoder('windows-1252');
  const raw = buf.toString('latin1');
  const out = [];
  let i = 0;
  while ((i = raw.indexOf('stream', i)) !== -1) {
    let s = i + 6;
    if (raw[s] === '\r') s++;
    if (raw[s] === '\n') s++;
    const e = raw.indexOf('endstream', s);
    if (e === -1) break;
    try {
      const t = inflateSync(Buffer.from(raw.slice(s, e), 'latin1')).toString('latin1');
      for (const m of t.matchAll(/\[((?:<[0-9a-fA-F]*>|[\s\d.-])*)\]\s*TJ/g)) {
        const bytes = Buffer.concat([...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex')));
        out.push(dec.decode(bytes));
      }
    } catch {
      /* no todos los flujos son texto */
    }
    i = e + 9;
  }
  return out.join(' ').replace(/\s+/g, ' ');
}

async function pdf(path, cli = a) {
  const res = await fetch(srv.base + path, { headers: { cookie: cli.cookie() } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, buf, text: res.status === 200 ? await textoDelPdf(buf) : '' };
}

// ---- los PDF -------------------------------------------------------------

test('los tres formularios se generan en PDF', async () => {
  for (const kind of ['consentimiento', 'revocacion', 'derechos']) {
    const { res, buf } = await pdf(`/api/consent-forms/${kind}`);
    assert.equal(res.status, 200, kind);
    assert.match(res.headers.get('content-type'), /application\/pdf/);
    assert.equal(buf.subarray(0, 4).toString(), '%PDF', kind);
  }
});

test('el consentimiento lleva al responsable, la información y las tres autorizaciones', async () => {
  const { text } = await pdf('/api/consent-forms/consentimiento');
  assert.match(text, /Consentimiento para el tratamiento de datos personales y de salud/);
  assert.match(text, /Doula Marina SL/);
  assert.match(text, /B12345678/);
  assert.match(text, /hola@marina\.example/);
  for (const frag of ['Quién trata tus datos', 'Tus derechos', 'Agencia Española de Protección de Datos', 'Art. 9.2.a']) {
    assert.ok(text.includes(frag), `falta: ${frag}`);
  }
  assert.match(text, /datos de salud de mi hijo\/a/);
  assert.match(text, /recordatorios de mis citas/);
  assert.match(text, /Firma de la clienta/);
});

test('la autorización es el texto de consentimiento de Ajustes, y el pie lleva su versión', async () => {
  await a.put('/api/settings/privacy', { consentText: CONSENT, consentVersion: '7', retentionYears: 8 });
  const { text } = await pdf('/api/consent-forms/consentimiento');
  assert.ok(text.includes(CONSENT), 'el texto de Ajustes sale tal cual');
  assert.match(text, /versión 7/);
  assert.match(text, /8 años más/, 'el plazo sale de Ajustes');
});

test('con la clienta sale rellenado; en blanco, sin sus datos', async () => {
  const con = await pdf(`/api/consent-forms/consentimiento?clientId=${lucia}`);
  for (const dato of ['Lucía Fernández', 'lucia@example.com', '611222333', '12345678Z']) {
    assert.ok(con.text.includes(dato), `falta ${dato}`);
  }
  assert.match(con.res.headers.get('content-disposition'), /consentimiento-lucia-fernandez\.pdf/);

  const blanco = await pdf('/api/consent-forms/consentimiento');
  assert.ok(!blanco.text.includes('Lucía'), 'en blanco no lleva datos de nadie');
  assert.match(blanco.res.headers.get('content-disposition'), /en-blanco/);
});

test('la retirada cita cuándo se dio el consentimiento', async () => {
  await a.post(`/api/clients/${lucia}/consent`, { action: 'grant', date: '2026-09-01', channel: 'Papel firmado' });
  const { text } = await pdf(`/api/consent-forms/revocacion?clientId=${lucia}`);
  assert.match(text, /Retirada del consentimiento/);
  assert.match(text, /01\/09\/2026/);
  assert.match(text, /versión 7/);
  assert.match(text, /Lucía Fernández/);
});

test('la solicitud de derechos recoge los seis derechos', async () => {
  const { text } = await pdf('/api/consent-forms/derechos');
  for (const d of ['Acceso', 'Rectificación', 'Supresión', 'Oposición', 'Limitación', 'Portabilidad']) {
    assert.ok(text.includes(d), `falta ${d}`);
  }
});

test('si faltan los datos fiscales el formulario sale igual, con huecos para escribir', async () => {
  await a.put('/api/settings/issuer', { name: '', taxId: '', address: '', email: '', phone: '' });
  const { res, text } = await pdf('/api/consent-forms/consentimiento');
  assert.equal(res.status, 200);
  assert.match(text, /con NIF __________/);
  await a.put('/api/settings/issuer', { name: 'Doula Marina SL', taxId: 'B12345678', email: 'hola@marina.example' });
});

test('los formularios exigen sesión y validan lo que reciben', async () => {
  const anon = makeClient(srv.base);
  assert.equal((await pdf('/api/consent-forms/consentimiento', anon)).res.status, 401);
  assert.equal((await pdf('/api/consent-forms/inventado')).res.status, 404);
  assert.equal((await pdf('/api/consent-forms/consentimiento?clientId=99999')).res.status, 404);
});

test('preparar un formulario con los datos de una clienta queda en el registro de accesos', async () => {
  await pdf(`/api/consent-forms/derechos?clientId=${lucia}`);
  const log = (await a.get('/api/audit?action=consent_form')).data;
  assert.ok(log.rows.some((r) => r.entityId === String(lucia) && r.detail === 'derechos'));
  // En blanco no se registra: no hay datos de nadie.
  const antes = (await a.get('/api/audit?action=consent_form')).data.total;
  await pdf('/api/consent-forms/derechos');
  assert.equal((await a.get('/api/audit?action=consent_form')).data.total, antes);
});

// ---- registrar el consentimiento -----------------------------------------

test('registrar el consentimiento rellena la ficha con la version vigente y lo deja en el registro', async () => {
  const otra = (await a.post('/api/clients', { name: 'Marta Ruiz' })).data.id;
  const res = await a.post(`/api/clients/${otra}/consent`, { action: 'grant', date: '2026-10-02', channel: 'Papel firmado' });
  assert.equal(res.status, 200);
  assert.equal(res.data.consentAt, '2026-10-02');
  assert.equal(res.data.consentChannel, 'Papel firmado');
  assert.equal(res.data.consentVersion, '7', 'la versión del texto que se aceptó');
  const log = (await a.get('/api/audit?action=consent_grant')).data;
  assert.ok(log.rows.some((r) => r.entityId === String(otra) && /2026-10-02/.test(r.detail)));
});

test('sin fecha se usa hoy; no se admiten fechas futuras ni canal vacío', async () => {
  const c = (await a.post('/api/clients', { name: 'Nerea Gómez' })).data.id;
  assert.equal((await a.post(`/api/clients/${c}/consent`, { action: 'grant', channel: '  ' })).status, 400);
  assert.equal((await a.post(`/api/clients/${c}/consent`, { action: 'grant', channel: 'Email', date: '2999-01-01' })).status, 400);
  assert.equal((await a.post(`/api/clients/${c}/consent`, { action: 'grant', channel: 'Email', date: 'ayer' })).status, 400);
  const ok = await a.post(`/api/clients/${c}/consent`, { action: 'grant', channel: 'Email' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.consentAt, new Date().toISOString().slice(0, 10));
  assert.equal((await a.post(`/api/clients/${c}/consent`, { action: 'otra' })).status, 400);
});

test('retirar el consentimiento lo quita de la ficha y deja constancia de cuándo lo dio', async () => {
  const res = await a.post(`/api/clients/${lucia}/consent`, { action: 'revoke', date: '2026-10-10' });
  assert.equal(res.status, 200);
  assert.equal(res.data.consentAt, '');
  assert.equal(res.data.consentChannel, '');
  assert.equal(res.data.consentVersion, '');
  const log = (await a.get('/api/audit?action=consent_revoke')).data;
  const fila = log.rows.find((r) => r.entityId === String(lucia));
  assert.ok(fila, 'queda en el registro');
  assert.match(fila.detail, /retirado el 2026-10-10/);
  assert.match(fila.detail, /lo había dado el 2026-09-01/);
  assert.equal((await a.get(`/api/clients/${lucia}`)).data.name, 'Lucía Fernández', 'retirar no borra la ficha');
});

test('no se retira lo que no se dio', async () => {
  const res = await a.post(`/api/clients/${lucia}/consent`, { action: 'revoke' });
  assert.equal(res.status, 409);
});

test('una ficha anonimizada no admite consentimiento ni formularios con sus datos', async () => {
  const c = (await a.post('/api/clients', { name: 'Para anonimizar' })).data.id;
  await a.post(`/api/clients/${c}/anonymize`, { reason: 'prueba' });
  assert.equal((await a.post(`/api/clients/${c}/consent`, { action: 'grant', channel: 'Email' })).status, 409);
  assert.equal((await pdf(`/api/consent-forms/consentimiento?clientId=${c}`)).res.status, 409);
});

test('registrar o retirar consentimiento exige sesión y clienta', async () => {
  const anon = makeClient(srv.base);
  assert.equal((await anon.post(`/api/clients/${lucia}/consent`, { action: 'grant', channel: 'Email' })).status, 401);
  assert.equal((await a.post('/api/clients/99999/consent', { action: 'grant', channel: 'Email' })).status, 404);
});
