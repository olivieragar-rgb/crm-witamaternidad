import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalCdf,
  normalInv,
  weightForZ,
  weightForPercentile,
  zForWeight,
  percentileForWeight,
  daysBetween,
  formatAge,
  readPercentile,
  MAX_DAY,
} from './lib/growth.js';
import { WHO_CHECK } from './data/who-weight-for-age.js';

// ---- la comprobación que de verdad importa --------------------------------

test('el calculo reproduce los pesos que publica la propia OMS', () => {
  // La OMS publica, ademas de L, M y S, el peso de cada desviacion tipica.
  // Si partiendo de L, M y S salen esas mismas cifras, el calculo es correcto.
  // Se comparan con una tolerancia de 1 g, que es la precision a la que la
  // OMS redondea su tabla.
  let comparaciones = 0;
  for (const sex of ['boy', 'girl']) {
    for (const [day, sds] of Object.entries(WHO_CHECK[sex])) {
      for (const [z, esperado] of Object.entries(sds)) {
        const calculado = weightForZ(sex, Number(day), Number(z));
        assert.ok(
          Math.abs(calculado - esperado) < 0.001,
          `${sex} dia ${day} z=${z}: calculado ${calculado.toFixed(4)}, OMS ${esperado}`,
        );
        comparaciones++;
      }
    }
  }
  assert.equal(comparaciones, 126, 'deberian compararse 2 sexos x 9 dias x 7 desviaciones');
});

// ---- estadística ----------------------------------------------------------

test('normalCdf en los valores conocidos', () => {
  const cerca = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);
  cerca(normalCdf(0), 0.5);
  cerca(normalCdf(-1.959964), 0.025, 1e-5);
  cerca(normalCdf(1.959964), 0.975, 1e-5);
  cerca(normalCdf(-1.880794), 0.03, 1e-5); // percentil 3
  cerca(normalCdf(1.880794), 0.97, 1e-5); // percentil 97
  cerca(normalCdf(-2), 0.02275, 1e-5);
});

test('normalInv es la inversa de normalCdf', () => {
  for (const p of [0.03, 0.1, 0.25, 0.5, 0.75, 0.9, 0.97]) {
    assert.ok(Math.abs(normalCdf(normalInv(p)) - p) < 1e-6, `p=${p}`);
  }
  assert.ok(Math.abs(normalInv(0.5)) < 1e-9, 'el percentil 50 es z=0');
});

// ---- peso y percentil -----------------------------------------------------

test('el percentil 50 es la mediana que publica la OMS', () => {
  // Al nacer, la mediana de la OMS es 3,3464 kg en ninos y 3,2322 en ninas.
  assert.ok(Math.abs(weightForPercentile('boy', 0, 50) - 3.3464) < 0.0005);
  assert.ok(Math.abs(weightForPercentile('girl', 0, 50) - 3.2322) < 0.0005);
});

test('peso y percentil son operaciones inversas', () => {
  for (const sex of ['boy', 'girl']) {
    for (const day of [0, 15, 60, 180, 365, 730]) {
      for (const p of [3, 15, 50, 85, 97]) {
        const w = weightForPercentile(sex, day, p);
        const vuelta = percentileForWeight(sex, day, w).percentile;
        assert.ok(Math.abs(vuelta - p) < 0.01, `${sex} dia ${day} p${p}: vuelve ${vuelta}`);
      }
    }
  }
});

test('un bebe en la mediana da percentil 50', () => {
  const r = percentileForWeight('girl', 182, 7.2894); // mediana de la OMS ese dia
  assert.ok(Math.abs(r.percentile - 50) < 0.1);
  assert.ok(Math.abs(r.z) < 0.001);
});

test('mas peso es mas percentil, y el percentil crece con el peso', () => {
  const bajo = percentileForWeight('boy', 90, 5.5).percentile;
  const medio = percentileForWeight('boy', 90, 6.8).percentile;
  const alto = percentileForWeight('boy', 90, 8.5).percentile;
  assert.ok(bajo < medio && medio < alto, `${bajo} < ${medio} < ${alto}`);
  assert.ok(bajo > 0 && alto < 100);
});

test('ninos y ninas tienen tablas distintas', () => {
  // A los 6 meses la mediana de los ninos es mayor que la de las ninas.
  assert.ok(weightForPercentile('boy', 182, 50) > weightForPercentile('girl', 182, 50));
});

// ---- bordes ---------------------------------------------------------------

test('fuera de la tabla devuelve null en vez de inventar', () => {
  assert.equal(weightForZ('boy', MAX_DAY + 1, 0), null);
  assert.equal(weightForZ('boy', -1, 0), null);
  assert.equal(percentileForWeight('boy', 9999, 10), null);
  assert.equal(weightForZ('alien', 100, 0), null);
  assert.equal(zForWeight('boy', 100, 0), null, 'un peso de cero no tiene percentil');
  assert.equal(zForWeight('boy', 100, -3), null);
});

test('el ultimo dia de la tabla si existe', () => {
  assert.ok(weightForZ('boy', MAX_DAY, 0) > 0);
  assert.ok(weightForZ('girl', 0, 0) > 0);
});

// ---- utilidades -----------------------------------------------------------

test('daysBetween no se mueve con el cambio de hora', () => {
  assert.equal(daysBetween('2026-01-01', '2026-01-31'), 30);
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2, 'cambio de hora en Espana');
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2, 'ano bisiesto');
  assert.equal(daysBetween('2026-05-10', '2026-05-10'), 0);
  assert.equal(daysBetween('no-es', '2026-05-10'), null);
});

test('formatAge se lee como se dice', () => {
  assert.equal(formatAge(0), '0 días');
  assert.equal(formatAge(1), '1 día');
  assert.equal(formatAge(20), '20 días');
  assert.equal(formatAge(61), '2 meses');
  assert.equal(formatAge(365), '11 m y 30 d');
  assert.equal(formatAge(-1), '');
});

test('readPercentile marca los extremos que senala la OMS', () => {
  assert.equal(readPercentile(2.9).tone, 'low');
  assert.equal(readPercentile(3).tone, 'normal');
  assert.equal(readPercentile(50).tone, 'normal');
  assert.equal(readPercentile(97).tone, 'normal');
  assert.equal(readPercentile(97.1).tone, 'high');
});
