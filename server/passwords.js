// Hash y verificación de contraseñas con scrypt de node:crypto.
//
// Se usa scrypt y no bcrypt/argon2 porque esos dos necesitan binarios nativos,
// que complican el despliegue en una función serverless. scrypt con estos
// parámetros es suficiente para el tamaño de este sistema.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const N = 16384; // coste de CPU/memoria (2^14)
const R = 8;
const P = 1;
const KEYLEN = 64;

// scrypt necesita permiso explícito para pasar de los 32 MB por defecto:
// 128 * N * r = 16 MB, más margen.
const MAXMEM = 64 * 1024 * 1024;

/** Longitud mínima. Lo exige el servidor, no solo el formulario. */
export const MIN_PASSWORD_LENGTH = 10;

/** @param {string} password @returns {Promise<string>} 'scrypt$N$r$p$salt$hash' */
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    const err = new Error(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    err.code = 'WEAK_PASSWORD';
    throw err;
  }
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('hex'), key.toString('hex')].join('$');
}

/**
 * Comprueba una contraseña contra su hash almacenado. Nunca lanza por un
 * hash corrupto o vacío: devuelve false, para que una fila mal guardada no
 * se convierta en un error 500 que revele información.
 *
 * @param {string} password
 * @param {string} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltHex, hashHex] = parts;
  try {
    const expected = Buffer.from(hashHex, 'hex');
    const key = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAXMEM,
    });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
