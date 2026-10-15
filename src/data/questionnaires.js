// Cuestionarios de alta: lo que se pregunta a una clienta nueva segun el
// servicio que contrata.
//
// Un solo modulo para los dos lados. El front pinta los campos leyendo de
// aqui y el servidor valida, calcula el estado y exporta leyendo de aqui, asi
// que anadir una pregunta es una linea y aparece en los dos sitios a la vez.
// Por eso no importa nada: ni express ni react.

/**
 * @typedef {Object} Field
 * @property {string} id               Clave con la que se guarda la respuesta.
 * @property {string} label            La pregunta, tal como se lee en pantalla.
 * @property {'text'|'textarea'|'number'|'date'|'select'} type
 * @property {boolean} [required]      Si falta, el cuestionario queda pendiente.
 * @property {string[]} [options]      Solo en 'select'.
 * @property {boolean} [other]         Anade la opcion "Otro" con campo libre.
 * @property {string} [hint]           Aclaracion bajo el campo.
 * @property {(data: Record<string, string>) => boolean} [showIf]
 */

/** Primer parto: el valor que oculta las preguntas por los anteriores. */
export const FIRST_BIRTH = 'Primero';

/**
 * Consultoria de lactancia. Son las 16 preguntas del formulario que se usaba
 * en Google Forms menos nombre, apellidos y email: eso ya esta en la ficha y
 * se corrige en un solo sitio.
 * @type {Field[]}
 */
const LACTANCIA = [
  { id: 'babyName', label: 'Nombre del bebé', type: 'text', required: true },
  {
    id: 'birthDate',
    label: 'Fecha del parto',
    type: 'date',
    required: true,
    hint: 'La fecha en que nació de verdad, no la fecha probable de la ficha.',
  },
  {
    id: 'birthType',
    label: 'Tipo de parto',
    type: 'select',
    required: true,
    other: true,
    options: ['Vaginal natural', 'Vaginal instrumental', 'Cesárea programada', 'Cesárea de urgencia'],
  },
  { id: 'gestWeeksAtBirth', label: 'Semana de gestación en la que nació el bebé', type: 'number', required: true },
  {
    id: 'birthWeight',
    label: 'Peso del bebé al nacimiento',
    type: 'text',
    required: true,
    hint: 'Tal como lo diga ella: 3.450 kg, 3450 g…',
  },
  { id: 'currentWeight', label: 'Peso actual o más reciente', type: 'text', required: true },
  {
    id: 'separation',
    label: '¿Hubo separación tras el nacimiento?',
    type: 'select',
    required: true,
    other: true,
    options: ['Sí', 'No'],
  },
  { id: 'conditions', label: 'Diabetes gestacional, SOP, tiroides…', type: 'text' },
  {
    id: 'painWhenFeeding',
    label: '¿Notas dolor al amamantar?',
    type: 'select',
    required: true,
    other: true,
    options: ['Sí', 'No'],
  },
  {
    id: 'breastChanges',
    label: '¿Notaste cambios en tus pechos durante el embarazo?',
    type: 'select',
    options: ['Sí', 'No', 'Tal vez'],
  },
  {
    id: 'feedsPer24h',
    label: '¿Cuántas tomas hace en 24 h? ¿Y cuánto tiempo suele estar en el pecho por toma?',
    type: 'textarea',
    required: true,
  },
  { id: 'teats', label: '¿Usa tetinas: chupete, biberón?', type: 'text' },
  { id: 'howDidYouHearAboutUs', label: '¿Cómo nos has conocido?', type: 'text', required: true },
];

/**
 * Preparacion al parto. Mucho mas corto: aqui el bebe no ha nacido todavia.
 * @type {Field[]}
 */
const PARTO = [
  {
    id: 'birthNumber',
    label: '¿Qué parto es?',
    type: 'select',
    required: true,
    options: [FIRST_BIRTH, 'Segundo', 'Tercero', 'Cuarto o más'],
  },
  {
    id: 'previousBirths',
    label: '¿Cómo fueron los partos anteriores?',
    type: 'textarea',
    required: true,
    showIf: (d) => Boolean(d.birthNumber) && d.birthNumber !== FIRST_BIRTH,
  },
  {
    id: 'previousCountry',
    label: '¿En qué país fueron?',
    type: 'text',
    required: true,
    showIf: (d) => Boolean(d.birthNumber) && d.birthNumber !== FIRST_BIRTH,
  },
  {
    id: 'gestWeeks',
    label: 'Semana de gestación actual',
    type: 'number',
    required: true,
    hint: 'Si la ficha tiene FPP, sale calculada; se puede corregir.',
  },
  { id: 'extra', label: 'Datos adicionales', type: 'textarea' },
];

export const QUESTIONNAIRES = {
  lactancia: { label: 'Consultoría de lactancia', fields: LACTANCIA },
  parto: { label: 'Preparación al parto', fields: PARTO },
};

export const KINDS = Object.keys(QUESTIONNAIRES);

/** Minusculas y sin tildes, para comparar texto escrito por personas. */
const plain = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/**
 * Que cuestionario le toca a un servicio.
 *
 * Los nombres de los servicios salen del catalogo y se editan desde Ajustes,
 * asi que no se pueden comparar con una lista fija: se busca la palabra
 * clave. "parto" cubre tambien "hipnoparto". Si el servicio nombra los dos,
 * manda la lactancia, que es el cuestionario largo.
 *
 * @param {string} [service]
 * @returns {'lactancia'|'parto'|null}
 */
export function kindForService(service) {
  const s = plain(service);
  if (s.includes('lactancia')) return 'lactancia';
  if (s.includes('parto')) return 'parto';
  return null;
}

/**
 * Los campos que se ven con las respuestas que hay ahora. Un campo oculto no
 * se pinta, no se guarda y no cuenta como obligatorio.
 *
 * @param {string} kind
 * @param {Record<string, string>} [data]
 * @returns {Field[]}
 */
export function visibleFields(kind, data = {}) {
  return (QUESTIONNAIRES[kind]?.fields ?? []).filter((f) => !f.showIf || f.showIf(data));
}

/**
 * 'completo' cuando todas las obligatorias visibles tienen respuesta.
 * Siempre se puede guardar a medias: esto solo decide como se marca.
 *
 * @returns {'pendiente'|'completo'}
 */
export function computeStatus(kind, data = {}) {
  const falta = visibleFields(kind, data).some(
    (f) => f.required && String(data[f.id] ?? '').trim() === '',
  );
  return falta ? 'pendiente' : 'completo';
}

/**
 * Deja solo respuestas a preguntas que existen y se ven, recortadas. Lo que
 * llega de mas se descarta en silencio: el cliente no decide que columnas
 * tiene el cuestionario.
 *
 * @returns {Record<string, string>}
 */
export function sanitize(kind, data = {}) {
  const out = {};
  for (const f of visibleFields(kind, data)) {
    const v = String(data[f.id] ?? '').trim();
    if (v !== '') out[f.id] = v;
  }
  return out;
}

/**
 * Las respuestas con su pregunta en texto. Es lo que va al export de la
 * clienta: un fichero que diga `feedsPer24h: "8, 20 min"` no sirve para
 * ejercer el derecho de acceso.
 *
 * @returns {Array<{ pregunta: string, respuesta: string }>}
 */
export function labelled(kind, data = {}) {
  return visibleFields(kind, data).map((f) => ({ pregunta: f.label, respuesta: data[f.id] ?? '' }));
}
