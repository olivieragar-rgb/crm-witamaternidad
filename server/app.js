import express from 'express';
import { all, get, run, ready } from './db.js';
import { searchItems } from '../src/search.js';
import { sendMail, mailerConfigured } from './mailer.js';
import { invoiceXlsxBase64 } from './invoice-xlsx.js';
import { invoicePdf, invoicesPdf } from './invoice-pdf.js';
import { invoicesRouter, invoiceWithItems, lineAmount } from './invoices.js';
import { settingsRouter, getSetting } from './settings.js';
import { catalogsRouter } from './catalogs.js';
import { privacyRouter, auditRouter } from './privacy.js';
import { questionnairesRouter } from './questionnaires.js';
import { calendarRouter } from './calendar.js';
import { expensesRouter, taxesRouter } from './expenses.js';
import { remindersRouter } from './reminders.js';
import { securityHeaders, sameOrigin } from './security.js';
import { attachUser, requireAuth, authRouter, usersRouter, audit } from './auth.js';

const app = express();
// Detras del proxy de Vercel: para que req.ip y req.secure sean los reales.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(express.json({ limit: '64kb' }));

// Diagnostico. Va ANTES del middleware que prepara la base, para poder
// responder justo cuando la base es lo que falla, que es cuando hace falta.
//
// No expone nada sensible: ni credenciales, ni rutas, ni el mensaje de la
// excepcion. Solo que pieza esta fallando y con que codigo de error, que es
// lo unico que se necesita para saber donde mirar.
app.get('/api/health', async (req, res) => {
  const out = {
    turso: !!process.env.TURSO_DATABASE_URL,
    mail: mailerConfigured(),
    node: process.versions.node,
  };
  try {
    await ready();
    const row = await get('SELECT COUNT(*) AS n FROM users');
    const { migrationIssues } = await import('./db.js');
    out.db = 'ok';
    out.users = row.n;
    out.issues = migrationIssues;
    res.json({ ok: migrationIssues.length === 0, ...out });
  } catch (e) {
    // El codigo y el nombre bastan para identificar el fallo y no llevan
    // datos dentro; el mensaje completo se queda en los logs del servidor.
    console.error('health', e);
    res.status(503).json({
      ok: false,
      ...out,
      db: 'error',
      code: e?.code ?? null,
      name: e?.name ?? null,
    });
  }
});

// Make sure the schema + seed exist before any request (important on serverless cold starts).
app.use(async (req, res, next) => {
  try {
    await ready();
    next();
  } catch (e) {
    next(e);
  }
});

// Orden importante: comprobar el origen, resolver la sesion, publicar las
// rutas de acceso, y solo despues exigir sesion para todo lo demas.
app.use(sameOrigin);
app.use(attachUser);
// El feed del calendario lo piden los servidores de Google, que no pueden
// iniciar sesion: va antes de requireAuth y lo protege su token secreto.
app.use('/api/calendar', calendarRouter);
app.use('/api', authRouter);
app.use('/api/users', usersRouter);
app.use('/api', requireAuth);

// Campos que se guardan como numero. Los que apuntan a otra tabla admiten
// null, porque una cita puede no tener clienta asignada.
const NUMERIC = new Set(['price', 'durationMin', 'active', 'clientId', 'serviceId', 'qty', 'vat']);
const NULLABLE_REFS = new Set(['clientId', 'serviceId']);

function normalize(field, value) {
  if (value === undefined || value === null || value === '') {
    if (!NUMERIC.has(field)) return '';
    return NULLABLE_REFS.has(field) ? null : 0;
  }
  if (NUMERIC.has(field)) return Number(value) || 0;
  return String(value).trim();
}
// ---- generic CRUD --------------------------------------------------------

