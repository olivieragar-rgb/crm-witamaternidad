/**
 * Opciones de un desplegable. Incluye siempre el valor que ya tenía el
 * registro, aunque esa opción se haya desactivado: desactivarla la quita de
 * los formularios nuevos, no reescribe lo que ya estaba guardado.
 *
 * @param {Array<{value:string, active:boolean}>} list
 * @param {string} current
 * @returns {string[]}
 */
export function options(list, current) {
  // Sin repetidos: una base con la misma opcion dos veces (o escrita "online"
  // y "Online") no debe enseñarlas dos veces en el desplegable.
  const seen = new Set();
  const values = [];
  for (const o of list || []) {
    if (!o.active) continue;
    const key = String(o.value).trim().toLocaleLowerCase('es');
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(o.value);
  }
  if (current && !seen.has(String(current).trim().toLocaleLowerCase('es'))) return [current, ...values];
  return values;
}
