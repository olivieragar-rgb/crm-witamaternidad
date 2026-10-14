// Cabeceras de seguridad, lectura de cookies y comprobación de origen.
// Sin dependencias: lo que hace falta aquí son veinte líneas, no un paquete.

const FONTS_CSS = 'https://fonts.googleapis.com';
const FONTS_FILES = 'https://fonts.gstatic.com';

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "script-src 'self'",
  // Vite inyecta los estilos de la aplicación en etiquetas <style>, así que
  // style-src necesita 'unsafe-inline'. No abre un hueco relevante mientras
  // script-src siga siendo 'self': sin scripts no hay exfiltración.
  `style-src 'self' 'unsafe-inline' ${FONTS_CSS}`,
  `font-src 'self' ${FONTS_FILES}`,
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

export function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // Las respuestas de la API llevan datos personales: que no queden en cachés
  // intermedias ni en el historial del navegador.
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  if (isSecure(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

export const isSecure = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https';

/** @returns {Record<string,string>} */
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue; // la primera gana
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[name] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

export function setCookie(res, name, value, { maxAge, secure }) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAge / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export function clearCookie(res, name, { secure }) {
  const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Segunda barrera contra CSRF, por detrás de SameSite=Lax: si la petición
 * modifica datos y trae Origin, ese Origin tiene que ser el nuestro.
 *
 * Una petición sin Origin se deja pasar a propósito: así siguen funcionando
 * curl y los scripts de prueba, que no son un vector de CSRF porque un
 * navegador siempre manda Origin en una petición entre sitios.
 */
export function sameOrigin(req, res, next) {
  if (!MUTATING.has(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return res.status(403).json({ error: 'Origen no válido' });
  }
  if (originHost === host) return next();

  // En desarrollo la web vive en :5173 y la API en :3001, así que Origin y
  // Host nunca coinciden. Se admite solo si AMBOS son del propio equipo: una
  // página de un atacante jamás tendrá un Origin de localhost, y en
  // producción el Host es el dominio de Vercel, así que esta excepción no
  // llega a aplicarse.
  if (isLoopback(originHost) && isLoopback(host)) return next();

  return res.status(403).json({ error: 'Origen no válido' });
}

const isLoopback = (hostname) =>
  /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i.test(String(hostname || ''));
