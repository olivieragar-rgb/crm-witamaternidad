import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer } from './test-helpers.mjs';

const tmp = useTempDb(); // antes de importar app.js
const { expenseAmounts, quarterOf, monthsOfQuarter } = await import('./expenses.js');

const PW = 'contrasena-larga-1';

let srv;
let a;
let clientId;

before(async () => {
  srv = await startServer();
  a = srv.client;
  await a.post('/api/auth/setup', { email: 'admin@example.com', name: 'Admin', password: PW });
  await a.put('/api/settings/issuer', {
    name: 'Wita', taxId: 'B1', address: 'Calle 1', city: 'Granada',
  });
  clientId = (await a.post('/api/clients', { name: 'Lucía', taxId: '11223344A' })).data.id;
});
after(async () => {
  srv.close();
  await tmp.cleanup();
});

/** Emite una factura con una linea. */
async function factura({ date, price, vat = 0, irpfRate = 0, anular = false }) {
  const draft = (
    await a.post('/api/invoices', {
      clientId,
      date,
      irpfRate,
      items: [{ description: 'Sesión', qty: 1, price, vat }],
    })
  ).data;
  const emitida = (await a.post(`/api/invoices/${draft.id}/issue`)).data;
  if (anular) await a.post(`/api/invoices/${emitida.id}/void`, { reason: 'prueba' });
  return emitida;
}

const gasto = (over = {}) => a.post('/api/expenses', { date: '2026-02-10', description: 'Material', base: 100, vatRate: 21, ...over });

// ---- cálculo --------------------------------------------------------------

test('trimestre de una fecha', () => {
  assert.equal(quarterOf('2026-01-15'), 1);
  assert.equal(quarterOf('2026-03-31'), 1);
  assert.equal(quarterOf('2026-04-01'), 2);
  assert.equal(quarterOf('2026-09-30'), 3);
  assert.equal(quarterOf('2026-10-01'), 4);
  assert.equal(quarterOf('2026-12-31'), 4);
  assert.deepEqual(monthsOfQuarter(1), ['01', '02', '03']);
  assert.deepEqual(monthsOfQuarter(4), ['10', '11', '12']);
});

test('importes de un gasto', () => {
  assert.deepEqual(expenseAmounts({ base: 100, vatRate: 21, deductible: 1 }), {
    base: 100, vat: 21, total: 121, deductibleBase: 100, deductibleVat: 21,
  });
  // Un gasto no deducible no resta en el 303 ni en el 130: es coste, no
  // IVA soportado deducible.
  assert.deepEqual(expenseAmounts({ base: 100, vatRate: 21, deductible: 0 }), {
    base: 100, vat: 21, total: 121, deductibleBase: 0, deductibleVat: 0,
  });
  // El total suma los importes ya redondeados: 82,64 + 17,35 = 99,99.
  const r = expenseAmounts({ base: 82.64, vatRate: 21, deductible: 1 });
  assert.equal(r.vat, 17.35);
  assert.equal(r.total, 99.99);
  assert.equal(r.total, Math.round((r.base + r.vat) * 100) / 100, 'lo que se ve tiene que cuadrar');
});

// ---- CRUD ----------------------------------------------------------------

test('alta, edicion y baja de un gasto', async () => {
  const res = await gasto({ description: 'Libros de lactancia', supplier: 'Librería', category: 'Formacion' });
  assert.equal(res.status, 201);
  assert.equal(res.data.deductible, 1, 'deducible por defecto');

  const listado = (await a.get('/api/expenses')).data;
  const fila = listado.rows.find((r) => r.id === res.data.id);
  assert.deepEqual(fila.amounts, { base: 100, vat: 21, total: 121, deductibleBase: 100, deductibleVat: 21 });

  const edit = await a.put(`/api/expenses/${res.data.id}`, { base: 200, deductible: false });
  assert.equal(edit.data.base, 200);
  assert.equal(edit.data.deductible, 0);

  assert.equal((await a.del(`/api/expenses/${res.data.id}`)).status, 204);
  assert.equal((await a.del(`/api/expenses/${res.data.id}`)).status, 404);
});

test('el concepto es obligatorio', async () => {
  assert.equal((await a.post('/api/expenses', { base: 10 })).status, 400);
});

