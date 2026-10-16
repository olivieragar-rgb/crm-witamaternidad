// Sesiones, usuarios y registro de accesos.
//
// La sesión vive en el servidor (tabla sessions) y no en un JWT, por dos
// razones: se puede revocar al instante, que importa cuando hay datos de
// salud y alguien deja el equipo; y deja gratis el registro de accesos que
// exige el RGPD.
import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { all, get, run } from './db.js';
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from './passwords.js';
import { parseCookies, setCookie, clearCookie, isSecure } from './security.js';

export const COOKIE = 'crm_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 días
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
const ROLES = new Set(['admin', 'pro']);

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const iso = (d) => new Date(d).toISOString().replace('T', ' ').slice(0, 19);
const now = () => iso(Date.now());

/** Lo que la interfaz puede ver de un usuario: nunca el hash. */
const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  active: !!u.active,
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt,
});

const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
const clientUa = (req) => String(req.headers['user-agent'] || '').slice(0, 300);

// ---- registro de accesos -------------------------------------------------

/** Nunca hace fallar la petición: un registro perdido no debe tumbar la app. */
export async function audit(req, { action, entity = '', entityId = '', detail = '' }) {
  try {
    await run(
      `INSERT INTO audit_log (at, userId, userEmail, action, entity, entityId, detail, ip, userAgent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        now(),
        req.user?.id ?? null,
        req.user?.email ?? '',
        action,
        entity,
        String(entityId),
        detail,
        clientIp(req),
        clientUa(req),
      ],
    );
  } catch (e) {
    console.error('audit_log', e.message);
  }
}

// ---- sesiones ------------------------------------------------------------

async function createSession(req, res, userId) {
  const token = randomBytes(32).toString('base64url');
  await run(
    `INSERT INTO sessions (tokenHash, userId, createdAt, expiresAt, lastSeenAt, ip, userAgent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [sha256(token), userId, now(), iso(Date.now() + SESSION_MS), now(), clientIp(req), clientUa(req)],
  );
  setCookie(res, COOKIE, token, { maxAge: SESSION_MS, secure: isSecure(req) });
}

async function sessionUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = await get(
    `SELECT s.id AS sessionId, s.expiresAt, u.*
     FROM sessions s JOIN users u ON u.id = s.userId
     WHERE s.tokenHash = ?`,
    [sha256(token)],
  );
  if (!row) return null;
  if (row.expiresAt <= now()) {
    await run('DELETE FROM sessions WHERE id = ?', [row.sessionId]);
    return null;
  }
  if (!row.active) return null;
  return row;
}

export async function hasUsers() {
  return (await get('SELECT COUNT(*) AS n FROM users')).n > 0;
}

// ---- middleware ----------------------------------------------------------

/** Deja req.user puesto si hay sesión válida. No rechaza nada. */
export async function attachUser(req, res, next) {
  try {
    const row = await sessionUser(req);
    if (row) {
      req.user = publicUser(row);
      req.sessionId = row.sessionId;
      // Renovar la ventana de la sesión mientras se usa.
      await run('UPDATE sessions SET lastSeenAt = ?, expiresAt = ? WHERE id = ?', [
        now(),
        iso(Date.now() + SESSION_MS),
        row.sessionId,
      ]);
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Tu sesión ha caducado. Vuelve a entrar.' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Tu sesión ha caducado. Vuelve a entrar.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Esto es solo para administradoras' });
  next();
}

// ---- rutas ---------------------------------------------------------------

export const authRouter = express.Router();

authRouter.get('/setup-status', async (req, res, next) => {
  try {
    res.json({ needsSetup: !(await hasUsers()) });
  } catch (e) {
    next(e);
  }
});

// Crear la primera cuenta. Deja de responder en cuanto existe un usuario, así
// no se despliega nunca una contraseña por defecto.
authRouter.post('/auth/setup', async (req, res, next) => {
  try {
    if (await hasUsers()) return res.status(409).json({ error: 'Ya existe una cuenta' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');
    if (!email || !name) return res.status(400).json({ error: 'Faltan el nombre o el email' });
    const passwordHash = await hashPassword(password);
    const info = await run(
      "INSERT INTO users (email, name, role, passwordHash, active, lastLoginAt) VALUES (?, ?, 'admin', ?, 1, ?)",
      [email, name, passwordHash, now()],
    );
    await createSession(req, res, info.lastInsertRowid);
    const user = publicUser(await get('SELECT * FROM users WHERE id = ?', [info.lastInsertRowid]));
    req.user = user;
    await audit(req, { action: 'setup', entity: 'users', entityId: user.id });
    res.status(201).json(user);
  } catch (e) {
    if (e.code === 'WEAK_PASSWORD') return res.status(400).json({ error: e.message });
    next(e);
  }
});

authRouter.post('/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    // Mismo mensaje para "no existe" y "contraseña incorrecta": si no, la
    // pantalla de login se convierte en una forma de averiguar qué cuentas hay.
    const fail = () => res.status(401).json({ error: 'Email o contraseña incorrectos' });

    const user = await get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !user.active) {
      await audit(req, { action: 'login_fail', entity: 'users', detail: email });
      return fail();
    }
    if (user.lockedUntil && user.lockedUntil > now()) {
      await audit(req, { action: 'login_locked', entity: 'users', entityId: user.id });
      return res.status(429).json({ error: 'Demasiados intentos. Prueba de nuevo en unos minutos.' });
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      const failed = Number(user.failedAttempts) + 1;
      // El contador vive en la base de datos, no en memoria: en serverless
      // cada petición puede caer en una instancia distinta.
      await run('UPDATE users SET failedAttempts = ?, lockedUntil = ? WHERE id = ?', [
        failed,
        failed >= MAX_FAILED ? iso(Date.now() + LOCK_MS) : null,
        user.id,
      ]);
      await audit(req, { action: 'login_fail', entity: 'users', entityId: user.id, detail: `intento ${failed}` });
      return fail();
    }

    await run('UPDATE users SET failedAttempts = 0, lockedUntil = NULL, lastLoginAt = ? WHERE id = ?', [
      now(),
      user.id,
    ]);
    await createSession(req, res, user.id);
    req.user = publicUser(user);
    await audit(req, { action: 'login', entity: 'users', entityId: user.id });
    res.json(req.user);
  } catch (e) {
    next(e);
  }
});

