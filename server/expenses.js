// Gastos y resumen trimestral de impuestos.
//
// El CRM solo conocía los ingresos, así que no podía decir lo que se gana de
// verdad ni dar los números del 303 y el 130. Esto no presenta nada ante
// Hacienda: calcula las cifras para rellenarlo o para pasárselas a la
// gestoría sin rebuscar en dos sitios.
import express from 'express';
import { all, get, run } from './db.js';
import { searchItems } from '../src/search.js';
import { audit } from './auth.js';
import { getSetting } from './settings.js';
import { expensePdf } from './expense-pdf.js';

const round = (n) => Math.round(n * 100) / 100;
const num = (v) => Number(v) || 0;

/** Trimestre natural (1-4) de una fecha 'YYYY-MM-DD'. */
export const quarterOf = (iso) => Math.floor((Number(String(iso).slice(5, 7)) - 1) / 3) + 1;

/** Meses que cubre un trimestre, como cadenas '01'…'12'. */
export const monthsOfQuarter = (q) =>
  [0, 1, 2].map((i) => String((Number(q) - 1) * 3 + i + 1).padStart(2, '0'));

/**
 * Importes de un gasto. El IVA soportado solo se puede deducir si el gasto es
 * deducible; si no lo es, forma parte del coste y no entra en el 303.
 * @param {{base:number, vatRate:number, deductible:number|boolean}} e
 */
export function expenseAmounts(e) {
  const base = round(num(e.base));
  const vat = round(num(e.base) * (num(e.vatRate) / 100));
  const deductible = !!e.deductible;
  return {
    base,
    vat,
    // El total suma los importes ya redondeados, para que lo que se ve en
    // pantalla cuadre al centimo con lo que pone la factura del proveedor.
    total: round(base + vat),
    deductibleBase: deductible ? base : 0,
    deductibleVat: deductible ? vat : 0,
  };
}

const FIELDS = ['date', 'description', 'supplier', 'supplierTaxId', 'category', 'base', 'vatRate', 'deductible', 'notes'];

const normalize = (f, v) => {
  if (f === 'base' || f === 'vatRate') return num(v);
  if (f === 'deductible') return v === undefined || v === null || v === '' ? 1 : v ? 1 : 0;
  return String(v ?? '').trim();
};

export const expensesRouter = express.Router();

expensesRouter.get('/', async (req, res, next) => {
  try {
    const where = [];
    const args = [];
    if (req.query.year) {
      where.push('substr(date, 1, 4) = ?');
      args.push(String(req.query.year));
    }
    if (req.query.quarter) {
      const months = monthsOfQuarter(req.query.quarter);
      where.push(`substr(date, 6, 2) IN (${months.map(() => '?').join(', ')})`);
      args.push(...months);
    }
    if (req.query.category) {
      where.push('category = ?');
      args.push(String(req.query.category));
    }
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await all(`SELECT * FROM expenses ${filter} ORDER BY date DESC, id DESC`, args);
    for (const r of rows) r.amounts = expenseAmounts(r);

    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const found = searchItems(rows, q, (e) => `${e.description} ${e.supplier} ${e.category} ${e.notes}`);
    const years = (
      await all("SELECT DISTINCT substr(date, 1, 4) AS y FROM expenses WHERE date <> '' ORDER BY y DESC")
    ).map((r) => r.y);

    res.json({
      rows: found,
      years,
      totals: {
        base: round(found.reduce((s, r) => s + r.amounts.base, 0)),
        vat: round(found.reduce((s, r) => s + r.amounts.vat, 0)),
        total: round(found.reduce((s, r) => s + r.amounts.total, 0)),
      },
    });
  } catch (e) {
    next(e);
  }
});

/** El justificante del gasto en PDF, para enviarlo. */
expensesRouter.get('/:id/pdf', async (req, res, next) => {
  try {
    const expense = await get('SELECT * FROM expenses WHERE id = ?', [Number(req.params.id)]);
    if (!expense) return res.status(404).json({ error: 'No encontrado' });
    const pdf = await expensePdf(expense, await getSetting('issuer'));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="gasto-${expense.id}.pdf"`);
    res.send(pdf);
  } catch (e) {
    next(e);
  }
});

expensesRouter.post('/', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    if (!String(b.description || '').trim()) {
      return res.status(400).json({ error: 'Falta el concepto del gasto' });
    }
    const info = await run(
      `INSERT INTO expenses (${FIELDS.join(', ')}) VALUES (${FIELDS.map(() => '?').join(', ')})`,
      FIELDS.map((f) => normalize(f, b[f])),
    );
    await audit(req, { action: 'create', entity: 'expenses', entityId: info.lastInsertRowid });
    res.status(201).json(await get('SELECT * FROM expenses WHERE id = ?', [info.lastInsertRowid]));
  } catch (e) {
    next(e);
  }
});

expensesRouter.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await get('SELECT * FROM expenses WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'No encontrado' });
    const b = req.body ?? {};
    const vals = FIELDS.map((f) => (b[f] === undefined ? existing[f] : normalize(f, b[f])));
    await run(`UPDATE expenses SET ${FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, [...vals, id]);
    await audit(req, { action: 'update', entity: 'expenses', entityId: id });
    res.json(await get('SELECT * FROM expenses WHERE id = ?', [id]));
  } catch (e) {
    next(e);
  }
});

