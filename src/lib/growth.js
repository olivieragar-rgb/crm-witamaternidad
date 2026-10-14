// Percentiles de peso para la edad según los patrones de crecimiento de la OMS.
//
// La OMS no publica una curva por percentil, sino tres parámetros por día de
// vida —L, M y S— que describen la distribución del peso a esa edad. De ahí
// sale cualquier percentil, y también el percentil que le corresponde a un peso
// concreto. Es el método oficial, no una aproximación.
import { WFA, MAX_DAY } from '../data/who-weight-for-age.js';

export { MAX_DAY };

/**
 * Función de distribución de la normal estándar.
 * Usa la aproximación 7.1.26 de Abramowitz y Stegun, con un error máximo de
 * 1,5e-7: cuatro órdenes de magnitud por debajo de lo que se muestra.
 */
export function normalCdf(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/** Inversa de la normal estándar, por el algoritmo de Acklam. */
export function normalInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  let q;
  let r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pLow) {
    q = p - 0.5;
    r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/** @param {'boy'|'girl'} sex @param {number} day días de vida */
export function lms(sex, day) {
  const table = WFA[sex];
  if (!table) return null;
  const d = Math.round(day);
  if (!Number.isFinite(d) || d < 0 || d > MAX_DAY) return null;
  const [L, M, S] = table[d];
  return { L, M, S };
}

/**
 * Peso que corresponde a una puntuación z. Es la fórmula de la OMS:
 * con L distinto de cero, W = M (1 + L·S·z)^(1/L); con L cero, W = M·e^(S·z).
 */
export function weightForZ(sex, day, z) {
  const p = lms(sex, day);
  if (!p) return null;
  const { L, M, S } = p;
  return L === 0 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L);
}

/** Peso que corresponde a un percentil (0-100). */
export function weightForPercentile(sex, day, percentile) {
  return weightForZ(sex, day, normalInv(percentile / 100));
}

/** Puntuación z de un peso concreto. */
export function zForWeight(sex, day, weightKg) {
  const p = lms(sex, day);
  if (!p || !(weightKg > 0)) return null;
  const { L, M, S } = p;
  return L === 0 ? Math.log(weightKg / M) / S : (Math.pow(weightKg / M, L) - 1) / (L * S);
}

/**
 * Percentil de un peso concreto, de 0 a 100.
 * @returns {{ z: number, percentile: number } | null}
 */
export function percentileForWeight(sex, day, weightKg) {
  const z = zForWeight(sex, day, weightKg);
  if (z === null) return null;
  return { z, percentile: normalCdf(z) * 100 };
}

/** Días completos entre dos fechas 'YYYY-MM-DD', en UTC para que no la mueva la zona horaria. */
export function daysBetween(fromIso, toIso) {
  const a = new Date(`${String(fromIso).slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${String(toIso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * Cómo se lee un percentil. La OMS marca como señal de alarma por debajo del
 * percentil 3 y por encima del 97, que es donde caen las puntuaciones z de -2
 * y +2. En medio, la variación es normal.
 *
 * @returns {{ tone: 'low'|'normal'|'high', label: string }}
 */
export function readPercentile(percentile) {
  if (percentile < 3) return { tone: 'low', label: 'Por debajo del percentil 3' };
  if (percentile > 97) return { tone: 'high', label: 'Por encima del percentil 97' };
  return { tone: 'normal', label: 'Dentro del rango habitual' };
}

/** Edad en meses y días, para enseñarla como se dice. */
export function formatAge(days) {
  if (days === null || days === undefined || days < 0) return '';
  if (days < 31) return `${days} ${days === 1 ? 'día' : 'días'}`;
  const months = Math.floor(days / 30.4375);
  const rest = Math.round(days - months * 30.4375);
  return rest === 0 ? `${months} meses` : `${months} m y ${rest} d`;
}
