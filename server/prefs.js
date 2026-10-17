// Preferencias de cada usuaria: cómo prefiere ver el CRM.
//
// Van en el servidor y no en el navegador para que la acompañen: la misma
// pantalla de Inicio en el ordenador de la consulta y en el móvil. Cada una
// guarda las suyas; no hay preferencias compartidas.
//
// Lo que se lee y lo que se guarda pasa siempre por `sanitize`, así que ni una
// petición mal hecha ni una preferencia vieja pueden dejar la pantalla sin
// poder pintarse.
import express from 'express';
import { get, run } from './db.js';
import { sanitizeDashboard, DEFAULT_DASHBOARD } from '../src/lib/dashboard-layout.js';

/** Qué preferencias existen. Una clave que no esté aquí no se guarda. */
const KINDS = {
  dashboard: { sanitize: sanitizeDashboard, defaults: DEFAULT_DASHBOARD },
};

export const prefsRouter = express.Router();

prefsRouter.use('/:key', (req, res, next) => {
  if (!KINDS[req.params.key]) return res.status(404).json({ error: 'Esa preferencia no existe' });
  next();
});

async function stored(userId, key) {
  const row = await get('SELECT value FROM user_prefs WHERE userId = ? AND key = ?', [userId, key]);
  if (!row) return KINDS[key].defaults;
  try {
    return KINDS[key].sanitize(JSON.parse(row.value));
  } catch {
    return KINDS[key].defaults; // un valor ilegible no debe tumbar la pantalla
  }
}

prefsRouter.get('/:key', async (req, res, next) => {
  try {
    res.json(await stored(req.user.id, req.params.key));
  } catch (e) {
    next(e);
  }
});

prefsRouter.put('/:key', async (req, res, next) => {
  try {
    const { key } = req.params;
    const value = KINDS[key].sanitize(req.body);
    await run(
      `INSERT INTO user_prefs (userId, key, value, updatedAt) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (userId, key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
      [req.user.id, key, JSON.stringify(value)],
    );
    res.json(value);
  } catch (e) {
    next(e);
  }
});

/** Volver a lo de fábrica. */
prefsRouter.delete('/:key', async (req, res, next) => {
  try {
    await run('DELETE FROM user_prefs WHERE userId = ? AND key = ?', [req.user.id, req.params.key]);
    res.json(KINDS[req.params.key].defaults);
  } catch (e) {
    next(e);
  }
});
