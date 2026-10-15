// Facturación: borrador libre, emitida inmutable.
//
// Mientras la factura está en Borrador se edita entera y no tiene número. Al
// emitirla toma número correlativo, guarda una copia de los datos fiscales y
// queda congelada: a partir de ahí solo cambia su estado de cobro. Los
// errores se corrigen con una factura rectificativa enlazada a la original,
// que es lo que exige la norma: una factura emitida no se reescribe.
import express from 'express';
import { createHash } from 'node:crypto';
import { all, get, run } from './db.js';
import { searchItems } from '../src/search.js';
import { requireAdmin, audit } from './auth.js';
import { getSetting, issuerIsComplete } from './settings.js';

/** Estados en los que la factura ya está emitida y no se puede tocar. */
export const ISSUED = new Set(['Emitida', 'Enviada', 'Pagada', 'Rectificada', 'Anulada']);
/** Estados de cobro entre los que se puede ir y venir libremente. */
const PAYMENT_STATES = new Set(['Emitida', 'Enviada', 'Pagada']);

const round = (n) => Math.round(n * 100) / 100;
const num = (v) => Number(v) || 0;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Importe de una línea: cantidad por precio, menos el descuento.
 * @param {{qty:number, price:number, discount?:number}} it
 */
export const lineAmount = (it) => num(it.qty) * num(it.price) * (1 - num(it.discount) / 100);

/**
 * @param {Array} items
 * @param {number} irpfRate  retención de IRPF en porcentaje
 */
export function invoiceTotals(items, irpfRate = 0) {
  let base = 0;
  let vat = 0;
  // El art. 6.1.g y h del RD 1619/2012 pide el tipo impositivo aplicado y la
  // cuota repercutida por separado. Con varios tipos en la misma factura hay
  // que desglosarlos: un unico total de IVA no cumple.
  const porTipo = new Map();
  for (const it of items) {
    const line = lineAmount(it);
    const rate = num(it.vat);
    const cuota = line * (rate / 100);
    base += line;
    vat += cuota;
    const acc = porTipo.get(rate) || { rate, base: 0, vat: 0 };
    acc.base += line;
    acc.vat += cuota;
    porTipo.set(rate, acc);
  }
  const irpf = base * (num(irpfRate) / 100);
  return {
    base: round(base),
    vat: round(vat),
    irpf: round(irpf),
    total: round(base + vat - irpf),
    vatBreakdown: [...porTipo.values()]
      .sort((a, b) => a.rate - b.rate)
      .map((x) => ({ rate: x.rate, base: round(x.base), vat: round(x.vat) })),
  };
}

const parseSnapshot = (raw) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export async function invoiceWithItems(id) {
  const inv = await get(
    `SELECT i.*, c.name AS clientName, c.email AS clientEmail
     FROM invoices i LEFT JOIN clients c ON c.id = i.clientId WHERE i.id = ?`,
    [id],
  );
  if (!inv) return null;
  inv.items = await all('SELECT * FROM invoice_items WHERE invoiceId = ? ORDER BY id', [id]);
  inv.totals = invoiceTotals(inv.items, inv.irpfRate);
  inv.locked = ISSUED.has(inv.status);
  // En una factura emitida mandan las copias guardadas, no la ficha actual:
  // si la clienta cambia de dirección, la factura ya emitida no cambia.
  inv.issuer = parseSnapshot(inv.issuerSnapshot) || (await getSetting('issuer'));
  inv.client = parseSnapshot(inv.clientSnapshot) || (await clientFiscalData(inv.clientId));
  if (inv.rectifiesId) {
    inv.rectifies = await get('SELECT id, number, date FROM invoices WHERE id = ?', [inv.rectifiesId]);
  }
  const rectifiedBy = await get('SELECT id, number FROM invoices WHERE rectifiesId = ? AND seq IS NOT NULL', [id]);
  if (rectifiedBy) inv.rectifiedBy = rectifiedBy;
  return inv;
}

async function clientFiscalData(clientId) {
  if (!clientId) return null;
  const c = await get(
    'SELECT name, taxId, address, postalCode, city, province, country, email FROM clients WHERE id = ?',
    [clientId],
  );
  return c || null;
}

// ---- numeración ----------------------------------------------------------

/**
 * Formato: serie + año + correlativo de cuatro cifras. Con la serie vacía
 * queda "2026-0001", igual que la numeración anterior, para no romper la
 * continuidad al migrar.
 */
