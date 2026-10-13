import express from 'express';
import { all, get, run, ready } from './db.js';
import { searchItems } from '../src/search.js';

const app = express();
app.use(express.json());

// Make sure the schema + seed exist before any request (important on serverless cold starts).
app.use(async (req, res, next) => {
  try {
    await ready();
    next();
  } catch (e) {
    next(e);
  }
});

const NUMERIC = new Set(['price', 'durationMin', 'active', 'clientId', 'serviceId', 'qty', 'vat']);
function normalize(field, value) {
  if (value === undefined || value === null || value === '') {
    return NUMERIC.has(field) ? (field === 'active' ? 1 : null) : '';
  }
  if (NUMERIC.has(field)) return Number(value);
  return String(value).trim();
}
const round = (n) => Math.round(n * 100) / 100;

function invoiceTotals(items) {
  let base = 0;
  let vat = 0;
  for (const it of items) {
    const line = Number(it.qty) * Number(it.price);
    base += line;
    vat += line * (Number(it.vat) / 100);
  }
  return { base: round(base), vat: round(vat), total: round(base + vat) };
}

// ---- generic CRUD --------------------------------------------------------

function crud({ table, fields, required = [], searchText, orderBy = 'id DESC' }) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const rows = await all(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      res.json(searchText ? searchItems(rows, q, searchText) : rows);
    } catch (e) {
      next(e);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const row = await get(`SELECT * FROM ${table} WHERE id = ?`, [Number(req.params.id)]);
      if (!row) return res.status(404).json({ error: 'No encontrado' });
      res.json(row);
    } catch (e) {
      next(e);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const body = req.body ?? {};
      for (const f of required) {
        if (body[f] === undefined || String(body[f]).trim() === '') {
          return res.status(400).json({ error: `El campo "${f}" es obligatorio` });
        }
      }
      const vals = fields.map((f) => normalize(f, body[f]));
      const info = await run(
        `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
        vals,
      );
      res.status(201).json(await get(`SELECT * FROM ${table} WHERE id = ?`, [info.lastInsertRowid]));
    } catch (e) {
      next(e);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const existing = await get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      if (!existing) return res.status(404).json({ error: 'No encontrado' });
      const body = req.body ?? {};
      for (const f of required) {
        if (body[f] !== undefined && String(body[f]).trim() === '') {
          return res.status(400).json({ error: `El campo "${f}" es obligatorio` });
        }
      }
      const vals = fields.map((f) => (body[f] === undefined ? existing[f] : normalize(f, body[f])));
      await run(`UPDATE ${table} SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, [...vals, id]);
      res.json(await get(`SELECT * FROM ${table} WHERE id = ?`, [id]));
    } catch (e) {
      next(e);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const info = await run(`DELETE FROM ${table} WHERE id = ?`, [Number(req.params.id)]);
      if (info.changes === 0) return res.status(404).json({ error: 'No encontrado' });
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}

// ---- clients / services --------------------------------------------------

app.use(
  '/api/clients',
  crud({
    table: 'clients',
    fields: ['name', 'email', 'phone', 'service', 'mode', 'dueDate', 'status', 'notes'],
    required: ['name'],
    orderBy: 'name',
    searchText: (c) => `${c.name} ${c.email} ${c.phone} ${c.service} ${c.mode} ${c.status} ${c.notes}`,
  }),
);

app.use(
  '/api/services',
  crud({
    table: 'services',
    fields: ['name', 'description', 'price', 'durationMin', 'active'],
    required: ['name'],
    orderBy: 'name',
    searchText: (s) => `${s.name} ${s.description}`,
  }),
);

// ---- appointments (joined names) -----------------------------------------

app.get('/api/appointments', async (req, res, next) => {
  try {
    const rows = await all(
      `SELECT a.*, c.name AS clientName, s.name AS serviceName
       FROM appointments a
       LEFT JOIN clients c ON c.id = a.clientId
       LEFT JOIN services s ON s.id = a.serviceId
       ORDER BY a.date DESC`,
    );
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    res.json(searchItems(rows, q, (a) => `${a.clientName} ${a.serviceName} ${a.mode} ${a.status} ${a.notes}`));
  } catch (e) {
    next(e);
  }
});

app.use(
  '/api/appointments',
  crud({
    table: 'appointments',
    fields: ['clientId', 'serviceId', 'date', 'mode', 'status', 'notes'],
    orderBy: 'date DESC',
  }),
);

// ---- invoices (items + totals) -------------------------------------------

async function invoiceWithItems(id) {
  const inv = await get(
    `SELECT i.*, c.name AS clientName FROM invoices i
     LEFT JOIN clients c ON c.id = i.clientId WHERE i.id = ?`,
    [id],
  );
  if (!inv) return null;
  inv.items = await all('SELECT * FROM invoice_items WHERE invoiceId = ? ORDER BY id', [id]);
  inv.totals = invoiceTotals(inv.items);
  return inv;
}

async function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const row = await get(`SELECT number FROM invoices WHERE number LIKE ? ORDER BY number DESC LIMIT 1`, [`${year}-%`]);
  const seq = row ? Number(row.number.split('-')[1]) + 1 : 1;
  return `${year}-${String(seq).padStart(4, '0')}`;
}

