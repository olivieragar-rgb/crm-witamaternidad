// Recordatorios de cobro y de cita.
//
// Nada se envía solo. Un correo automático a una mujer recién parida por una
// factura de 60 € pide mucho tacto, así que el sistema avisa a la profesional
// y es ella quien decide y confirma cada envío.
import express from 'express';
import { all, get, run } from './db.js';
import { audit } from './auth.js';
import { getSetting } from './settings.js';
import { sendMail } from './mailer.js';
import { invoiceWithItems } from './invoices.js';

const today = () => new Date().toISOString().slice(0, 10);
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

/** Sustituye {{marcador}} por su valor; lo que no reconozca queda vacío. */
export const fill = (text, vars) =>
  String(text || '').replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ''));

const wrap = (body, footer) =>
  `<div style="font-family:Arial,sans-serif;color:#2e2a25;max-width:600px;line-height:1.6">` +
  body
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => `<p>${esc(l)}</p>`)
    .join('') +
  (footer ? `<p style="color:#9c9489;font-size:12px">${esc(footer)}</p>` : '') +
  `</div>`;

export const remindersRouter = express.Router();

// ---- qué hay pendiente ---------------------------------------------------

/**
 * Lo que requiere atención hoy: facturas vencidas o sin vencimiento que
 * llevan tiempo sin cobrar, y citas de los próximos días.
 */
remindersRouter.get('/', async (req, res, next) => {
  try {
    const { graceDays, appointmentDaysAhead } = await getSetting('reminders');
    const hoy = today();

    const unpaid = await all(
      `SELECT i.id, i.number, i.date, i.dueDate, i.status, i.remindedAt,
              c.name AS clientName, c.email AS clientEmail,
              COALESCE(SUM(it.qty * it.price * (1 - it.discount / 100.0) * (1 + it.vat / 100.0)), 0) AS total
       FROM invoices i
       LEFT JOIN clients c ON c.id = i.clientId
       LEFT JOIN invoice_items it ON it.invoiceId = i.id
       WHERE i.status IN ('Emitida', 'Enviada')
       GROUP BY i.id
       ORDER BY COALESCE(NULLIF(i.dueDate, ''), i.date)`,
    );

    // Sin vencimiento explícito se usa la fecha de factura más los días de
    // cortesía: si no, una factura sin vencimiento no vencería nunca.
    const overdue = [];
    for (const inv of unpaid) {
      const limit = inv.dueDate || addDays(inv.date, Number(graceDays) || 0);
      if (!limit || limit >= hoy) continue;
      overdue.push({ ...inv, limit, daysLate: daysBetween(limit, hoy) });
    }

    const ahead = addDays(hoy, Number(appointmentDaysAhead) || 2);
    const appointments = await all(
      `SELECT a.id, a.date, a.mode, a.status, a.remindedAt,
              c.name AS clientName, c.email AS clientEmail, s.name AS serviceName
       FROM appointments a
       LEFT JOIN clients c ON c.id = a.clientId
       LEFT JOIN services s ON s.id = a.serviceId
       WHERE a.status = 'Programada' AND substr(a.date, 1, 10) >= ? AND substr(a.date, 1, 10) <= ?
       ORDER BY a.date`,
      [hoy, ahead],
    );

    res.json({ overdue, appointments, config: { graceDays, appointmentDaysAhead } });
  } catch (e) {
    next(e);
  }
});

function addDays(iso, days) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const daysBetween = (from, to) =>
  Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);

// ---- enviar --------------------------------------------------------------

/** Recordatorio de pago de una factura. Lo dispara una persona, nunca un reloj. */
remindersRouter.post('/invoice/:id', async (req, res, next) => {
  try {
    const inv = await invoiceWithItems(Number(req.params.id));
    if (!inv) return res.status(404).json({ error: 'No encontrada' });
    if (!['Emitida', 'Enviada'].includes(inv.status)) {
      return res.status(409).json({ error: 'Esa factura no está pendiente de cobro.' });
    }
    const client = inv.clientId ? await get('SELECT email FROM clients WHERE id = ?', [inv.clientId]) : null;
    const to = (client?.email || '').trim();
    if (!to) return res.status(400).json({ error: 'La clienta no tiene email en su ficha.' });

    const tpl = await getSetting('reminders');
    const brand = await getSetting('brand');
    const issuer = await getSetting('issuer');
    const vars = {
      clienta: inv.client?.name || '',
      numero: inv.number,
      fecha: inv.date,
      vencimiento: inv.dueDate || inv.date,
      total: `${inv.totals.total.toFixed(2)} €`,
      negocio: issuer.name || brand.name,
    };

    await sendMail({
      to,
      subject: fill(tpl.invoiceSubject, vars),
      html: wrap(fill(tpl.invoiceBody, vars), issuer.name || brand.name),
    });
    await run("UPDATE invoices SET remindedAt = ? WHERE id = ?", [today(), inv.id]);
    await audit(req, { action: 'remind_invoice', entity: 'invoices', entityId: inv.id, detail: to });
    res.json({ ok: true, to });
  } catch (e) {
    if (e.code === 'MAIL_NOT_CONFIGURED') return res.status(400).json({ error: e.message });
    next(e);
  }
});

