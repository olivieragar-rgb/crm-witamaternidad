// Cuestionarios de alta de la clienta.
//
// Las respuestas son datos de salud del Art. 9 del RGPD: de lo mas detallado
// que guarda el CRM. De ahi que aqui se audite tambien la lectura, y no solo
// el cambio, igual que en el resto de la ficha.
import express from 'express';
import { all, get, run } from './db.js';
import { audit } from './auth.js';
import { QUESTIONNAIRES, computeStatus, sanitize, labelled } from '../src/data/questionnaires.js';

export const questionnairesRouter = express.Router();

/** Lo guardado de un tipo, o el hueco vacio si no hay nada todavia. */
async function readForm(clientId, kind) {
  const row = await get(
    'SELECT data, status, updatedAt FROM client_forms WHERE clientId = ? AND kind = ?',
    [clientId, kind],
  );
  if (!row) return { kind, data: {}, status: 'pendiente', updatedAt: '' };
  return { kind, data: JSON.parse(row.data), status: row.status, updatedAt: row.updatedAt };
}

/**
 * Resumen de todos los cuestionarios, agrupados por clienta. El listado lo
 * necesita para marcar los pendientes, y asi lo resuelve con una peticion en
 * vez de una por fila.
 *
 * Va antes de /:id/form: si no, "forms" se leeria como un identificador.
 */
questionnairesRouter.get('/forms', async (req, res, next) => {
  try {
    const rows = await all('SELECT clientId, kind, status FROM client_forms ORDER BY clientId, kind');
    /** @type {Record<string, Array<{ kind: string, status: string }>>} */
    const out = {};
    for (const r of rows) {
      (out[r.clientId] ??= []).push({ kind: r.kind, status: r.status });
    }
    await audit(req, { action: 'client_form_list', entity: 'client_forms' });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

questionnairesRouter.get('/:id/form', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const kind = String(req.query.kind || '');
    if (!Object.hasOwn(QUESTIONNAIRES, kind)) {
      return res.status(400).json({ error: 'Cuestionario desconocido' });
    }
    if (!(await get('SELECT id FROM clients WHERE id = ?', [id]))) {
      return res.status(404).json({ error: 'No encontrada' });
    }
    await audit(req, { action: 'client_form_view', entity: 'client_forms', entityId: id, detail: kind });
    res.json(await readForm(id, kind));
  } catch (e) {
    next(e);
  }
});

questionnairesRouter.put('/:id/form', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const kind = String(req.body?.kind || '');
    if (!Object.hasOwn(QUESTIONNAIRES, kind)) {
      return res.status(400).json({ error: 'Cuestionario desconocido' });
    }
    const client = await get('SELECT id, anonymizedAt FROM clients WHERE id = ?', [id]);
    if (!client) return res.status(404).json({ error: 'No encontrada' });
    // Una ficha anonimizada perdio sus datos personales porque la clienta lo
    // pidio. Volver a meterle datos de salud deshace ese derecho.
    if (client.anonymizedAt) {
      return res.status(409).json({ error: 'Esta ficha está anonimizada: no se le pueden añadir datos' });
    }

    // El estado lo decide el servidor, no el cliente: es la definicion del
    // cuestionario la que dice que es obligatorio.
    const data = sanitize(kind, req.body?.data ?? {});
    const status = computeStatus(kind, data);
    await run(
      `INSERT INTO client_forms (clientId, kind, data, status) VALUES (?, ?, ?, ?)
       ON CONFLICT (clientId, kind) DO UPDATE
         SET data = excluded.data, status = excluded.status, updatedAt = datetime('now')`,
      [id, kind, JSON.stringify(data), status],
    );
    await audit(req, {
      action: 'client_form_update',
      entity: 'client_forms',
      entityId: id,
      detail: `${kind}: ${status}`,
    });
    res.json(await readForm(id, kind));
  } catch (e) {
    next(e);
  }
});

/**
 * Los cuestionarios de una clienta con las preguntas en texto legible, para
 * el export del derecho de acceso.
 */
export async function clientForms(clientId) {
  const rows = await all(
    'SELECT kind, data, status, updatedAt FROM client_forms WHERE clientId = ? ORDER BY kind',
    [clientId],
  );
  return rows.map((r) => ({
    cuestionario: QUESTIONNAIRES[r.kind]?.label ?? r.kind,
    estado: r.status,
    actualizadoEl: r.updatedAt,
    respuestas: labelled(r.kind, JSON.parse(r.data)),
  }));
}