function crud({ table, fields, required = [], searchText, orderBy = 'id DESC', beforeDelete, afterDelete }) {
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
      // Solo se insertan las columnas que vienen en la peticion. Las demas se
      // omiten para que se aplique el DEFAULT de la tabla: pasar '' o null
      // pisaba ese valor por defecto, y una cita creada sin estado se quedaba
      // sin estado en vez de quedar "Programada".
      const present = fields.filter((f) => body[f] !== undefined && body[f] !== null && body[f] !== '');
      const info = present.length
        ? await run(
            `INSERT INTO ${table} (${present.join(', ')}) VALUES (${present.map(() => '?').join(', ')})`,
            present.map((f) => normalize(f, body[f])),
          )
        : await run(`INSERT INTO ${table} DEFAULT VALUES`);
      await audit(req, { action: 'create', entity: table, entityId: info.lastInsertRowid });
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
      await audit(req, { action: 'update', entity: table, entityId: id });
      res.json(await get(`SELECT * FROM ${table} WHERE id = ?`, [id]));
    } catch (e) {
      next(e);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (beforeDelete) {
        const blocked = await beforeDelete(id);
        if (blocked) return res.status(409).json({ error: blocked });
      }
      const info = await run(`DELETE FROM ${table} WHERE id = ?`, [id]);
      if (info.changes === 0) return res.status(404).json({ error: 'No encontrado' });
      // Lo que cuelga del registro borrado y no tiene clave ajena que lo
      // arrastre: se limpia aqui, cuando ya sabemos que el borrado ocurrio.
      if (afterDelete) await afterDelete(id);
      await audit(req, { action: 'delete', entity: table, entityId: req.params.id });
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}

// ---- clients / services --------------------------------------------------

