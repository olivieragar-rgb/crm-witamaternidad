// Ordenar tablas por columna. Puro y sin React, para poder probarlo.

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
const vacio = (v) => v === null || v === undefined || String(v).trim() === '';

/**
 * Ordena filas por la columna activa.
 *
 * - Sin acentos ni mayúsculas ("Ángela" va con la A) y con números como
 *   números ("2" antes que "10").
 * - Los vacíos van siempre al final, suba o baje el orden: una clienta sin
 *   FPP no debe encabezar la lista cuando se ordena por fecha.
 * - Estable: las que empatan conservan el orden con el que llegaron.
 *
 * @param {any[]} rows
 * @param {{key: string|null, dir: 'asc'|'desc'}} sort
 * @param {Record<string, (row: any) => any>} accessors
 */
export function sortRows(rows, sort, accessors) {
  const valor = sort?.key && accessors?.[sort.key];
  if (!valor) return rows;
  const signo = sort.dir === 'desc' ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i, v: valor(row) }))
    .sort((a, b) => {
      const ea = vacio(a.v);
      const eb = vacio(b.v);
      if (ea || eb) return ea === eb ? a.i - b.i : ea ? 1 : -1;
      return signo * collator.compare(String(a.v), String(b.v)) || a.i - b.i;
    })
    .map((x) => x.row);
}

/** Pulsar una columna: ascendente; otra vez, descendente; otra, vuelve al orden original. */
export function nextSort(sort, key) {
  if (sort.key !== key) return { key, dir: 'asc' };
  if (sort.dir === 'asc') return { key, dir: 'desc' };
  return { key: null, dir: 'asc' };
}