authRouter.post('/auth/logout', async (req, res, next) => {
  try {
    if (req.sessionId) await run('DELETE FROM sessions WHERE id = ?', [req.sessionId]);
    if (req.user) await audit(req, { action: 'logout', entity: 'users', entityId: req.user.id });
    clearCookie(res, COOKIE, { secure: isSecure(req) });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

authRouter.get('/auth/me', requireAuth, (req, res) => res.json(req.user));

authRouter.post('/auth/password', requireAuth, async (req, res, next) => {
  try {
    const current = String(req.body?.current || '');
    const next_ = String(req.body?.next || '');
    const user = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!(await verifyPassword(current, user.passwordHash))) {
      return res.status(400).json({ error: 'La contraseña actual no es correcta' });
    }
    await run('UPDATE users SET passwordHash = ? WHERE id = ?', [await hashPassword(next_), user.id]);
    // Cambiar la contraseña cierra las demás sesiones: es lo que se espera
    // cuando se cambia porque alguien ha podido entrar.
    await run('DELETE FROM sessions WHERE userId = ? AND id != ?', [user.id, req.sessionId]);
    await audit(req, { action: 'password_change', entity: 'users', entityId: user.id });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'WEAK_PASSWORD') return res.status(400).json({ error: e.message });
    next(e);
  }
});

// ---- gestión de usuarios (admin) ----------------------------------------

export const usersRouter = express.Router();
usersRouter.use(requireAdmin);

usersRouter.get('/', async (req, res, next) => {
  try {
    res.json((await all('SELECT * FROM users ORDER BY name')).map(publicUser));
  } catch (e) {
    next(e);
  }
});

usersRouter.post('/', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();
    const role = ROLES.has(req.body?.role) ? req.body.role : 'pro';
    if (!email || !name) return res.status(400).json({ error: 'Faltan el nombre o el email' });
    if (await get('SELECT id FROM users WHERE email = ?', [email])) {
      return res.status(409).json({ error: 'Ya hay una cuenta con ese email' });
    }
    const passwordHash = await hashPassword(String(req.body?.password || ''));
    const info = await run(
      'INSERT INTO users (email, name, role, passwordHash, active) VALUES (?, ?, ?, ?, 1)',
      [email, name, role, passwordHash],
    );
    await audit(req, { action: 'user_create', entity: 'users', entityId: info.lastInsertRowid, detail: email });
    res.status(201).json(publicUser(await get('SELECT * FROM users WHERE id = ?', [info.lastInsertRowid])));
  } catch (e) {
    if (e.code === 'WEAK_PASSWORD') return res.status(400).json({ error: e.message });
    next(e);
  }
});

const countActiveAdmins = async () =>
  (await get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1")).n;

usersRouter.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const user = await get('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: 'No encontrado' });

    const name = req.body?.name !== undefined ? String(req.body.name).trim() : user.name;
    const role = ROLES.has(req.body?.role) ? req.body.role : user.role;
    const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : user.active;

    // No dejar el sistema sin ninguna administradora activa: quedaría cerrado
    // sin forma de volver a entrar a los ajustes ni a los usuarios.
    const losingAdmin = user.role === 'admin' && user.active && (role !== 'admin' || !active);
    if (losingAdmin && (await countActiveAdmins()) <= 1) {
      return res.status(409).json({ error: 'Tiene que quedar al menos una administradora activa' });
    }

    await run('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?', [name, role, active, id]);
    if (!active) await run('DELETE FROM sessions WHERE userId = ?', [id]);
    if (req.body?.password) {
      await run('UPDATE users SET passwordHash = ? WHERE id = ?', [await hashPassword(String(req.body.password)), id]);
      await run('DELETE FROM sessions WHERE userId = ?', [id]);
    }
    await audit(req, { action: 'user_update', entity: 'users', entityId: id });
    res.json(publicUser(await get('SELECT * FROM users WHERE id = ?', [id])));
  } catch (e) {
    if (e.code === 'WEAK_PASSWORD') return res.status(400).json({ error: e.message });
    next(e);
  }
});

usersRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(409).json({ error: 'No puedes borrar tu propia cuenta' });
    const user = await get('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: 'No encontrado' });
    if (user.role === 'admin' && user.active && (await countActiveAdmins()) <= 1) {
      return res.status(409).json({ error: 'Tiene que quedar al menos una administradora activa' });
    }
    await run('DELETE FROM sessions WHERE userId = ?', [id]);
    await run('DELETE FROM users WHERE id = ?', [id]);
    await audit(req, { action: 'user_delete', entity: 'users', entityId: id, detail: user.email });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export { MIN_PASSWORD_LENGTH };