/** Recordatorio de una cita próxima. */
remindersRouter.post('/appointment/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const appt = await get(
      `SELECT a.*, c.name AS clientName, c.email AS clientEmail, s.name AS serviceName
       FROM appointments a
       LEFT JOIN clients c ON c.id = a.clientId
       LEFT JOIN services s ON s.id = a.serviceId
       WHERE a.id = ?`,
      [id],
    );
    if (!appt) return res.status(404).json({ error: 'No encontrada' });
    const to = (appt.clientEmail || '').trim();
    if (!to) return res.status(400).json({ error: 'La clienta no tiene email en su ficha.' });

    const tpl = await getSetting('reminders');
    const brand = await getSetting('brand');
    const issuer = await getSetting('issuer');
    const [fecha, hora = ''] = String(appt.date || '').split(' ');
    const vars = {
      clienta: appt.clientName || '',
      fecha: fecha.split('-').reverse().join('/'),
      hora: hora.slice(0, 5),
      servicio: appt.serviceName || '',
      modalidad: appt.mode || '',
      negocio: issuer.name || brand.name,
    };

    await sendMail({
      to,
      subject: fill(tpl.appointmentSubject, vars),
      html: wrap(fill(tpl.appointmentBody, vars), issuer.name || brand.name),
    });
    await run("UPDATE appointments SET remindedAt = ? WHERE id = ?", [today(), id]);
    await audit(req, { action: 'remind_appointment', entity: 'appointments', entityId: id, detail: to });
    res.json({ ok: true, to });
  } catch (e) {
    if (e.code === 'MAIL_NOT_CONFIGURED') return res.status(400).json({ error: e.message });
    next(e);
  }
});

/** Vista previa del texto, para poder leerlo antes de mandarlo. */
remindersRouter.get('/preview/:kind/:id', async (req, res, next) => {
  try {
    const tpl = await getSetting('reminders');
    const brand = await getSetting('brand');
    const issuer = await getSetting('issuer');
    const negocio = issuer.name || brand.name;

    if (req.params.kind === 'invoice') {
      const inv = await invoiceWithItems(Number(req.params.id));
      if (!inv) return res.status(404).json({ error: 'No encontrada' });
      const vars = {
        clienta: inv.client?.name || '',
        numero: inv.number,
        fecha: inv.date,
        vencimiento: inv.dueDate || inv.date,
        total: `${inv.totals.total.toFixed(2)} €`,
        negocio,
      };
      return res.json({
        to: inv.clientEmail || '',
        subject: fill(tpl.invoiceSubject, vars),
        body: fill(tpl.invoiceBody, vars),
      });
    }

    const appt = await get(
      `SELECT a.*, c.name AS clientName, c.email AS clientEmail, s.name AS serviceName
       FROM appointments a
       LEFT JOIN clients c ON c.id = a.clientId
       LEFT JOIN services s ON s.id = a.serviceId
       WHERE a.id = ?`,
      [Number(req.params.id)],
    );
    if (!appt) return res.status(404).json({ error: 'No encontrada' });
    const [fecha, hora = ''] = String(appt.date || '').split(' ');
    const vars = {
      clienta: appt.clientName || '',
      fecha: fecha.split('-').reverse().join('/'),
      hora: hora.slice(0, 5),
      servicio: appt.serviceName || '',
      modalidad: appt.mode || '',
      negocio,
    };
    res.json({
      to: appt.clientEmail || '',
      subject: fill(tpl.appointmentSubject, vars),
      body: fill(tpl.appointmentBody, vars),
    });
  } catch (e) {
    next(e);
  }
});

export { addDays, daysBetween };
