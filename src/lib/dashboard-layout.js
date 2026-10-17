// Cómo se ve la pantalla de Inicio: qué bloques salen, en qué orden y con qué
// aspecto. Cada usuaria guarda el suyo.
//
// Es lógica pura y vive en src/lib porque la usan los dos lados: la pantalla
// para pintar y el servidor para no guardar nunca algo que no se pueda pintar.

/**
 * Los bloques que se pueden mostrar. `group` decide dónde viven: las cifras en
 * la fila de arriba y los paneles debajo. El orden de esta lista es el de
 * fábrica.
 */
export const BLOCKS = [
  { id: 'stat-clients', group: 'stats', label: 'Clientas activas' },
  { id: 'stat-pending', group: 'stats', label: 'Facturas pendientes' },
  { id: 'stat-overdue', group: 'stats', label: 'Facturas vencidas', note: 'Solo sale cuando hay alguna' },
  { id: 'stat-revenue', group: 'stats', label: 'Ingresos del mes' },
  { id: 'pending', group: 'panels', label: 'Pendiente de avisar', note: 'Solo sale cuando hay algo pendiente' },
  { id: 'births', group: 'panels', label: 'Próximos partos' },
  { id: 'appointments', group: 'panels', label: 'Próximas citas' },
];

export const GROUPS = { stats: 'Cifras', panels: 'Paneles' };

/** Cuántos elementos enseñan las listas de próximos partos y próximas citas. */
export const LIST_SIZES = [3, 5, 10];

export const DEFAULT_DASHBOARD = Object.freeze({
  blocks: BLOCKS.map(({ id }) => ({ id, visible: true })),
  columns: 2,
  compact: false,
  listSize: 5,
});

const known = new Map(BLOCKS.map((b) => [b.id, b]));
export const blockInfo = (id) => known.get(id);

/**
 * Deja una preferencia guardada en algo seguro de pintar: sin bloques que ya no
 * existen ni repetidos, con los que falten añadidos al final (así un bloque
 * nuevo de una versión futura aparece solo) y con las opciones sueltas dentro
 * de sus valores válidos. Lo que venga mal se sustituye por lo de fábrica, no
 * da error: una preferencia rota nunca debe dejar sin pantalla de Inicio.
 *
 * @param {unknown} input
 * @returns {{ blocks: Array<{id: string, visible: boolean}>, columns: 1|2, compact: boolean, listSize: number }}
 */
export function sanitizeDashboard(input) {
  const src = input && typeof input === 'object' ? /** @type {any} */ (input) : {};
  const seen = new Set();
  const blocks = [];
  for (const item of Array.isArray(src.blocks) ? src.blocks : []) {
    const id = item && typeof item === 'object' ? item.id : undefined;
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    blocks.push({ id, visible: item.visible !== false });
  }
  for (const b of BLOCKS) if (!seen.has(b.id)) blocks.push({ id: b.id, visible: true });
  return {
    blocks,
    columns: Number(src.columns) === 1 ? 1 : 2,
    compact: src.compact === true,
    listSize: LIST_SIZES.includes(Number(src.listSize)) ? Number(src.listSize) : 5,
  };
}

/**
 * Sube (delta -1) o baja (delta +1) un bloque dentro de su grupo. Un bloque no
 * salta de las cifras a los paneles: son zonas distintas de la pantalla.
 */
export function moveBlock(layout, id, delta) {
  const group = known.get(id)?.group;
  const i = layout.blocks.findIndex((b) => b.id === id);
  if (i < 0 || !group) return layout;
  let j = i + delta;
  while (j >= 0 && j < layout.blocks.length && known.get(layout.blocks[j].id)?.group !== group) j += delta;
  if (j < 0 || j >= layout.blocks.length) return layout;
  const blocks = layout.blocks.slice();
  [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  return { ...layout, blocks };
}

/** Los bloques de un grupo, en el orden elegido. */
export const blocksOf = (layout, group) =>
  layout.blocks.filter((b) => known.get(b.id)?.group === group);

/** Poner o quitar un bloque. */
export const setVisible = (layout, id, visible) => ({
  ...layout,
  blocks: layout.blocks.map((b) => (b.id === id ? { ...b, visible } : b)),
});
