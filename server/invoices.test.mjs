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

/** Texto de un PDF de pdfkit, para poder comprobar que sale lo que debe. */
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
        const bytes = Buffer.concat(
          [...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex')),
        );
        out.push(dec.decode(bytes));
      }
    } catch {
      /* no todos los flujos son texto */
    }
    i = e + 9;
  }
  return out.join('\n');
}

/** La cookie del cliente, para las llamadas con fetch directo. */
const cookieDe = (cli) => cli.cookie();

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
    vatBreakdown: [{ rate: 21, base: 100, vat: 21 }],
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

  // Los importes tienen que cuadrar. El listado no trae el desglose por tipo
  // de IVA: solo pinta el total, y sacarlo obligaria a una consulta agregada
  // mas por cada carga para un dato que esa pantalla no enseña. Va en el
  // detalle, que es de donde sale el PDF, que es donde la ley lo exige.
  for (const campo of ['base', 'vat', 'irpf', 'total']) {
    assert.equal(fila.totals[campo], detalle.totals[campo], campo);
  }
  assert.equal(fila.totals.vatBreakdown, undefined);
  assert.ok(Array.isArray(detalle.totals.vatBreakdown), 'el detalle si lo trae');
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

// ---- requisitos del art. 6.1 del RD 1619/2012 ----------------------------

test('el desglose del IVA va por tipo, no en un unico total', async () => {
  // El art. 6.1.g y h piden el tipo aplicado y la cuota repercutida por
  // separado: con varios tipos en una factura, un total unico no cumple.
  const t = invoiceTotals(
    [
      { qty: 1, price: 100, vat: 21 },
      { qty: 1, price: 200, vat: 10 },
      { qty: 1, price: 50, vat: 21 },
    ],
    0,
  );
  assert.deepEqual(t.vatBreakdown, [
    { rate: 10, base: 200, vat: 20 },
    { rate: 21, base: 150, vat: 31.5 },
  ]);
  assert.equal(t.vat, 51.5, 'el total sigue siendo la suma de las cuotas');
  assert.equal(t.base, 350);
});

test('con un solo tipo el desglose trae una linea', async () => {
  const t = invoiceTotals([{ qty: 2, price: 100, vat: 0 }], 0);
  assert.deepEqual(t.vatBreakdown, [{ rate: 0, base: 200, vat: 0 }]);
});

test('la fecha de operacion y la inversion del sujeto pasivo se guardan', async () => {
  const inv = await draft({ operationDate: '2026-02-28', reverseCharge: true });
  assert.equal(inv.operationDate, '2026-02-28');
  assert.equal(inv.reverseCharge, 1);

  const editada = await a.put(`/api/invoices/${inv.id}`, { reverseCharge: false });
  assert.equal(editada.data.reverseCharge, 0);
});

test('la nota de exencion sale aunque la factura mezcle tipos de IVA', async () => {
  // Una factura con una linea exenta y otra al 21% sigue necesitando la
  // referencia al precepto para la parte exenta. Mirar solo el IVA total
  // dejaba la mencion fuera.
  const { invoicePdf } = await import('./invoice-pdf.js');
  const inv = await draft({
    items: [
      { description: 'Sesión exenta', qty: 1, price: 100, vat: 0 },
      { description: 'Material', qty: 1, price: 50, vat: 21 },
    ],
  });
  const emitida = (await a.post(`/api/invoices/${inv.id}/issue`)).data;
  assert.ok(emitida.totals.vat > 0, 'la factura si lleva IVA en total');
  assert.ok(emitida.totals.vatBreakdown.some((t) => t.rate === 0), 'y una parte exenta');

  const buf = await invoicePdf({ ...emitida, exemptionNote: 'EXENCION-DE-PRUEBA-20-UNO-3' });
  const texto = await textoDelPdf(buf);
  assert.ok(texto.includes('EXENCION-DE-PRUEBA-20-UNO-3'), 'la mencion tiene que salir en el PDF');
});

test('el PDF de una factura exenta lleva la referencia al precepto', async () => {
  const { invoicePdf } = await import('./invoice-pdf.js');
  const inv = (await a.post(`/api/invoices/${(await draft()).id}/issue`)).data;
  const buf = await invoicePdf({
    ...inv,
    exemptionNote: 'Operación exenta conforme al artículo 20.Uno.3º de la Ley 37/1992.',
  });
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buf.length > 1500);
});

// ---- descarga de varias a la vez -----------------------------------------

test('varias facturas en un solo PDF', async () => {
  const uno = (await a.post(`/api/invoices/${(await draft()).id}/issue`)).data;
  const dos = (await a.post(`/api/invoices/${(await draft()).id}/issue`)).data;

  const res = await fetch(`${srv.base}/api/invoices/pdf?ids=${uno.id},${dos.id}`, {
    headers: { cookie: cookieDe(a) },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');

  // Dos facturas, dos paginas.
  const paginas = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.equal(paginas, 2, 'una pagina por factura');
});

test('el PDF conjunto exige sesion y valida lo que recibe', async () => {
  const sinSesion = await fetch(`${srv.base}/api/invoices/pdf?ids=1,2`);
  assert.equal(sinSesion.status, 401);

  const vacio = await a.get('/api/invoices/pdf?ids=');
  assert.equal(vacio.status, 400);

  const basura = await a.get('/api/invoices/pdf?ids=abc,-1,0');
  assert.equal(basura.status, 400, 'identificadores que no valen se descartan');

  const inexistente = await a.get('/api/invoices/pdf?ids=99999');
  assert.equal(inexistente.status, 404);
});