export const formatNumber = (series, year, seq) => `${series}${year}-${String(seq).padStart(4, '0')}`;

async function nextSeq(series, year) {
  const row = await get('SELECT MAX(seq) AS maxSeq FROM invoices WHERE series = ? AND fiscalYear = ?', [
    series,
    year,
  ]);
  return Number(row?.maxSeq || 0) + 1;
}

// ---- encadenado ----------------------------------------------------------

/**
 * Hash de la factura enlazado con el de la anterior emitida. No se envía a
 * ningún sitio: queda guardado para poder demostrar que el histórico no se ha
 * tocado, y para no tener que rediseñar esto si Verifactu acaba aplicando.
 */
function chainHash(prev, inv, total) {
  const payload = [prev, inv.number, inv.date, inv.clientTaxId || '', total.toFixed(2), inv.issuedAt].join('|');
  return createHash('sha256').update(payload).digest('hex');
}

async function lastChainHash() {
  const row = await get("SELECT hash FROM invoices WHERE hash <> '' ORDER BY issuedAt DESC, id DESC LIMIT 1");
  return row?.hash || '';
}

// ---- escritura de líneas -------------------------------------------------

async function replaceItems(invoiceId, items) {
  await run('DELETE FROM invoice_items WHERE invoiceId = ?', [invoiceId]);
  for (const it of items) {
    await run(
      'INSERT INTO invoice_items (invoiceId, description, qty, price, vat, discount) VALUES (?, ?, ?, ?, ?, ?)',
      [
        invoiceId,
        String(it.description || ''),
        num(it.qty) || 1,
        num(it.price),
        num(it.vat),
        Math.min(100, Math.max(0, num(it.discount))),
      ],
    );
  }
}

// ---- rutas ---------------------------------------------------------------

export const invoicesRouter = express.Router();

const PAGE_SIZE = 50;

/**
 * Listado con filtros y paginación en el servidor. Los totales salen en una
 * sola consulta agregada: antes se hacía una consulta por factura, que con
 * años de histórico son cientos de viajes a la base por cada carga.
 */
invoicesRouter.get('/', async (req, res, next) => {
  try {
    const where = [];
    const args = [];
    const { year, month, status } = req.query;
    if (year) {
      where.push('substr(i.date, 1, 4) = ?');
      args.push(String(year));
    }
    if (month) {
      where.push('substr(i.date, 6, 2) = ?');
      args.push(String(month).padStart(2, '0'));
    }
    if (status === 'pendientes') where.push("i.status NOT IN ('Pagada', 'Anulada', 'Rectificada')");
    else if (status) {
      where.push('i.status = ?');
      args.push(String(status));
    }
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await all(
      `SELECT i.*, c.name AS clientName,
              COALESCE(SUM(it.qty * it.price * (1 - it.discount / 100.0)), 0) AS base,
              COALESCE(SUM(it.qty * it.price * (1 - it.discount / 100.0) * it.vat / 100.0), 0) AS vatAmount
       FROM invoices i
       LEFT JOIN clients c ON c.id = i.clientId
       LEFT JOIN invoice_items it ON it.invoiceId = i.id
       ${filter}
       GROUP BY i.id
       ORDER BY i.date DESC, i.id DESC`,
      args,
    );
    for (const r of rows) {
      const irpf = round(num(r.base) * (num(r.irpfRate) / 100));
      r.totals = {
        base: round(num(r.base)),
        vat: round(num(r.vatAmount)),
        irpf,
        total: round(num(r.base) + num(r.vatAmount) - irpf),
      };
      r.locked = ISSUED.has(r.status);
      delete r.base;
      delete r.vatAmount;
    }

    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const found = searchItems(rows, q, (i) => `${i.number} ${i.clientName} ${i.status}`);

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || PAGE_SIZE));
    const years = (
      await all("SELECT DISTINCT substr(date, 1, 4) AS y FROM invoices WHERE date <> '' ORDER BY y DESC")
    ).map((r) => r.y);

    res.json({
      rows: found.slice((page - 1) * pageSize, page * pageSize),
      total: found.length,
      page,
      pageSize,
      years,
    });
  } catch (e) {
    next(e);
  }
});

invoicesRouter.get('/:id', async (req, res, next) => {
  try {
    const inv = await invoiceWithItems(Number(req.params.id));
    if (!inv) return res.status(404).json({ error: 'No encontrado' });
    res.json(inv);
  } catch (e) {
    next(e);
  }
});