app.get('/api/invoices', async (req, res, next) => {
  try {
    const list = await all(
      `SELECT i.*, c.name AS clientName FROM invoices i
       LEFT JOIN clients c ON c.id = i.clientId ORDER BY i.date DESC, i.id DESC`,
    );
    for (const inv of list) {
      const items = await all('SELECT * FROM invoice_items WHERE invoiceId = ?', [inv.id]);
      inv.totals = invoiceTotals(items);
    }
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    res.json(searchItems(list, q, (i) => `${i.number} ${i.clientName} ${i.status}`));
  } catch (e) {
    next(e);
  }
});

app.get('/api/invoices/:id', async (req, res, next) => {
  try {
    const inv = await invoiceWithItems(Number(req.params.id));
    if (!inv) return res.status(404).json({ error: 'No encontrado' });
    res.json(inv);
  } catch (e) {
    next(e);
  }
});

app.post('/api/invoices', async (req, res, next) => {
  try {
    const { clientId, date, status = 'Borrador', notes = '', items = [] } = req.body ?? {};
    const number = req.body?.number?.trim() || (await nextInvoiceNumber());
    const info = await run('INSERT INTO invoices (number, clientId, date, status, notes) VALUES (?, ?, ?, ?, ?)', [
      number,
      clientId ? Number(clientId) : null,
      String(date || ''),
      String(status),
      String(notes),
    ]);
    const invId = info.lastInsertRowid;
    for (const it of items) {
      await run('INSERT INTO invoice_items (invoiceId, description, qty, price, vat) VALUES (?, ?, ?, ?, ?)', [
        invId,
        String(it.description || ''),
        Number(it.qty) || 1,
        Number(it.price) || 0,
        Number(it.vat) || 0,
      ]);
    }
    res.status(201).json(await invoiceWithItems(invId));
  } catch (e) {
    next(e);
  }
});

app.put('/api/invoices/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await get('SELECT * FROM invoices WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'No encontrado' });
    const { number, clientId, date, status, notes, items } = req.body ?? {};
    await run('UPDATE invoices SET number = ?, clientId = ?, date = ?, status = ?, notes = ? WHERE id = ?', [
      number !== undefined ? String(number) : existing.number,
      clientId !== undefined ? (clientId ? Number(clientId) : null) : existing.clientId,
      date !== undefined ? String(date) : existing.date,
      status !== undefined ? String(status) : existing.status,
      notes !== undefined ? String(notes) : existing.notes,
      id,
    ]);
    if (Array.isArray(items)) {
      await run('DELETE FROM invoice_items WHERE invoiceId = ?', [id]);
      for (const it of items) {
        await run('INSERT INTO invoice_items (invoiceId, description, qty, price, vat) VALUES (?, ?, ?, ?, ?)', [
          id,
          String(it.description || ''),
          Number(it.qty) || 1,
          Number(it.price) || 0,
          Number(it.vat) || 0,
        ]);
      }
    }
    res.json(await invoiceWithItems(id));
  } catch (e) {
    next(e);
  }
});

app.delete('/api/invoices/:id', async (req, res, next) => {
  try {
    await run('DELETE FROM invoice_items WHERE invoiceId = ?', [Number(req.params.id)]);
    const info = await run('DELETE FROM invoices WHERE id = ?', [Number(req.params.id)]);
    if (info.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// ---- dashboard -----------------------------------------------------------

app.get('/api/dashboard', async (req, res, next) => {
  try {
    const activeClients = (await get("SELECT COUNT(*) AS n FROM clients WHERE status = 'Activa'")).n;
    const newClients = (await get("SELECT COUNT(*) AS n FROM clients WHERE status = 'Nuevo contacto'")).n;
    const upcomingBirths = await all(
      "SELECT id, name, dueDate FROM clients WHERE dueDate >= date('now') ORDER BY dueDate LIMIT 5",
    );
    const upcomingAppointments = await all(
      `SELECT a.id, a.date, a.status, c.name AS clientName, s.name AS serviceName
       FROM appointments a
       LEFT JOIN clients c ON c.id = a.clientId
       LEFT JOIN services s ON s.id = a.serviceId
       WHERE a.date >= datetime('now') AND a.status = 'Programada'
       ORDER BY a.date LIMIT 5`,
    );
    const ym = new Date().toISOString().slice(0, 7);
    const paid = await all("SELECT id FROM invoices WHERE status = 'Pagada' AND date LIKE ?", [`${ym}%`]);
    let monthRevenue = 0;
    for (const inv of paid) {
      const items = await all('SELECT * FROM invoice_items WHERE invoiceId = ?', [inv.id]);
      monthRevenue += invoiceTotals(items).total;
    }
    const pendingInvoices = (await get("SELECT COUNT(*) AS n FROM invoices WHERE status != 'Pagada'")).n;

    res.json({
      activeClients,
      newClients,
      pendingInvoices,
      monthRevenue: round(monthRevenue),
      upcomingBirths,
      upcomingAppointments,
    });
  } catch (e) {
    next(e);
  }
});

// ---- error handler -------------------------------------------------------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno' });
});

export default app;
