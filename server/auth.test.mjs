import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, makeClient } from './test-helpers.mjs';

const tmp = useTempDb(); // antes de importar app.js
const { hashPassword, verifyPassword } = await import('./passwords.js');

const PW = 'contrasena-larga-1';

let srv;
let admin; // cliente con la sesión de la administradora
let db;

before(async () => {
  srv = await startServer();
  admin = srv.client;
  db = await import('./db.js');
});
after(async () => {
  srv.close();
  await tmp.cleanup();
});

// Un cliente nuevo = un navegador nuevo, sin cookie.
const browser = () => makeClient(srv.base);

test('hashPassword / verifyPassword', async () => {
  const hash = await hashPassword(PW);
  assert.match(hash, /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(await verifyPassword(PW, hash), true);
  assert.equal(await verifyPassword('otra-cosa-larga', hash), false);
  // Un hash corrupto devuelve false en lugar de lanzar: una fila mal guardada
  // no debe convertirse en un 500.
  assert.equal(await verifyPassword(PW, 'basura'), false);
  assert.equal(await verifyPassword(PW, ''), false);
});

test('rechaza contrasenas cortas', async () => {
  await assert.rejects(() => hashPassword('corta'), /al menos 10/);
});

test('la API esta cerrada sin sesion', async () => {
  const anon = browser();
  for (const path of ['/api/clients', '/api/invoices', '/api/dashboard', '/api/appointments', '/api/services']) {
    assert.equal((await anon.get(path)).status, 401, `${path} deberia pedir sesion`);
  }
  assert.equal((await anon.post('/api/clients', { name: 'X' })).status, 401);
  assert.equal((await anon.del('/api/clients/1')).status, 401);
});

test('setup crea la primera cuenta y abre sesion', async () => {
  assert.deepEqual((await admin.get('/api/setup-status')).data, { needsSetup: true });

  const res = await admin.post('/api/auth/setup', { email: 'Admin@Example.com', name: 'Admin', password: PW });
  assert.equal(res.status, 201);
  assert.equal(res.data.role, 'admin');
  assert.equal(res.data.email, 'admin@example.com', 'el email se normaliza a minusculas');
  assert.equal(res.data.passwordHash, undefined, 'el hash no sale nunca a la interfaz');

  assert.deepEqual((await admin.get('/api/setup-status')).data, { needsSetup: false });
  assert.equal((await admin.get('/api/clients')).status, 200, 'con sesion ya se puede entrar');
});

test('setup ya no responde cuando existe una cuenta', async () => {
  const res = await browser().post('/api/auth/setup', { email: 'otra@example.com', name: 'Otra', password: PW });
  assert.equal(res.status, 409);
});

test('login correcto', async () => {
  const c = browser();
  const ok = await c.post('/api/auth/login', { email: 'admin@example.com', password: PW });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.name, 'Admin');
  assert.equal((await c.get('/api/auth/me')).data.email, 'admin@example.com');
});

test('la cookie de sesion es HttpOnly y SameSite=Lax', async () => {
  const c = browser();
  const res = await c.post('/api/auth/login', { email: 'admin@example.com', password: PW });
  const cookie = res.headers.getSetCookie().find((h) => h.startsWith('crm_session='));
  assert.ok(cookie, 'deberia venir la cookie de sesion');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
});

test('login erroneo no revela que cuentas existen, y bloquea al quinto fallo', async () => {
  await db.run('UPDATE users SET failedAttempts = 0, lockedUntil = NULL');
  const c = browser();

  const noUser = await c.post('/api/auth/login', { email: 'nadie@example.com', password: PW });
  const badPw = await c.post('/api/auth/login', { email: 'admin@example.com', password: 'mala-pero-larga' });
  assert.equal(noUser.status, 401);
  assert.equal(badPw.status, 401);
  assert.deepEqual(noUser.data, badPw.data, 'mismo mensaje en los dos casos');

  // Ya va 1 fallo contra la cuenta; cuatro mas llegan a cinco.
  for (let i = 0; i < 4; i++) {
    await c.post('/api/auth/login', { email: 'admin@example.com', password: 'mala-pero-larga' });
  }
  const locked = await c.post('/api/auth/login', { email: 'admin@example.com', password: PW });
  assert.equal(locked.status, 429, 'bloqueado aunque la contrasena sea la correcta');

  await db.run('UPDATE users SET failedAttempts = 0, lockedUntil = NULL');
});