// Toda factura nace como borrador y sin número.
invoicesRouter.post('/', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const invoicing = await getSetting('invoicing');
    const info = await run(
      `INSERT INTO invoices (number, clientId, date, status, notes, series, dueDate,
                             paymentMethod, irpfRate, exemptionNote, operationDate, reverseCharge)
       VALUES ('', ?, ?, 'Borrador', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        b.clientId ? Number(b.clientId) : null,
        String(b.date || today()),
        String(b.notes || ''),
        String(b.series ?? invoicing.series),
        String(b.dueDate || ''),
        String(b.paymentMethod || ''),
        b.irpfRate !== undefined ? num(b.irpfRate) : invoicing.irpfRate,
        String(b.exemptionNote ?? ''),
        String(b.operationDate || ''),
        b.reverseCharge ? 1 : 0,
      ],
    );
    await replaceItems(info.lastInsertRowid, Array.isArray(b.items) ? b.items : []);
    await audit(req, { action: 'create', entity: 'invoices', entityId: info.lastInsertRowid });
    res.status(201).json(await invoiceWithItems(info.lastInsertRowid));
  } catch (e) {
    next(e);
  }
});

const EDITABLE = [
  'clientId', 'date', 'notes', 'series', 'dueDate', 'paymentMethod', 'irpfRate', 'exemptionNote',
  'operationDate', 'reverseCharge',
];

invoicesRouter.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await get('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'No encontrado' });
    if (ISSUED.has(existing.status)) {
      return res.status(409).json({
        error: 'Una factura emitida no se puede modificar. Emite una rectificativa.',
      });
    }
    const b = req.body ?? {};
    const next_ = {};
    for (const f of EDITABLE) {
      if (b[f] === undefined) {
        next_[f] = existing[f];
      } else if (f === 'clientId') {
        next_[f] = b[f] ? Number(b[f]) : null;
      } else if (f === 'irpfRate') {
        next_[f] = num(b[f]);
      } else if (f === 'reverseCharge') {
        next_[f] = b[f] ? 1 : 0;
      } else {
        next_[f] = String(b[f]);
      }
    }
    await run(
      `UPDATE invoices SET ${EDITABLE.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`,
      [...EDITABLE.map((f) => next_[f]), id],
    );
    if (Array.isArray(b.items)) await replaceItems(id, b.items);
    await audit(req, { action: 'update', entity: 'invoices', entityId: id });
    res.json(await invoiceWithItems(id));
  } catch (e) {
    next(e);
  }
});

invoicesRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await get('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'No encontrado' });
    if (ISSUED.has(existing.status)) {
      return res.status(409).json({
        error: 'Una factura emitida no se puede borrar. Puedes anularla o rectificarla.',
      });
    }
    await run('DELETE FROM invoice_items WHERE invoiceId = ?', [id]);
    await run('DELETE FROM invoices WHERE id = ?', [id]);
    await audit(req, { action: 'delete', entity: 'invoices', entityId: id });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// ---- emitir --------------------------------------------------------------

invoicesRouter.post('/:id/issue', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const inv = await get('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!inv) return res.status(404).json({ error: 'No encontrado' });
    if (ISSUED.has(inv.status)) return res.status(409).json({ error: 'Esta factura ya está emitida' });

    const issuer = await getSetting('issuer');
    if (!issuerIsComplete(issuer)) {
      return res.status(400).json({
        error: 'Faltan tus datos fiscales. Complétalos en Ajustes antes de emitir.',
      });
    }
    const client = await clientFiscalData(inv.clientId);
    if (!client) return res.status(400).json({ error: 'La factura necesita una clienta.' });
    if (!client.taxId) {
      return res.status(400).json({ error: `Falta el NIF de ${client.name}. Añádelo en su ficha.` });
    }
    const items = await all('SELECT * FROM invoice_items WHERE invoiceId = ?', [id]);
    if (items.length === 0) return res.status(400).json({ error: 'La factura no tiene ninguna línea.' });

    const issuedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const date = inv.date || today();
    const year = Number(date.slice(0, 4));
    const totals = invoiceTotals(items, inv.irpfRate);
    const prev = await lastChainHash();

    // Dos emisiones a la vez no pueden duplicar número: el índice único sobre
    // (serie, año, correlativo) rechaza la segunda y aquí se reintenta con el
    // siguiente. Es la forma de garantizarlo sin transacciones distribuidas.
    for (let attempt = 0; attempt < 10; attempt++) {
      const seq = await nextSeq(inv.series, year);
      const number = formatNumber(inv.series, year, seq);
      const hash = chainHash(prev, { number, date, clientTaxId: client.taxId, issuedAt }, totals.total);
      try {
        await run(
          `UPDATE invoices SET number = ?, series = ?, fiscalYear = ?, seq = ?, date = ?,
                               status = 'Emitida', issuedAt = ?, issuerSnapshot = ?, clientSnapshot = ?,
                               hash = ?, hashPrev = ?
           WHERE id = ?`,
          [
            number,
            inv.series,
            year,
            seq,
            date,
            issuedAt,
            JSON.stringify(issuer),
            JSON.stringify(client),
            hash,
            prev,
            id,
          ],
        );
      } catch (err) {
        if (/UNIQUE|constraint/i.test(String(err?.message))) continue;
        throw err;
      }
      // Si la rectificativa se acaba de emitir, la original queda marcada.
      if (inv.rectifiesId) {
        await run("UPDATE invoices SET status = 'Rectificada' WHERE id = ?", [inv.rectifiesId]);
      }
      await audit(req, { action: 'issue', entity: 'invoices', entityId: id, detail: number });
      return res.json(await invoiceWithItems(id));
    }
    res.status(409).json({ error: 'No se pudo asignar número. Vuelve a intentarlo.' });
  } catch (e) {
    next(e);
  }
});

// ---- estado de cobro -----------------------------------------------------

invoicesRouter.post('/:id/status', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const inv = await get('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!inv) return res.status(404).json({ error: 'No encontrado' });
    const status = String(req.body?.status || '');
    if (!PAYMENT_STATES.has(status) || !PAYMENT_STATES.has(inv.status)) {
      return res.status(409).json({ error: 'Ese cambio de estado no es posible' });
    }
    const paidAt = status === 'Pagada' ? String(req.body?.paidAt || today()) : '';
    await run('UPDATE invoices SET status = ?, paidAt = ? WHERE id = ?', [status, paidAt, id]);
    await audit(req, { action: 'status', entity: 'invoices', entityId: id, detail: status });
    res.json(await invoiceWithItems(id));
  } catch (e) {
    next(e);
  }
});

// ---- rectificativa -------------------------------------------------------

invoicesRouter.post('/:id/rectify', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const original = await get('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!original) return res.status(404).json({ error: 'No encontrado' });
    if (!ISSUED.has(original.status)) {
      return res.status(409).json({ error: 'Solo se rectifica una factura ya emitida' });
    }
    if (original.status === 'Rectificada') {
      return res.status(409).json({ error: 'Esta factura ya está rectificada' });
    }
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Explica el motivo de la rectificación' });

    const invoicing = await getSetting('invoicing');
    const info = await run(
      `INSERT INTO invoices (number, clientId, date, status, notes, series, dueDate, paymentMethod,
                             irpfRate, exemptionNote, rectifiesId, rectifyReason)
       VALUES ('', ?, ?, 'Borrador', ?, ?, '', ?, ?, ?, ?, ?)`,
      [
        original.clientId,
        today(),
        original.notes,
        invoicing.rectifySeries,
        original.paymentMethod,
        original.irpfRate,
        original.exemptionNote,
        id,
        reason,
      ],
    );
    const items = await all('SELECT * FROM invoice_items WHERE invoiceId = ? ORDER BY id', [id]);
    await replaceItems(info.lastInsertRowid, items);
    await audit(req, { action: 'rectify', entity: 'invoices', entityId: info.lastInsertRowid, detail: `de ${original.number}` });
    res.status(201).json(await invoiceWithItems(info.lastInsertRowid));
  } catch (e) {
    next(e);
  }
});

// ---- anular (solo admin) -------------------------------------------------

invoicesRouter.post('/:id/void', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const inv = await get('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!inv) return res.status(404).json({ error: 'No encontrado' });
    if (!ISSUED.has(inv.status)) return res.status(409).json({ error: 'Esta factura no está emitida' });
    if (inv.status === 'Anulada') return res.status(409).json({ error: 'Ya está anulada' });
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Explica el motivo de la anulación' });
    // La factura se queda: anular no borra nada, solo marca y deja constancia.
    await run("UPDATE invoices SET status = 'Anulada', rectifyReason = ? WHERE id = ?", [reason, id]);
    await audit(req, { action: 'void', entity: 'invoices', entityId: id, detail: reason });
    res.json(await invoiceWithItems(id));
  } catch (e) {
    next(e);
  }
});
