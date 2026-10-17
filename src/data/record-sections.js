// Secciones de la ficha de una clienta, para ir rellenándola poco a poco.
//
// Un solo módulo para los dos lados: la ficha pinta los campos leyendo de
// aquí y el servidor valida y exporta leyendo de aquí. Añadir una pregunta es
// una línea y aparece en los dos sitios. Por eso no importa nada.
//
// Cada sección se guarda por separado: se puede rellenar una hoy y otra dentro
// de un mes. Son datos de salud (Art. 9 del RGPD), así que todo vive en la
// base y entra en el export y en el borrado de la clienta.

/**
 * @typedef {Object} SectionField
 * @property {string} id
 * @property {string} label
 * @property {'text'|'textarea'} [type]   'textarea' por defecto
 * @property {string} [placeholder]
 *
 * @typedef {Object} Section
 * @property {string} id
 * @property {string} label
 * @property {string} hint
 * @property {SectionField[]} fields
 */

/** @type {Section[]} */
export const RECORD_SECTIONS = [
  {
    id: 'salud',
    label: 'Salud y antecedentes',
    hint: 'Lo que conviene tener a mano antes de cada sesión.',
    fields: [
      { id: 'alergias', label: 'Alergias', type: 'text' },
      { id: 'medicacion', label: 'Medicación y suplementos', type: 'text' },
      { id: 'enfermedades', label: 'Enfermedades y antecedentes médicos' },
      { id: 'obstetricos', label: 'Antecedentes obstétricos (embarazos y partos anteriores)' },
      { id: 'observaciones', label: 'Observaciones' },
    ],
  },
  {
    id: 'embarazo',
    label: 'Embarazo',
    hint: 'Cómo va el embarazo y quién la acompaña en los controles.',
    fields: [
      { id: 'referencia', label: 'Matrona / ginecóloga y centro de referencia', type: 'text' },
      { id: 'evolucion', label: 'Cómo va el embarazo' },
      { id: 'pruebas', label: 'Pruebas y controles (analíticas, ecografías, test…)' },
      { id: 'molestias', label: 'Molestias y preocupaciones' },
      { id: 'observaciones', label: 'Observaciones' },
    ],
  },
  {
    id: 'preparacion',
    label: 'Preparación al parto',
    hint: 'Lo que ella quiere y lo que se trabaja en las sesiones.',
    fields: [
      { id: 'expectativas', label: 'Qué espera del parto' },
      { id: 'miedos', label: 'Miedos y dudas' },
      { id: 'plan', label: 'Plan de parto' },
      { id: 'tecnicas', label: 'Técnicas trabajadas (respiración, hipnosis, posturas…)' },
      { id: 'acompanante', label: 'Acompañante en el parto', type: 'text' },
    ],
  },
  {
    id: 'parto',
    label: 'Parto y posparto',
    hint: 'Cómo fue y cómo se recupera.',
    fields: [
      { id: 'como', label: 'Cómo fue el parto' },
      { id: 'vivencia', label: 'Cómo lo vivió' },
      { id: 'recuperacion', label: 'Recuperación física' },
      { id: 'emocional', label: 'Estado emocional' },
      { id: 'observaciones', label: 'Observaciones' },
    ],
  },
  {
    id: 'lactancia',
    label: 'Lactancia',
    hint: 'Cómo se alimenta el bebé y qué se ha acordado.',
    fields: [
      { id: 'tipo', label: 'Tipo de lactancia', type: 'text', placeholder: 'Materna, mixta, artificial…' },
      { id: 'dificultades', label: 'Dificultades (agarre, dolor, grietas, mastitis…)' },
      { id: 'tomas', label: 'Tomas, extracción y suplementos' },
      { id: 'plan', label: 'Plan acordado' },
    ],
  },
  {
    id: 'bebe',
    label: 'Bebé: datos y alimentación',
    hint: 'El peso de cada visita va en el seguimiento.',
    fields: [
      { id: 'nombre', label: 'Nombre', type: 'text' },
      { id: 'pesoNacimiento', label: 'Peso al nacer (kg)', type: 'text' },
      { id: 'alimentacion', label: 'Alimentación' },
      { id: 'sueno', label: 'Sueño' },
      { id: 'observaciones', label: 'Observaciones' },
    ],
  },
  {
    id: 'objetivos',
    label: 'Objetivos y próximos pasos',
    hint: 'Para qué viene y qué toca hacer después.',
    fields: [
      { id: 'objetivos', label: 'Objetivos de la clienta' },
      { id: 'proximos', label: 'Próximos pasos y tareas pendientes' },
    ],
  },
];

export const SECTION_IDS = RECORD_SECTIONS.map((s) => s.id);

const MAX_LEN = 5000;

/**
 * Deja solo los campos que existen en la sección, como texto y con tope de
 * longitud. Devuelve null si la sección no existe.
 * @param {string} sectionId
 * @param {Record<string, unknown>} [data]
 */
export function sanitizeSection(sectionId, data = {}) {
  const section = RECORD_SECTIONS.find((s) => s.id === sectionId);
  if (!section) return null;
  const out = {};
  for (const f of section.fields) {
    const v = String(data?.[f.id] ?? '').trim();
    if (v) out[f.id] = v.slice(0, MAX_LEN);
  }
  return out;
}

/** ¿Tiene algo escrito? */
export const sectionFilled = (data) => !!data && Object.values(data).some((v) => String(v).trim() !== '');

/** Las respuestas con su pregunta en texto, para el export. */
export function labelledSections(rows) {
  return RECORD_SECTIONS.flatMap((s) => {
    const row = rows.find((r) => r.section === s.id);
    if (!row) return [];
    const data = JSON.parse(row.data || '{}');
    const respuestas = Object.fromEntries(s.fields.filter((f) => data[f.id]).map((f) => [f.label, data[f.id]]));
    return Object.keys(respuestas).length ? [{ seccion: s.label, actualizada: row.updatedAt, respuestas }] : [];
  });
}
