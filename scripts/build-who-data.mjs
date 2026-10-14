// Genera src/data/who-weight-for-age.js desde las tablas oficiales de la OMS.
//
// Los datos son de salud infantil, asi que no se escriben a mano: se sacan del
// fichero que publica la OMS y este script deja constancia de como. Para
// regenerarlos, descarga los dos .xlsx de
//   https://www.who.int/tools/child-growth-standards/standards/weight-for-age
// ("expanded tables", z-scores, ninos y ninas) y ejecuta:
//   node scripts/build-who-data.mjs <carpeta-con-los-xlsx>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const here = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
if (!src) {
  console.error('Uso: node scripts/build-who-data.mjs <carpeta con wfa-boys.xlsx y wfa-girls.xlsx>');
  process.exit(1);
}

// Hasta los 24 meses cumplidos. Mas alla de esa edad este CRM no acompana.
const MAX_DAY = 730;

function readLms(file) {
  const wb = XLSX.read(readFileSync(join(src, file)), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const out = [];
  for (const r of rows) {
    const day = Number(r.Day);
    if (!Number.isInteger(day) || day < 0 || day > MAX_DAY) continue;
    out[day] = [Number(r.L), Number(r.M), Number(r.S)];
  }
  for (let d = 0; d <= MAX_DAY; d++) {
    if (!out[d]) throw new Error(`Falta el dia ${d} en ${file}`);
  }
  return out;
}

const boys = readLms('wfa-boys.xlsx');
const girls = readLms('wfa-girls.xlsx');

// Para poder comprobar que el calculo es correcto, se guardan tambien las
// columnas de desviaciones tipicas que publica la OMS en unos pocos dias:
// las pruebas comparan contra ellas.
function sampleSd(file, days) {
  const wb = XLSX.read(readFileSync(join(src, file)), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const out = {};
  for (const d of days) {
    const r = rows.find((x) => Number(x.Day) === d);
    out[d] = { '-3': r.SD3neg, '-2': r.SD2neg, '-1': r.SD1neg, 0: r.SD0, 1: r.SD1, 2: r.SD2, 3: r.SD3 };
  }
  return out;
}
const checkDays = [0, 1, 30, 61, 91, 182, 365, 548, 730];

const body = `// Generado por scripts/build-who-data.mjs. No editar a mano.
//
// Patrones de crecimiento infantil de la OMS, peso para la edad, del nacimiento
// a los 24 meses. Para cada dia de vida: [L, M, S], los parametros con los que
// la OMS define la distribucion del peso a esa edad.
//
// Fuente: World Health Organization, WHO Child Growth Standards,
// weight-for-age expanded tables (z-scores), ninos y ninas.
// https://www.who.int/tools/child-growth-standards/standards/weight-for-age
// Descargado el ${new Date().toISOString().slice(0, 10)}.

/** Ultimo dia de vida cubierto por la tabla. */
export const MAX_DAY = ${MAX_DAY};

/** @type {Record<'boy'|'girl', Array<[number, number, number]>>} */
export const WFA = {
  boy: ${JSON.stringify(boys)},
  girl: ${JSON.stringify(girls)},
};

/**
 * Pesos que la propia OMS publica para algunas desviaciones tipicas en unos
 * dias concretos. Solo se usan en las pruebas, para comprobar que el calculo
 * a partir de L, M y S reproduce las cifras oficiales.
 */
export const WHO_CHECK = {
  boy: ${JSON.stringify(sampleSd('wfa-boys.xlsx', checkDays))},
  girl: ${JSON.stringify(sampleSd('wfa-girls.xlsx', checkDays))},
};
`;

mkdirSync(join(here, '..', 'src', 'data'), { recursive: true });
const out = join(here, '..', 'src', 'data', 'who-weight-for-age.js');
writeFileSync(out, body, 'utf8');
console.log(`Escrito ${out}`);
console.log(`  dias por sexo: ${boys.length}`);
console.log(`  tamano: ${(Buffer.byteLength(body) / 1024).toFixed(1)} kB`);
