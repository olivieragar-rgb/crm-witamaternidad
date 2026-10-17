// Derechos de la clienta sobre sus datos y registro de accesos.
//
// Los datos de embarazo, lactancia y las notas son datos de salud: categoría
// especial del Art. 9 del RGPD, el nivel máximo de protección. De ahí que
// aquí se registre también quién *lee* una ficha, no solo quién la cambia.
import express from 'express';
import { all, get, run } from './db.js';
import { requireAdmin, audit } from './auth.js';
import { getSetting } from './settings.js';
import { clientForms } from './questionnaires.js';
import { labelledSections } from '../src/data/record-sections.js';

/** Campos personales que se vacían al anonimizar. */
const PERSONAL = [
  'email',
  'phone',
  'dueDate',
  'notes',
  'taxId',
  'address',
  'postalCode',
  'city',
  'province',
  'babySex',
  'babyBirthDate',
];

export const privacyRouter = express.Router();

// ---- derecho de acceso y portabilidad ------------------------------------

async function fullClientData(id) {
  const client = await get('SELECT * FROM clients WHERE id = ?', [id]);
  if (!client) return null;
  const appointments = await all(
    `SELECT a.date, a.mode, a.status, a.notes, s.name AS service
     FROM appointments a LEFT JOIN services s ON s.id = a.serviceId
     WHERE a.clientId = ? ORDER BY a.date`,
    [id],
  );
  const invoices = await all(
    'SELECT number, date, status, paidAt FROM invoices WHERE clientId = ? ORDER BY date',
    [id],
  );
  // Los cuestionarios de alta son el dato de salud mas detallado que hay
  // aqui: sin ellos el export no es el expediente completo.
  const cuestionarios = await clientForms(id);
  // Las secciones de la ficha y las notas son el expediente escrito: sin ellas
  // el export no es completo.
  const secciones = labelledSections(await all('SELECT * FROM client_sections WHERE clientId = ?', [id]));
  const notas = await all('SELECT createdAt, author, text FROM client_notes WHERE clientId = ? ORDER BY createdAt', [id]);
  return { client, appointments, invoices, cuestionarios, secciones, notas };
}

/**
 * Todo lo que el sistema guarda sobre una clienta, en un formato que se puede
 * leer y llevarse a otro sitio. Es el derecho de acceso y portabilidad.
 */
privacyRouter.get('/:id/export', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = await fullClientData(id);
    if (!data) return res.status(404).json({ error: 'No encontrada' });
    await audit(req, { action: 'client_export', entity: 'clients', entityId: id });
    res.setHeader('Content-Disposition', `attachment; filename="datos-clienta-${id}.json"`);
    res.json({
      generadoEl: new Date().toISOString(),
      responsable: await getSetting('issuer'),
      ...data,
    });
  } catch (e) {
    next(e);
  }
});

// ---- derecho de supresión ------------------------------------------------

/**
 * Anonimiza la ficha en lugar de borrarla.
 *
 * Es el punto delicado del bloque: el RGPD reconoce el derecho al olvido,
 * pero Hacienda obliga a conservar las facturas. Se resuelve vaciando los
 * datos personales de la ficha y dejando intacto el documento fiscal, que
 * guarda su propia copia de los datos de la clienta en el momento de emitir.
 */
privacyRouter.post('/:id/anonymize', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const client = await get('SELECT * FROM clients WHERE id = ?', [id]);
    if (!client) return res.status(404).json({ error: 'No encontrada' });
    if (client.anonymizedAt) return res.status(409).json({ error: 'Esta ficha ya está anonimizada' });

    // Antes de vaciar nada: asegurarse de que cada factura suya tiene su copia
    // fiscal. Las emitidas por versiones anteriores del CRM no la tienen y
    // reconstruian los datos leyendo la ficha, asi que anonimizar sin esto les
    // borraria el nombre y el NIF y dejaria de ser facturas validas.
    await backfillInvoiceSnapshots(id);

    const sets = PERSONAL.map((f) => `${f} = ''`).join(', ');
    await run(
      `UPDATE clients SET name = ?, ${sets}, anonymizedAt = ?, consentAt = '', consentChannel = ''
       WHERE id = ?`,
      [`Clienta anonimizada #${id}`, new Date().toISOString().slice(0, 10), id],
    );
    // Las citas guardan notas de seguimiento, que también son datos de salud.
    await run("UPDATE appointments SET notes = '' WHERE clientId = ?", [id]);
    // Y el cuestionario entero, que es dato de salud de principio a fin: aquí
    // no hay nada que conservar, al contrario que en las facturas.
    await run('DELETE FROM client_forms WHERE clientId = ?', [id]);
    await run('DELETE FROM consent_signatures WHERE clientId = ?', [id]);
    // Las notas de la ficha y los pesos del bebé también son datos de salud.
    await run('DELETE FROM client_notes WHERE clientId = ?', [id]);
    await run('DELETE FROM client_sections WHERE clientId = ?', [id]);
    await run('UPDATE appointments SET babyWeightKg = 0 WHERE clientId = ?', [id]);

    await audit(req, {
      action: 'client_anonymize',
      entity: 'clients',
      entityId: id,
      detail: String(req.body?.reason || ''),
    });
    res.json(await get('SELECT * FROM clients WHERE id = ?', [id]));
  } catch (e) {
    next(e);
  }
});