expensesRouter.delete('/:id', async (req, res, next) => {
  try {
    const info = await run('DELETE FROM expenses WHERE id = ?', [Number(req.params.id)]);
    if (info.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    await audit(req, { action: 'delete', entity: 'expenses', entityId: req.params.id });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// ---- resumen de impuestos ------------------------------------------------

export const taxesRouter = express.Router();

/**
 * Las cifras del 303 (IVA) y del 130 (pago fraccionado de IRPF) de un
 * trimestre.
 *
 * Se cuentan las facturas **emitidas**, por fecha de factura, que es el
 * criterio de devengo del IVA: una factura emitida y no cobrada se declara
 * igual. Las anuladas y las rectificadas quedan fuera, porque la rectificativa
 * ya recoge el importe corregido.
 */
taxesRouter.get('/', async (req, res, next) => {
  try {
    const year = String(req.query.year || new Date().getFullYear());
    const quarter = Number(req.query.quarter) || quarterOf(new Date().toISOString().slice(0, 10));
    const months = monthsOfQuarter(quarter);
    const monthFilter = `substr(i.date, 6, 2) IN (${months.map(() => '?').join(', ')})`;

    const income = await get(
      `SELECT COALESCE(SUM(it.qty * it.price * (1 - it.discount / 100.0)), 0) AS base,
              COALESCE(SUM(it.qty * it.price * (1 - it.discount / 100.0) * it.vat / 100.0), 0) AS vat
       FROM invoices i JOIN invoice_items it ON it.invoiceId = i.id
       WHERE i.seq IS NOT NULL AND i.status NOT IN ('Anulada', 'Rectificada')
         AND substr(i.date, 1, 4) = ? AND ${monthFilter}`,
      [year, ...months],
    );

    // El IRPF retenido en factura es un pago a cuenta que ya ha hecho el
    // cliente, asi que se descuenta de lo que toca ingresar con el 130.
    const withheld = await get(
      `SELECT COALESCE(SUM(t.base * i.irpfRate / 100.0), 0) AS irpf FROM (
         SELECT it.invoiceId AS id,
                SUM(it.qty * it.price * (1 - it.discount / 100.0)) AS base
         FROM invoice_items it GROUP BY it.invoiceId
       ) t JOIN invoices i ON i.id = t.id
       WHERE i.seq IS NOT NULL AND i.status NOT IN ('Anulada', 'Rectificada')
         AND substr(i.date, 1, 4) = ? AND ${monthFilter}`,
      [year, ...months],
    );

    const expenseMonths = `substr(date, 6, 2) IN (${months.map(() => '?').join(', ')})`;
    const spend = await get(
      `SELECT COALESCE(SUM(base), 0) AS base,
              COALESCE(SUM(CASE WHEN deductible = 1 THEN base ELSE 0 END), 0) AS deductibleBase,
              COALESCE(SUM(CASE WHEN deductible = 1 THEN base * vatRate / 100.0 ELSE 0 END), 0) AS deductibleVat
       FROM expenses WHERE substr(date, 1, 4) = ? AND ${expenseMonths}`,
      [year, ...months],
    );

    const vatCharged = round(num(income.vat));
    const vatPaid = round(num(spend.deductibleVat));
    const incomeBase = round(num(income.base));
    const expenseBase = round(num(spend.deductibleBase));
    const profit = round(incomeBase - expenseBase);
    const { irpfRate } = await getSetting('invoicing');

    res.json({
      year,
      quarter,
      // Modelo 303: IVA repercutido menos soportado deducible.
      vat: {
        charged: vatCharged,
        paid: vatPaid,
        due: round(vatCharged - vatPaid),
      },
      // Modelo 130: 20% del rendimiento acumulado, menos las retenciones ya
      // practicadas en factura.
      irpf: {
        income: incomeBase,
        expenses: expenseBase,
        profit,
        rate: 20,
        gross: round(Math.max(0, profit) * 0.2),
        withheld: round(num(withheld.irpf)),
        due: round(Math.max(0, Math.max(0, profit) * 0.2 - num(withheld.irpf))),
        invoiceIrpfRate: num(irpfRate),
      },
      allExpenses: round(num(spend.base)),
    });
  } catch (e) {
    next(e);
  }
});