// Antes del crud generico: si no, /api/clients/retention entraria por
// /api/clients/:id y "retention" se leeria como un identificador.
app.use('/api/clients', privacyRouter);
// Tambien antes del crud generico, y antes del middleware de auditoria de
// /api/clients: estas rutas se auditan ellas mismas, con el tipo de
// cuestionario en el detalle. Si cayeran en ese middleware, cada lectura
// quedaria registrada como "client_list", que es falso.
app.use('/api/clients', questionnairesRouter);
app.use('/api/audit', auditRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/taxes', taxesRouter);
app.use('/api/reminders', remindersRouter);

// Con datos de categoria especial hay que poder demostrar quien vio que, no
// solo quien cambio que.
app.use('/api/clients', async (req, res, next) => {
  if (req.method !== 'GET') return next();
  const id = req.path.slice(1);
  await audit(req, /^\d+$/.test(id)
    ? { action: 'client_view', entity: 'clients', entityId: id }
    : { action: 'client_list', entity: 'clients' });
  next();
});

app.use(
  '/api/clients',
  crud({
    table: 'clients',
    fields: [
      'name', 'email', 'phone', 'service', 'mode', 'dueDate', 'status', 'notes',
      'taxId', 'address', 'postalCode', 'city', 'province', 'country',
      'consentAt', 'consentChannel', 'consentVersion',
    ],
    required: ['name'],
    orderBy: 'name',
    searchText: (c) =>
      `${c.name} ${c.email} ${c.phone} ${c.service} ${c.mode} ${c.status} ${c.notes} ${c.taxId} ${c.city}`,
    // Las facturas hay que conservarlas, asi que una clienta con facturas no
    // se borra. El bloque de RGPD lo resuelve anonimizando la ficha.
    beforeDelete: async (id) => {
      const n = (await get('SELECT COUNT(*) AS n FROM invoices WHERE clientId = ?', [id])).n;
      return n > 0
        ? `No se puede borrar: tiene ${n} factura(s). Las facturas hay que conservarlas.`
        : null;
    },
    // El cuestionario de alta son datos de salud y no cuelga de clients con
    // clave ajena, asi que una ficha borrada dejaria sus respuestas en la
    // base para siempre. Borrar una ficha tiene que llevarselas.
    afterDelete: async (id) => {
      await run('DELETE FROM client_forms WHERE clientId = ?', [id]);
    },
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

// ---- calendar notes ------------------------------------------------------

app.use(
  '/api/notes',
  crud({
    table: 'notes',
    fields: ['date', 'text'],
    required: ['date'],
    orderBy: 'date',
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

// ---- invoices ------------------------------------------------------------

/**
 * Varias facturas en un solo PDF, una por pagina. Va ANTES de la ruta con
 * :id, porque si no "pdf" se leeria como un identificador.
 */
app.get('/api/invoices/pdf', async (req, res, next) => {
  try {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((x) => Number.isInteger(x) && x > 0)
      .slice(0, 200); // un tope para no tumbar la funcion con una peticion absurda
    if (ids.length === 0) return res.status(400).json({ error: 'No has seleccionado ninguna factura.' });

    const invoicing = await getSetting('invoicing');
    const docs = [];
    for (const id of ids) {
      const inv = await invoiceWithItems(id);
      if (inv) docs.push({ ...inv, ...pdfExtras(inv, invoicing) });
    }
    if (docs.length === 0) return res.status(404).json({ error: 'No se encontro ninguna.' });

    // Por fecha y numero, que es como se archivan.
    docs.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.number).localeCompare(String(b.number)));
    const pdf = await invoicesPdf(docs);
    await audit(req, { action: 'export_pdf', entity: 'invoices', detail: `${docs.length} facturas` });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="facturas-${docs.length}.pdf"`);
    res.send(pdf);
  } catch (e) {
    next(e);
  }
});

app.use('/api/invoices', invoicesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/catalogs', catalogsRouter);

/** Datos de los ajustes que la factura no guarda en su propia copia. */
const pdfExtras = (inv, invoicing) => ({
  exemptionNote: inv.exemptionNote || invoicing.exemptionNote,
  paymentDetails: invoicing.paymentDetails,
  footer: invoicing.footer,
});

app.get('/api/invoices/:id/pdf', async (req, res, next) => {
  try {
    const inv = await invoiceWithItems(Number(req.params.id));
    if (!inv) return res.status(404).json({ error: 'No encontrado' });
    const invoicing = await getSetting('invoicing');
    const pdf = await invoicePdf({ ...inv, ...pdfExtras(inv, invoicing) });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="factura-${inv.number || 'borrador'}.pdf"`);
    res.send(pdf);
  } catch (e) {
    next(e);
  }
});

// ---- enviar factura por email --------------------------------------------

/** Sustituye {{marcador}} por su valor; lo que no reconozca se queda vacio. */
function fillTemplate(text, vars) {
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ''));
}

function invoiceEmailHtml(inv, template, vars) {
  const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const money = (n) => `${(Number(n) || 0).toFixed(2)} €`;
  const rows = inv.items
    .map(
      (it) =>
        `<tr><td style="padding:8px;border-bottom:1px solid #ede7df">${esc(it.description)}</td>` +
        `<td align="right" style="padding:8px;border-bottom:1px solid #ede7df">${it.qty}</td>` +
        `<td align="right" style="padding:8px;border-bottom:1px solid #ede7df">${money(it.price)}</td>` +
        `<td align="right" style="padding:8px;border-bottom:1px solid #ede7df">${money(lineAmount(it))}</td></tr>`,
    )
    .join('');
  const brand = esc(vars.negocio || 'Factura');
  return `<div style="font-family:Arial,sans-serif;color:#2e2a25;max-width:640px">
    <h2 style="color:#476149">${brand}</h2>
    <p>${esc(fillTemplate(template.greeting, vars))}</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr style="color:#9c9489;font-size:12px;text-transform:uppercase">
        <th align="left" style="padding:8px">Concepto</th><th align="right" style="padding:8px">Cant.</th>
        <th align="right" style="padding:8px">Precio</th><th align="right" style="padding:8px">Importe</th>
      </tr>${rows}
    </table>
    <p style="text-align:right;font-size:18px"><strong>Total: ${money(inv.totals.total)}</strong>
      <br><span style="font-size:13px;color:#6b6259">Base ${money(inv.totals.base)} · IVA ${money(inv.totals.vat)}</span></p>
    ${inv.notes ? `<p style="color:#6b6259;font-size:13px">${esc(inv.notes)}</p>` : ''}
    ${template.signature ? `<p style="color:#9c9489;font-size:12px">${esc(template.signature)}</p>` : ''}
  </div>`;
}

app.get('/api/mail-status', (req, res) => res.json({ configured: mailerConfigured() }));

// El destinatario y los adjuntos salen todos del servidor, nunca del cuerpo
// de la peticion: si no, esta ruta seria un relay para enviar lo que sea
// desde nuestra propia cuenta de correo.
app.post('/api/invoices/:id/email', async (req, res, next) => {
  try {
    const inv = await invoiceWithItems(Number(req.params.id));
    if (!inv) return res.status(404).json({ error: 'No encontrado' });
    if (!inv.locked) return res.status(409).json({ error: 'Emite la factura antes de enviarla.' });

    const client = inv.clientId ? await get('SELECT email FROM clients WHERE id = ?', [inv.clientId]) : null;
    const to = (client?.email || '').trim();
    if (!to) {
      return res.status(400).json({
        error: 'La clienta no tiene email en su ficha. Añádelo en Clientas y vuelve a intentarlo.',
      });
    }

    const invoicing = await getSetting('invoicing');
    const pdf = await invoicePdf({ ...inv, ...pdfExtras(inv, invoicing) });
    const attachments = [
      { filename: `factura-${inv.number}.pdf`, content: pdf, contentType: 'application/pdf' },
      {
        filename: `factura-${inv.number}.xlsx`,
        content: invoiceXlsxBase64(inv),
        encoding: 'base64',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ];

    const template = await getSetting('emailTemplate');
    const brand = await getSetting('brand');
    const vars = {
      clienta: inv.client?.name || '',
      numero: inv.number,
      fecha: inv.date,
      total: `${inv.totals.total.toFixed(2)} €`,
      negocio: inv.issuer?.name || brand.name,
    };
    const subject = fillTemplate(template.subject, vars) || `Factura ${inv.number}`;
    await sendMail({ to, subject, html: invoiceEmailHtml(inv, template, vars), attachments });
    // Enviarla la pasa a "Enviada", que es lo que acaba de ocurrir de verdad.
    if (inv.status === 'Emitida') await run("UPDATE invoices SET status = 'Enviada' WHERE id = ?", [inv.id]);
    await audit(req, { action: 'email', entity: 'invoices', entityId: inv.id, detail: to });
    res.json({ ok: true, to });
  } catch (e) {
    if (e.code === 'MAIL_NOT_CONFIGURED') return res.status(400).json({ error: e.message });
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

    // Una sola consulta agregada; antes se recorrian las facturas del mes una
    // a una pidiendo sus lineas por separado.
    const ym = new Date().toISOString().slice(0, 7);
    const revenue = await get(
      `SELECT COALESCE(SUM(it.qty * it.price * (1 - it.discount / 100.0) * (1 + it.vat / 100.0)), 0) AS total
       FROM invoices i JOIN invoice_items it ON it.invoiceId = i.id
       WHERE i.status = 'Pagada' AND i.date LIKE ?`,
      [`${ym}%`],
    );
    const pendingInvoices = (
      await get("SELECT COUNT(*) AS n FROM invoices WHERE status IN ('Emitida', 'Enviada')")
    ).n;
    const draftInvoices = (await get("SELECT COUNT(*) AS n FROM invoices WHERE status = 'Borrador'")).n;

    // Facturas que ya han pasado de su vencimiento. Sin vencimiento explicito
    // se usa la fecha de factura mas los dias de cortesia configurados.
    const { graceDays } = await getSetting('reminders');
    const overdueInvoices = (
      await get(
        `SELECT COUNT(*) AS n FROM invoices
         WHERE status IN ('Emitida', 'Enviada')
           AND CASE WHEN dueDate <> '' THEN dueDate
                    ELSE date(date, '+' || ? || ' days') END < date('now')`,
        [Number(graceDays) || 0],
      )
    ).n;

    res.json({
      activeClients,
      newClients,
      pendingInvoices,
      draftInvoices,
      overdueInvoices,
      monthRevenue: Math.round(Number(revenue.total) * 100) / 100,
      upcomingBirths,
      upcomingAppointments,
    });
  } catch (e) {
    next(e);
  }
});

// ---- error handler -------------------------------------------------------
// Nunca devuelve el mensaje de la excepcion: podria traer nombres de tabla,
// rutas de ficheros o fragmentos de datos personales.
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Peticion demasiado grande' });
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'JSON no valido' });
  console.error(err);
  res.status(500).json({ error: 'Error interno' });
});

export default app;