test('el listado filtra por ano, trimestre y categoria', async () => {
  await gasto({ date: '2026-02-10', description: 'T1', category: 'Suministros' });
  await gasto({ date: '2026-05-10', description: 'T2', category: 'Suministros' });
  await gasto({ date: '2025-02-10', description: 'Viejo', category: 'Otros' });

  const t1 = (await a.get('/api/expenses?year=2026&quarter=1')).data;
  assert.ok(t1.rows.every((r) => r.date.startsWith('2026-0') && Number(r.date.slice(5, 7)) <= 3));
  assert.ok(t1.rows.some((r) => r.description === 'T1'));
  assert.ok(!t1.rows.some((r) => r.description === 'T2'));

  const cat = (await a.get('/api/expenses?category=Suministros')).data;
  assert.ok(cat.rows.every((r) => r.category === 'Suministros'));

  const todos = (await a.get('/api/expenses')).data;
  assert.ok(todos.years.includes('2026') && todos.years.includes('2025'));
  assert.ok(todos.totals.total > 0);
});

test('las categorias de gasto son un catalogo editable', async () => {
  const { values } = (await a.get('/api/catalogs')).data;
  assert.ok(values.expenseCategory.some((v) => v.value === 'Cuota de autonomos'));
});

// ---- 303 y 130 ------------------------------------------------------------

test('el 303 resta el IVA soportado deducible del repercutido', async () => {
  // Trimestre limpio: 2027 T1.
  await factura({ date: '2027-01-20', price: 1000, vat: 21 }); // repercutido 210
  await gasto({ date: '2027-02-05', description: 'Material', base: 200, vatRate: 21 }); // soportado 42
  await gasto({ date: '2027-02-06', description: 'Comida', base: 100, vatRate: 10, deductible: false });

  const t = (await a.get('/api/taxes?year=2027&quarter=1')).data;
  assert.equal(t.vat.charged, 210);
  assert.equal(t.vat.paid, 42, 'el gasto no deducible no suma IVA soportado');
  assert.equal(t.vat.due, 168);
});

test('el 130 calcula el rendimiento y descuenta las retenciones', async () => {
  // 2027 T2: 2.000 de ingresos con 15% de retencion, 500 de gastos.
  await factura({ date: '2027-04-10', price: 2000, vat: 0, irpfRate: 15 });
  await gasto({ date: '2027-05-10', description: 'Alquiler', base: 500, vatRate: 0 });

  const t = (await a.get('/api/taxes?year=2027&quarter=2')).data;
  assert.equal(t.irpf.income, 2000);
  assert.equal(t.irpf.expenses, 500);
  assert.equal(t.irpf.profit, 1500);
  assert.equal(t.irpf.gross, 300, '20% de 1.500');
  assert.equal(t.irpf.withheld, 300, '15% de 2.000 ya retenido en factura');
  assert.equal(t.irpf.due, 0, 'lo retenido cubre el pago fraccionado');
});

test('un rendimiento negativo no genera pago a cuenta', async () => {
  await gasto({ date: '2027-08-10', description: 'Perdidas', base: 900, vatRate: 0 });
  const t = (await a.get('/api/taxes?year=2027&quarter=3')).data;
  assert.equal(t.irpf.profit, -900);
  assert.equal(t.irpf.gross, 0);
  assert.equal(t.irpf.due, 0);
});

test('las facturas anuladas y los borradores no cuentan', async () => {
  await factura({ date: '2027-10-05', price: 500, vat: 21 });
  await factura({ date: '2027-10-06', price: 999, vat: 21, anular: true });
  // Un borrador no es una factura: no se declara.
  await a.post('/api/invoices', {
    clientId, date: '2027-10-07', items: [{ description: 'x', qty: 1, price: 777, vat: 21 }],
  });

  const t = (await a.get('/api/taxes?year=2027&quarter=4')).data;
  assert.equal(t.irpf.income, 500, 'solo la emitida y no anulada');
  assert.equal(t.vat.charged, 105);
});

test('el 303 va por fecha de factura, no por fecha de cobro', async () => {
  // Emitida en T1 de 2028 y cobrada en T2: se declara en T1, que es el
  // criterio de devengo.
  const inv = await factura({ date: '2028-03-20', price: 100, vat: 21 });
  await a.post(`/api/invoices/${inv.id}/status`, { status: 'Pagada', paidAt: '2028-04-15' });

  assert.equal((await a.get('/api/taxes?year=2028&quarter=1')).data.vat.charged, 21);
  assert.equal((await a.get('/api/taxes?year=2028&quarter=2')).data.vat.charged, 0);
});

test('los impuestos exigen sesion', async () => {
  const { makeClient } = await import('./test-helpers.mjs');
  const anon = makeClient(srv.base);
  assert.equal((await anon.get('/api/taxes')).status, 401);
  assert.equal((await anon.get('/api/expenses')).status, 401);
});