/**
 * Rellena la copia de datos fiscales de las facturas de una clienta que no la
 * tengan. Se hace desde la ficha actual, que es la mejor reconstruccion
 * posible, y solo para facturas ya emitidas: un borrador todavia no es una
 * factura.
 */
export async function backfillInvoiceSnapshots(clientId) {
  const pendientes = await all(
    `SELECT id FROM invoices
     WHERE clientId = ? AND clientSnapshot = '' AND seq IS NOT NULL`,
    [clientId],
  );
  if (pendientes.length === 0) return 0;

  const client = await get(
    'SELECT name, taxId, address, postalCode, city, province, country, email FROM clients WHERE id = ?',
    [clientId],
  );
  const issuer = await getSetting('issuer');
  for (const inv of pendientes) {
    await run(
      `UPDATE invoices SET clientSnapshot = ?,
         issuerSnapshot = CASE WHEN issuerSnapshot = '' THEN ? ELSE issuerSnapshot END
       WHERE id = ?`,
      [JSON.stringify(client), JSON.stringify(issuer), inv.id],
    );
  }
  return pendientes.length;
}

// ---- conservación --------------------------------------------------------

/**
 * Fichas sin actividad por encima del plazo de conservación. No se borra nada
 * automáticamente: el listado propone y la decisión es siempre de una
 * persona.
 */
privacyRouter.get('/retention', async (req, res, next) => {
  try {
    const { retentionYears } = await getSetting('privacy');
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - Number(retentionYears || 5));
    const limit = cutoff.toISOString().slice(0, 10);

    // "Actividad" es lo más reciente entre el alta, su última cita y su
    // última factura: una ficha vieja con una factura de este año no está
    // inactiva.
    const rows = await all(
      `SELECT c.id, c.name, c.createdAt, c.anonymizedAt,
              MAX(COALESCE(substr(a.date, 1, 10), ''))  AS lastAppointment,
              MAX(COALESCE(i.date, ''))                 AS lastInvoice
       FROM clients c
       LEFT JOIN appointments a ON a.clientId = c.id
       LEFT JOIN invoices i ON i.clientId = c.id
       WHERE c.anonymizedAt IS NULL OR c.anonymizedAt = ''
       GROUP BY c.id
       ORDER BY c.name`,
    );
    const stale = rows
      .map((r) => ({
        id: r.id,
        name: r.name,
        lastActivity: [String(r.createdAt || '').slice(0, 10), r.lastAppointment, r.lastInvoice]
          .filter(Boolean)
          .sort()
          .pop(),
      }))
      .filter((r) => r.lastActivity && r.lastActivity < limit);

    res.json({ retentionYears: Number(retentionYears || 5), cutoff: limit, rows: stale });
  } catch (e) {
    next(e);
  }
});

// ---- registro de accesos (solo admin) ------------------------------------

export const auditRouter = express.Router();
auditRouter.use(requireAdmin);

auditRouter.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const where = [];
    const args = [];
    if (req.query.entity) {
      where.push('entity = ?');
      args.push(String(req.query.entity));
    }
    if (req.query.action) {
      where.push('action = ?');
      args.push(String(req.query.action));
    }
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (await get(`SELECT COUNT(*) AS n FROM audit_log ${filter}`, args)).n;
    const rows = await all(
      `SELECT id, at, userEmail, action, entity, entityId, detail, ip
       FROM audit_log ${filter} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize],
    );
    res.json({ rows, total, page, pageSize });
  } catch (e) {
    next(e);
  }
});
