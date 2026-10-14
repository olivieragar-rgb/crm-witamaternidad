// Guardia alrededor de la fecha probable de parto.
//
// Un parto no avisa: alrededor de la FPP hay unas semanas de disponibilidad
// permanente. Dos clientas con ventanas solapadas son un conflicto que hay que
// ver ANTES de aceptar a la segunda, no el día que ambas se ponen de parto.
import express from 'express';
import { all } from './db.js';
import { getSetting } from './settings.js';

/** Suma días a una fecha 'YYYY-MM-DD' en UTC, para que no la mueva la zona horaria. */
export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Dos intervalos cerrados se solapan si cada uno empieza antes de que acabe el otro. */
export const overlaps = (a, b) => a.start <= b.end && b.start <= a.end;

/**
 * Ventana de guardia de una clienta.
 * @param {string} dueDate 'YYYY-MM-DD'
 * @param {{weeksBefore:number, weeksAfter:number}} cfg
 */
export function windowFor(dueDate, cfg) {
  if (!dueDate) return null;
  const start = addDays(dueDate, -Math.round(cfg.weeksBefore * 7));
  const end = addDays(dueDate, Math.round(cfg.weeksAfter * 7));
  return start && end ? { start, end } : null;
}

/**
 * Ventanas de todas las clientas con FPP, con las que se solapan marcadas.
 *
 * Las fichas anonimizadas quedan fuera: ya no hay a quién acompañar, y su FPP
 * se vacía al anonimizar.
 */
export async function onCallWindows({ excludeId } = {}) {
  const cfg = await getSetting('oncall');
  const rows = await all(
    `SELECT id, name, dueDate, status FROM clients
     WHERE dueDate <> '' AND (anonymizedAt IS NULL OR anonymizedAt = '')
     ORDER BY dueDate`,
  );
  const windows = [];
  for (const c of rows) {
    if (excludeId && c.id === Number(excludeId)) continue;
    const w = windowFor(c.dueDate, cfg);
    if (w) windows.push({ ...c, ...w, overlapsWith: [] });
  }
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      if (!overlaps(windows[i], windows[j])) continue;
      windows[i].overlapsWith.push({ id: windows[j].id, name: windows[j].name, dueDate: windows[j].dueDate });
      windows[j].overlapsWith.push({ id: windows[i].id, name: windows[i].name, dueDate: windows[i].dueDate });
    }
  }
  return { config: cfg, windows };
}

export const onCallRouter = express.Router();

onCallRouter.get('/', async (req, res, next) => {
  try {
    res.json(await onCallWindows());
  } catch (e) {
    next(e);
  }
});

/**
 * ¿Con quién chocaría una FPP antes de guardarla? Lo usa el formulario de
 * clienta para avisar mientras se escribe, que es cuando sirve de algo.
 */
onCallRouter.get('/conflicts', async (req, res, next) => {
  try {
    const dueDate = String(req.query.dueDate || '');
    const cfg = await getSetting('oncall');
    const candidate = windowFor(dueDate, cfg);
    if (!candidate) return res.json({ window: null, conflicts: [] });

    const { windows } = await onCallWindows({ excludeId: req.query.excludeId });
    const conflicts = windows
      .filter((w) => overlaps(candidate, w))
      .map((w) => ({ id: w.id, name: w.name, dueDate: w.dueDate, start: w.start, end: w.end }));
    res.json({ window: candidate, conflicts });
  } catch (e) {
    next(e);
  }
});
