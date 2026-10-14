// Catálogos: las listas desplegables que antes eran constantes en el código
// (servicios, modalidades, estados, formas de pago). Pasarlas a datos es lo
// que permite adaptar el CRM a otro negocio sin tocar una línea.
import express from 'express';
import { all, get, run } from './db.js';
import { requireAdmin, audit } from './auth.js';

/** @type {Record<string, { label: string, defaults: string[] }>} */
export const TYPES = {
  clientService: {
    label: 'Servicios que ofreces (en la ficha de clienta)',
    defaults: ['Hipnoparto / Preparación al parto', 'Lactancia', 'Consulta online', 'Otro'],
  },
  mode: { label: 'Modalidades', defaults: ['Presencial (Granada)', 'Online'] },
  clientStatus: { label: 'Estados de clienta', defaults: ['Nuevo contacto', 'Activa', 'Finalizada'] },
  appointmentStatus: { label: 'Estados de cita', defaults: ['Programada', 'Realizada', 'Cancelada'] },
  consentChannel: {
    label: 'Canales de consentimiento',
    defaults: ['Presencial', 'Email', 'Formulario web', 'Papel firmado'],
  },
  paymentMethod: {
    label: 'Formas de pago',
    defaults: ['Transferencia', 'Bizum', 'Efectivo', 'Tarjeta'],
  },
};

/** Siembra los valores de fábrica de un tipo que todavía no tiene ninguno. */
export async function seedCatalogs() {
  for (const [type, { defaults }] of Object.entries(TYPES)) {
    const n = (await get('SELECT COUNT(*) AS n FROM catalogs WHERE type = ?', [type])).n;
    if (n > 0) continue;
    for (const [i, value] of defaults.entries()) {
      await run('INSERT INTO catalogs (type, value, sortOrder, active) VALUES (?, ?, ?, 1)', [type, value, i]);
    }
  }
}

/** @returns {Promise<Record<string, Array<{id:number,value:string,active:boolean}>>>} */
export async function getCatalogs() {
  const rows = await all('SELECT id, type, value, sortOrder, active FROM catalogs ORDER BY type, sortOrder, id');
  const out = {};
  for (const type of Object.keys(TYPES)) out[type] = [];
  for (const r of rows) {
    if (!out[r.type]) out[r.type] = [];
    out[r.type].push({ id: r.id, value: r.value, active: !!r.active });
  }
  return out;
}

export const catalogsRouter = express.Router();

// Leer los catálogos lo necesita cualquiera para pintar los formularios.
catalogsRouter.get('/', async (req, res, next) => {
  try {
    res.json({
      types: Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [k, v.label])),
      values: await getCatalogs(),
    });
  } catch (e) {
    next(e);
  }
});

catalogsRouter.use(requireAdmin);

catalogsRouter.post('/', async (req, res, next) => {
  try {
    const type = String(req.body?.type || '');
    const value = String(req.body?.value || '').trim();
    if (!Object.hasOwn(TYPES, type)) return res.status(400).json({ error: 'Catálogo desconocido' });
    if (!value) return res.status(400).json({ error: 'El valor no puede estar vacío' });
    if (await get('SELECT id FROM catalogs WHERE type = ? AND value = ?', [type, value])) {
      return res.status(409).json({ error: 'Ese valor ya está en la lista' });
    }
    const max = (await get('SELECT MAX(sortOrder) AS m FROM catalogs WHERE type = ?', [type])).m;
    const info = await run('INSERT INTO catalogs (type, value, sortOrder, active) VALUES (?, ?, ?, 1)', [
      type,
      value,
      Number(max || 0) + 1,
    ]);
    await audit(req, { action: 'catalog_create', entity: 'catalogs', entityId: info.lastInsertRowid, detail: `${type}: ${value}` });
    res.status(201).json(await getCatalogs());
  } catch (e) {
    next(e);
  }
});

/**
 * Renombrar un valor o activarlo y desactivarlo.
 *
 * Renombrar NO reescribe los registros que ya lo usaban: una ficha que decía
 * "Lactancia" sigue diciéndolo. Cambiar la lista de opciones no debería
 * reescribir el pasado.
 */
catalogsRouter.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await get('SELECT * FROM catalogs WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    const value = req.body?.value !== undefined ? String(req.body.value).trim() : row.value;
    if (!value) return res.status(400).json({ error: 'El valor no puede estar vacío' });
    const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : row.active;
    const sortOrder = req.body?.sortOrder !== undefined ? Number(req.body.sortOrder) : row.sortOrder;
    await run('UPDATE catalogs SET value = ?, active = ?, sortOrder = ? WHERE id = ?', [
      value,
      active,
      sortOrder,
      id,
    ]);
    await audit(req, { action: 'catalog_update', entity: 'catalogs', entityId: id });
    res.json(await getCatalogs());
  } catch (e) {
    next(e);
  }
});

// Borrar de verdad solo tiene sentido para una opción recién creada por error.
// Lo normal es desactivarla, que la quita de los formularios sin tocar lo ya
// guardado, y por eso la interfaz ofrece desactivar antes que borrar.
catalogsRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const info = await run('DELETE FROM catalogs WHERE id = ?', [id]);
    if (info.changes === 0) return res.status(404).json({ error: 'No encontrado' });
    await audit(req, { action: 'catalog_delete', entity: 'catalogs', entityId: id });
    res.json(await getCatalogs());
  } catch (e) {
    next(e);
  }
});