test('un pro trabaja pero no gestiona usuarios', async () => {
  const created = await admin.post('/api/users', {
    email: 'pro@example.com',
    name: 'Pro',
    role: 'pro',
    password: PW,
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.role, 'pro');

  const pro = browser();
  assert.equal((await pro.post('/api/auth/login', { email: 'pro@example.com', password: PW })).status, 200);
  assert.equal((await pro.get('/api/clients')).status, 200, 'un pro si trabaja con clientas');
  assert.equal((await pro.get('/api/users')).status, 403, 'pero no ve los usuarios');
  assert.equal((await pro.post('/api/users', { email: 'x@y.es', name: 'X', password: PW })).status, 403);
  assert.equal((await pro.del('/api/users/1')).status, 403);
});

test('un rol inventado cae a pro', async () => {
  const res = await admin.post('/api/users', {
    email: 'root@example.com',
    name: 'Root',
    role: 'superadmin',
    password: PW,
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.role, 'pro', 'solo existen admin y pro');
});

test('no se admiten dos cuentas con el mismo email', async () => {
  const res = await admin.post('/api/users', { email: 'pro@example.com', name: 'Otra', password: PW });
  assert.equal(res.status, 409);
});

test('no se puede quedar sin administradora activa', async () => {
  const me = (await admin.get('/api/auth/me')).data;
  const demote = await admin.put(`/api/users/${me.id}`, { role: 'pro' });
  assert.equal(demote.status, 409);
  assert.match(demote.data.error, /al menos una administradora/);

  assert.equal((await admin.put(`/api/users/${me.id}`, { active: false })).status, 409);
  assert.equal((await admin.del(`/api/users/${me.id}`)).status, 409, 'ni borrarse a si misma');
});

test('desactivar a alguien cierra sus sesiones', async () => {
  const pro = browser();
  await pro.post('/api/auth/login', { email: 'pro@example.com', password: PW });
  assert.equal((await pro.get('/api/clients')).status, 200);

  const list = (await admin.get('/api/users')).data;
  const proUser = list.find((u) => u.email === 'pro@example.com');
  assert.equal((await admin.put(`/api/users/${proUser.id}`, { active: false })).status, 200);

  assert.equal((await pro.get('/api/clients')).status, 401, 'la sesion deja de valer al momento');
});

test('cambiar la contrasena exige la actual y cierra las demas sesiones', async () => {
  const uno = browser();
  const dos = browser();
  await uno.post('/api/auth/login', { email: 'admin@example.com', password: PW });
  await dos.post('/api/auth/login', { email: 'admin@example.com', password: PW });

  assert.equal((await uno.post('/api/auth/password', { current: 'lo-que-sea', next: 'nueva-larga-1' })).status, 400);

  const NEW = 'nueva-contrasena-1';
  assert.equal((await uno.post('/api/auth/password', { current: PW, next: NEW })).status, 200);
  assert.equal((await uno.get('/api/clients')).status, 200, 'la sesion que lo cambio sigue viva');
  assert.equal((await dos.get('/api/clients')).status, 401, 'las demas se cierran');

  // Dejarlo como estaba para las pruebas siguientes.
  assert.equal((await uno.post('/api/auth/password', { current: NEW, next: PW })).status, 200);
});

test('rechaza una peticion con Origin de otro sitio', async () => {
  const res = await fetch(`${srv.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://sitio-falso.example' },
    body: JSON.stringify({ email: 'admin@example.com', password: PW }),
  });
  assert.equal(res.status, 403);
});

test('admite el Origin de otro puerto del propio equipo (proxy de Vite)', async () => {
  // En desarrollo la web va por :5173 y la API por :3001. Una pagina de un
  // atacante no puede tener un Origin de localhost, asi que no abre nada.
  const res = await fetch(`${srv.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ email: 'admin@example.com', password: PW }),
  });
  assert.equal(res.status, 200);
});

test('cabeceras de seguridad en la respuesta', async () => {
  const res = await fetch(`${srv.base}/api/setup-status`);
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('cache-control'), 'no-store', 'las respuestas con datos no se cachean');
  assert.equal(res.headers.get('x-powered-by'), null, 'sin delatar el servidor');
});

test('JSON mal formado da 400, no 500', async () => {
  const res = await fetch(`${srv.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{roto',
  });
  assert.equal(res.status, 400);
});

test('logout invalida la sesion', async () => {
  const c = browser();
  await c.post('/api/auth/login', { email: 'admin@example.com', password: PW });
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await c.get('/api/clients')).status, 401);
});

test('el registro de accesos guarda entradas, fallos y cambios', async () => {
  const actions = (await db.all('SELECT action FROM audit_log')).map((r) => r.action);
  for (const expected of [
    'setup',
    'login',
    'login_fail',
    'login_locked',
    'logout',
    'user_create',
    'user_update',
    'password_change',
  ]) {
    assert.ok(actions.includes(expected), `falta "${expected}" en audit_log`);
  }
  // Y guarda quien lo hizo.
  const row = await db.get("SELECT userEmail, ip FROM audit_log WHERE action = 'user_create' LIMIT 1");
  assert.equal(row.userEmail, 'admin@example.com');
});
