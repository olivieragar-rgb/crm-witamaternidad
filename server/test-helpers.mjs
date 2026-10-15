// Arranca la API sobre una base de datos temporal y propia de cada fichero de
// pruebas, con un cliente fetch que recuerda la cookie de sesión.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Hay que llamarla ANTES de importar server/app.js: db.js lee CRM_DB_FILE al
 * abrir la base, y el módulo se cachea con esa ruta.
 * @returns {{ dir: string, cleanup: () => Promise<void> }}
 */
export function useTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'crm-test-'));
  process.env.CRM_DB_FILE = join(dir, 'test.db');
  delete process.env.TURSO_DATABASE_URL;
  return {
    dir,
    cleanup: async () => {
      // Windows no deja borrar el fichero mientras siga abierto.
      const { close } = await import('./db.js');
      await close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** @returns {Promise<{ base: string, close: () => void, client: ReturnType<typeof makeClient> }>} */
export async function startServer() {
  const app = (await import('./app.js')).default;
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => server.close(), client: makeClient(base) };
}

/** Cliente con tarro de cookies, para que la sesión persista entre llamadas. */
export function makeClient(base) {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) {
      const [pair] = c.split(';');
      const [, value] = pair.split('=');
      cookie = value ? pair : '';
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b ?? {}),
    put: (p, b) => call('PUT', p, b ?? {}),
    del: (p) => call('DELETE', p),
    forget: () => {
      cookie = '';
    },
    /** La cookie actual, para las pruebas que llaman con fetch directo. */
    cookie: () => cookie,
  };
}
