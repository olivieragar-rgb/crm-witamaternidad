# Cuestionarios de alta por servicio — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el cuestionario de consultoría de lactancia (hoy un Google Form externo) y una variante corta para preparación al parto se rellenen dentro del CRM, al crear la clienta o más tarde, con las respuestas protegidas como el resto de sus datos de salud.

**Architecture:** Las preguntas se definen en un único módulo puro, `src/data/questionnaires.js`, que importan a la vez el front (para pintar los campos) y el servidor (para validar, calcular el estado y exportar). Las respuestas se guardan como JSON en una tabla nueva, `client_forms`, con un router propio montado sobre `/api/clients` antes del CRUD genérico, al lado de `privacyRouter`. En el front, un componente `QuestionnaireModal` pinta cualquier cuestionario desde su definición, sin JSX por pregunta.

**Tech Stack:** Express 4 + SQLite/libSQL en el servidor, React 18 + Vite en el navegador, `node:test` para las pruebas. Sin dependencias nuevas.

**Spec:** [`docs/superpowers/specs/2026-10-15-cuestionarios-de-alta-design.md`](../specs/2026-10-15-cuestionarios-de-alta-design.md)

---

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `src/data/questionnaires.js` **(nuevo)** | Las preguntas de los dos cuestionarios y las funciones puras que operan sobre ellas: visibilidad, estado, limpieza, qué cuestionario toca por servicio. Sin dependencias: lo importan los dos lados. |
| `src/questionnaires.test.mjs` **(nuevo)** | Pruebas del módulo anterior. |
| `server/db.js` **(modificar)** | Añadir `client_forms` al `SCHEMA`. |
| `server/questionnaires.js` **(nuevo)** | El router: leer, guardar y resumir cuestionarios, con su auditoría. Y `clientForms()`, que usa el export de privacidad. |
| `server/questionnaires.test.mjs` **(nuevo)** | Pruebas de la API y de su relación con el RGPD. |
| `server/app.js` **(modificar)** | Montar el router antes del CRUD genérico. |
| `server/privacy.js` **(modificar)** | Incluir los cuestionarios en el export y borrarlos al anonimizar. |
| `src/api.js` **(modificar)** | Tres métodos de cliente HTTP. |
| `src/components/ui.jsx` **(modificar)** | `cancelLabel` opcional en `Modal`. |
| `src/components/QuestionnaireModal.jsx` **(nuevo)** | El formulario, pintado desde la definición. |
| `src/views/Clients.jsx` **(modificar)** | Paso 2 al crear y columna «Cuestionario» en el listado. |
| `src/styles.css` **(modificar)** | Dos clases de `Badge`: pendiente y completo. |

**El front no tiene pruebas automáticas** en este proyecto: `npm test` corre
`node --test` sobre módulos puros (`src/search.test.mjs`, `src/growth.test.mjs`)
y sobre la API. No hay React Testing Library ni jsdom, y montar ese andamiaje
no entra en este trabajo. Por eso la lógica de los cuestionarios vive en un
módulo puro que **sí** se prueba, y las tareas de interfaz se verifican en el
navegador con pasos concretos (Tarea 10).

---

### Tarea 1: Módulo compartido de definiciones

**Files:**
- Create: `src/data/questionnaires.js`
- Test: `src/questionnaires.test.mjs`

- [ ] **Step 1: Escribir la prueba que falla**

Crear `src/questionnaires.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTIONNAIRES,
  KINDS,
  kindForService,
  visibleFields,
  computeStatus,
  sanitize,
  labelled,
} from './data/questionnaires.js';

test('hay dos cuestionarios y cada campo tiene lo que necesita para pintarse', () => {
  assert.deepEqual(KINDS, ['lactancia', 'parto']);
  for (const kind of KINDS) {
    const { label, fields } = QUESTIONNAIRES[kind];
    assert.ok(label, `${kind} necesita un nombre visible`);
    const ids = fields.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length, `${kind} tiene ids repetidos`);
    for (const f of fields) {
      assert.ok(f.label, `${f.id} sin etiqueta`);
      assert.ok(['text', 'textarea', 'number', 'date', 'select'].includes(f.type), `${f.id}: tipo ${f.type}`);
      if (f.type === 'select') assert.ok(f.options?.length, `${f.id} es select y no trae opciones`);
      if (f.type !== 'select') assert.equal(f.other, undefined, `${f.id}: "otro" solo tiene sentido en un select`);
    }
  }
});

test('el cuestionario de lactancia no vuelve a pedir lo que ya está en la ficha', () => {
  const ids = QUESTIONNAIRES.lactancia.fields.map((f) => f.id);
  assert.equal(ids.length, 13);
  for (const repetido of ['name', 'nombre', 'email', 'correo', 'phone']) {
    assert.ok(!ids.includes(repetido));
  }
  // La fecha del parto es la real, y no toca la FPP de la ficha.
  assert.ok(ids.includes('birthDate'));
});

test('el servicio decide el cuestionario, con tildes o sin ellas', () => {
  assert.equal(kindForService('Lactancia'), 'lactancia');
  assert.equal(kindForService('Consulta de lactancia online'), 'lactancia');
  assert.equal(kindForService('Hipnoparto / Preparación al parto'), 'parto');
  assert.equal(kindForService('PREPARACION AL PARTO'), 'parto');
  assert.equal(kindForService('Consulta online'), null);
  assert.equal(kindForService(''), null);
  assert.equal(kindForService(undefined), null);
  // Si el servicio nombra los dos, manda la lactancia.
  assert.equal(kindForService('Lactancia y preparación al parto'), 'lactancia');
});

test('en el primer parto no se pregunta por los anteriores', () => {
  const primero = { birthNumber: 'Primero' };
  const ids = visibleFields('parto', primero).map((f) => f.id);
  assert.ok(!ids.includes('previousBirths'));
  assert.ok(!ids.includes('previousCountry'));

  const segundo = { birthNumber: 'Segundo' };
  const ids2 = visibleFields('parto', segundo).map((f) => f.id);
  assert.ok(ids2.includes('previousBirths'));
  assert.ok(ids2.includes('previousCountry'));
});

test('un campo oculto no deja el cuestionario pendiente', () => {
  // Primer parto: basta con el número de parto y la semana de gestación.
  assert.equal(computeStatus('parto', { birthNumber: 'Primero', gestWeeks: '32' }), 'completo');
  // Segundo parto: ahora sí faltan los anteriores.
  assert.equal(computeStatus('parto', { birthNumber: 'Segundo', gestWeeks: '32' }), 'pendiente');
  assert.equal(
    computeStatus('parto', {
      birthNumber: 'Segundo',
      gestWeeks: '32',
      previousBirths: 'Cesárea de urgencia',
      previousCountry: 'Francia',
    }),
    'completo',
  );
});

test('vacío está pendiente y los espacios no cuentan como respuesta', () => {
  assert.equal(computeStatus('lactancia', {}), 'pendiente');
  assert.equal(computeStatus('parto', { birthNumber: '   ', gestWeeks: '32' }), 'pendiente');
});

test('sanitize descarta lo que no es una pregunta del cuestionario', () => {
  const out = sanitize('parto', {
    birthNumber: 'Primero',
    gestWeeks: ' 32 ',
    extra: '',
    inventado: 'x',
    status: 'completo',
  });
  assert.deepEqual(out, { birthNumber: 'Primero', gestWeeks: '32' });
});

test('sanitize olvida las respuestas de los campos que se han ocultado', () => {
  const out = sanitize('parto', {
    birthNumber: 'Primero',
    gestWeeks: '32',
    previousBirths: 'quedó de cuando puso "Segundo"',
  });
  assert.equal(out.previousBirths, undefined);
});

test('labelled devuelve la pregunta en texto, para el export', () => {
  const filas = labelled('parto', { birthNumber: 'Primero', gestWeeks: '32' });
  assert.deepEqual(filas[0], { pregunta: '¿Qué parto es?', respuesta: 'Primero' });
  // Las preguntas sin responder salen igualmente: el export dice qué se preguntó.
  assert.ok(filas.some((f) => f.pregunta === 'Datos adicionales' && f.respuesta === ''));
  // Las ocultas no.
  assert.ok(!filas.some((f) => f.pregunta.includes('partos anteriores')));
});
```

- [ ] **Step 2: Comprobar que falla**

Run: `node --test src/questionnaires.test.mjs`
Expected: FAIL — `Cannot find module` de `./data/questionnaires.js`.

- [ ] **Step 3: Escribir el módulo**

Crear `src/data/questionnaires.js`:

```js
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
```

- [ ] **Step 4: Comprobar que pasa**

Run: `node --test src/questionnaires.test.mjs`
Expected: PASS, 9 pruebas.

- [ ] **Step 5: Commit**

```bash
git add src/data/questionnaires.js src/questionnaires.test.mjs
git commit -m "Cuestionarios de alta: las preguntas, en un modulo que usan los dos lados"
```

---

### Tarea 2: La tabla `client_forms`

**Files:**
- Modify: `server/db.js` (constante `SCHEMA`, al final, tras `catalogs`)

- [ ] **Step 1: Añadir la tabla al esquema**

En `server/db.js`, dentro de la plantilla `SCHEMA`, justo después del bloque de
`catalogs` y su índice (busca `idx_catalogs_type`), antes del backtick de
cierre:

```sql
  CREATE TABLE IF NOT EXISTS client_forms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clientId INTEGER NOT NULL,
    kind TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pendiente',
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_client_forms ON client_forms (clientId, kind);
```

Va en `SCHEMA` y no en `COLUMNS` porque es una tabla nueva y `SCHEMA` se
ejecuta en cada arranque con `IF NOT EXISTS`: la base de producción la crea
sola al desplegar, sin migración.

El único es la pareja `(clientId, kind)`, no la clienta: una misma clienta
puede contratar preparación al parto y, meses después, lactancia, y entonces
tiene los dos cuestionarios.

- [ ] **Step 2: Comprobar que la base arranca con la tabla**

Run: `node --test server/migration.test.mjs`
Expected: PASS. Las pruebas existentes arrancan la base de cero; si el SQL
tuviera un error de sintaxis, `init()` reventaría y fallarían todas.

- [ ] **Step 3: Commit**

```bash
git add server/db.js
git commit -m "Tabla client_forms: las respuestas del cuestionario, en JSON"
```

---

### Tarea 3: Leer y guardar un cuestionario

**Files:**
- Create: `server/questionnaires.js`
- Modify: `server/app.js` (import arriba; montaje junto a `privacyRouter`, ~línea 187)
- Test: `server/questionnaires.test.mjs`

- [ ] **Step 1: Escribir la prueba que falla**

Crear `server/questionnaires.test.mjs`:

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer } from './test-helpers.mjs';

const tmp = useTempDb(); // antes de importar app.js

const PW = 'contrasena-larga-1';

let srv;
let a; // administradora
let lactancia; // clienta de lactancia
let parto; // clienta de preparación al parto

before(async () => {
  srv = await startServer();
  a = srv.client;
  await a.post('/api/auth/setup', { email: 'admin@example.com', name: 'Admin', password: PW });

  lactancia = (
    await a.post('/api/clients', {
      name: 'Lucía Fernández',
      service: 'Lactancia',
      consentAt: '2026-02-01',
      consentChannel: 'Email',
    })
  ).data.id;

  parto = (
    await a.post('/api/clients', {
      name: 'Marta Ruiz',
      service: 'Hipnoparto / Preparación al parto',
      dueDate: '2026-12-01',
    })
  ).data.id;
});

after(async () => {
  srv.close();
  await tmp.cleanup();
});

test('un cuestionario sin rellenar se lee vacío y pendiente', async () => {
  const r = await a.get(`/api/clients/${lactancia}/form?kind=lactancia`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { kind: 'lactancia', data: {}, status: 'pendiente', updatedAt: '' });
});

test('se guarda a medias y sigue pendiente', async () => {
  const r = await a.put(`/api/clients/${lactancia}/form`, {
    kind: 'lactancia',
    data: { babyName: 'Leo', birthDate: '2026-09-20' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'pendiente');
  assert.equal(r.data.data.babyName, 'Leo');

  const leido = await a.get(`/api/clients/${lactancia}/form?kind=lactancia`);
  assert.equal(leido.data.data.birthDate, '2026-09-20');
  assert.ok(leido.data.updatedAt, 'tiene que quedar fecha de actualización');
});

test('con todas las obligatorias queda completo, y guardar otra vez no duplica', async () => {
  const completo = {
    babyName: 'Leo',
    birthDate: '2026-09-20',
    birthType: 'Cesárea de urgencia',
    gestWeeksAtBirth: '38',
    birthWeight: '3.450 kg',
    currentWeight: '4.100 kg',
    separation: 'Sí',
    painWhenFeeding: 'Sí',
    feedsPer24h: '10 tomas, 20 min',
    howDidYouHearAboutUs: 'Instagram',
  };
  const r = await a.put(`/api/clients/${lactancia}/form`, { kind: 'lactancia', data: completo });
  assert.equal(r.data.status, 'completo');

  const otra = await a.put(`/api/clients/${lactancia}/form`, { kind: 'lactancia', data: completo });
  assert.equal(otra.status, 200);
  const resumen = await a.get('/api/clients/forms');
  assert.equal(resumen.data[lactancia].length, 1, 'el único (clientId, kind) evita el duplicado');
});

test('la respuesta de "Otro" se guarda tal cual la escribió', async () => {
  const r = await a.put(`/api/clients/${lactancia}/form`, {
    kind: 'lactancia',
    data: { babyName: 'Leo', separation: 'Solo dos horas en observación' },
  });
  assert.equal(r.data.data.separation, 'Solo dos horas en observación');
});

test('las claves que no son preguntas del cuestionario se descartan', async () => {
  const r = await a.put(`/api/clients/${parto}/form`, {
    kind: 'parto',
    data: { birthNumber: 'Primero', gestWeeks: '32', status: 'completo', id: 99, inventado: 'x' },
  });
  assert.deepEqual(r.data.data, { birthNumber: 'Primero', gestWeeks: '32' });
  assert.equal(r.data.status, 'completo');
});

test('una clienta puede tener los dos cuestionarios', async () => {
  await a.put(`/api/clients/${parto}/form`, { kind: 'lactancia', data: { babyName: 'Nuevo' } });
  const resumen = await a.get('/api/clients/forms');
  const kinds = resumen.data[parto].map((f) => f.kind).sort();
  assert.deepEqual(kinds, ['lactancia', 'parto']);
});

test('un cuestionario que no existe es un 400', async () => {
  const r = await a.put(`/api/clients/${lactancia}/form`, { kind: 'reiki', data: {} });
  assert.equal(r.status, 400);
  const g = await a.get(`/api/clients/${lactancia}/form?kind=reiki`);
  assert.equal(g.status, 400);
});

test('una clienta que no existe es un 404', async () => {
  const r = await a.put('/api/clients/9999/form', { kind: 'parto', data: {} });
  assert.equal(r.status, 404);
  const g = await a.get('/api/clients/9999/form?kind=parto');
  assert.equal(g.status, 404);
});

test('el resumen trae el estado de cada clienta', async () => {
  const r = await a.get('/api/clients/forms');
  assert.equal(r.status, 200);
  const suyo = r.data[lactancia].find((f) => f.kind === 'lactancia');
  assert.equal(suyo.status, 'pendiente'); // la última escritura fue parcial
});

test('leer y guardar quedan en el registro de accesos', async () => {
  const r = await a.get('/api/audit?entity=client_forms');
  const acciones = new Set(r.data.rows.map((x) => x.action));
  assert.ok(acciones.has('client_form_view'));
  assert.ok(acciones.has('client_form_update'));
  assert.ok(acciones.has('client_form_list'));
});
```

- [ ] **Step 2: Comprobar que falla**

Run: `node --test server/questionnaires.test.mjs`
Expected: FAIL. Las rutas no existen, así que `PUT /api/clients/:id/form` cae
en el CRUD genérico o devuelve 404 de Express, no el JSON esperado.

- [ ] **Step 3: Escribir el router**

Crear `server/questionnaires.js`:

```js
// Cuestionarios de alta de la clienta.
//
// Las respuestas son datos de salud del Art. 9 del RGPD: de lo mas detallado
// que guarda el CRM. De ahi que aqui se audite tambien la lectura, y no solo
// el cambio, igual que en el resto de la ficha.
import express from 'express';
import { all, get, run } from './db.js';
import { audit } from './auth.js';
import { QUESTIONNAIRES, computeStatus, sanitize, labelled } from '../src/data/questionnaires.js';

export const questionnairesRouter = express.Router();

/** Lo guardado de un tipo, o el hueco vacio si no hay nada todavia. */
async function readForm(clientId, kind) {
  const row = await get(
    'SELECT data, status, updatedAt FROM client_forms WHERE clientId = ? AND kind = ?',
    [clientId, kind],
  );
  if (!row) return { kind, data: {}, status: 'pendiente', updatedAt: '' };
  return { kind, data: JSON.parse(row.data), status: row.status, updatedAt: row.updatedAt };
}

/**
 * Resumen de todos los cuestionarios, agrupados por clienta. El listado lo
 * necesita para marcar los pendientes, y asi lo resuelve con una peticion en
 * vez de una por fila.
 *
 * Va antes de /:id/form: si no, "forms" se leeria como un identificador.
 */
questionnairesRouter.get('/forms', async (req, res, next) => {
  try {
    const rows = await all('SELECT clientId, kind, status FROM client_forms ORDER BY clientId, kind');
    /** @type {Record<string, Array<{ kind: string, status: string }>>} */
    const out = {};
    for (const r of rows) {
      (out[r.clientId] ??= []).push({ kind: r.kind, status: r.status });
    }
    await audit(req, { action: 'client_form_list', entity: 'client_forms' });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

questionnairesRouter.get('/:id/form', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const kind = String(req.query.kind || '');
    if (!Object.hasOwn(QUESTIONNAIRES, kind)) {
      return res.status(400).json({ error: 'Cuestionario desconocido' });
    }
    if (!(await get('SELECT id FROM clients WHERE id = ?', [id]))) {
      return res.status(404).json({ error: 'No encontrada' });
    }
    await audit(req, { action: 'client_form_view', entity: 'client_forms', entityId: id, detail: kind });
    res.json(await readForm(id, kind));
  } catch (e) {
    next(e);
  }
});

questionnairesRouter.put('/:id/form', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const kind = String(req.body?.kind || '');
    if (!Object.hasOwn(QUESTIONNAIRES, kind)) {
      return res.status(400).json({ error: 'Cuestionario desconocido' });
    }
    const client = await get('SELECT id, anonymizedAt FROM clients WHERE id = ?', [id]);
    if (!client) return res.status(404).json({ error: 'No encontrada' });
    // Una ficha anonimizada perdio sus datos personales porque la clienta lo
    // pidio. Volver a meterle datos de salud deshace ese derecho.
    if (client.anonymizedAt) {
      return res.status(409).json({ error: 'Esta ficha está anonimizada: no se le pueden añadir datos' });
    }

    // El estado lo decide el servidor, no el cliente: es la definicion del
    // cuestionario la que dice que es obligatorio.
    const data = sanitize(kind, req.body?.data ?? {});
    const status = computeStatus(kind, data);
    await run(
      `INSERT INTO client_forms (clientId, kind, data, status) VALUES (?, ?, ?, ?)
       ON CONFLICT (clientId, kind) DO UPDATE
         SET data = excluded.data, status = excluded.status, updatedAt = datetime('now')`,
      [id, kind, JSON.stringify(data), status],
    );
    await audit(req, {
      action: 'client_form_update',
      entity: 'client_forms',
      entityId: id,
      detail: `${kind}: ${status}`,
    });
    res.json(await readForm(id, kind));
  } catch (e) {
    next(e);
  }
});

/**
 * Los cuestionarios de una clienta con las preguntas en texto legible, para
 * el export del derecho de acceso.
 */
export async function clientForms(clientId) {
  const rows = await all(
    'SELECT kind, data, status, updatedAt FROM client_forms WHERE clientId = ? ORDER BY kind',
    [clientId],
  );
  return rows.map((r) => ({
    cuestionario: QUESTIONNAIRES[r.kind]?.label ?? r.kind,
    estado: r.status,
    actualizadoEl: r.updatedAt,
    respuestas: labelled(r.kind, JSON.parse(r.data)),
  }));
}
```

- [ ] **Step 4: Montar el router en `server/app.js`**

Junto a los demás imports de routers del principio del fichero:

```js
import { questionnairesRouter } from './questionnaires.js';
```

Y en el bloque de montajes, **justo después** de `app.use('/api/clients', privacyRouter);`:

```js
// Tambien antes del crud generico, y antes del middleware de auditoria de
// /api/clients: estas rutas se auditan ellas mismas, con el tipo de
// cuestionario en el detalle.
app.use('/api/clients', questionnairesRouter);
```

El orden importa dos veces: si va después del CRUD, `/api/clients/5/form`
entra por `/api/clients/:id`; y si va después del middleware de auditoría de
`/api/clients`, cada lectura queda registrada como `client_list`, que es falso.

- [ ] **Step 5: Comprobar que pasan**

Run: `node --test server/questionnaires.test.mjs`
Expected: PASS, 10 pruebas.

- [ ] **Step 6: Comprobar que no se ha roto nada**

Run: `node --test server/invoices.test.mjs server/privacy.test.mjs server/auth.test.mjs`
Expected: PASS. Confirma que montar un router nuevo sobre `/api/clients` no
desvía ninguna ruta que ya existía.

- [ ] **Step 7: Commit**

```bash
git add server/questionnaires.js server/questionnaires.test.mjs server/app.js
git commit -m "API de cuestionarios: leer, guardar a medias y resumir"
```

---

### Tarea 4: RGPD — export y anonimización

**Files:**
- Modify: `server/privacy.js` (`fullClientData`, y el `POST /:id/anonymize`)
- Test: `server/questionnaires.test.mjs` (añadir al final)

- [ ] **Step 1: Escribir las pruebas que fallan**

Añadir al final de `server/questionnaires.test.mjs`:

```js
test('el export de la clienta incluye el cuestionario con las preguntas legibles', async () => {
  await a.put(`/api/clients/${lactancia}/form`, {
    kind: 'lactancia',
    data: { babyName: 'Leo', feedsPer24h: '10 tomas, 20 min' },
  });
  const r = await a.get(`/api/clients/${lactancia}/export`);
  assert.equal(r.status, 200);
  const q = r.data.cuestionarios;
  assert.equal(q.length, 1);
  assert.equal(q[0].cuestionario, 'Consultoría de lactancia');
  const tomas = q[0].respuestas.find((x) => x.pregunta.startsWith('¿Cuántas tomas'));
  assert.equal(tomas.respuesta, '10 tomas, 20 min');
});

test('anonimizar borra los cuestionarios y deja la ficha cerrada a datos nuevos', async () => {
  const id = (await a.post('/api/clients', { name: 'Ana Gil', service: 'Lactancia' })).data.id;
  await a.put(`/api/clients/${id}/form`, { kind: 'lactancia', data: { babyName: 'Mar' } });

  await a.post(`/api/clients/${id}/anonymize`, { reason: 'Lo pide ella' });

  const leido = await a.get(`/api/clients/${id}/form?kind=lactancia`);
  assert.deepEqual(leido.data.data, {}, 'las respuestas tienen que haberse borrado');

  const r = await a.put(`/api/clients/${id}/form`, { kind: 'lactancia', data: { babyName: 'Mar' } });
  assert.equal(r.status, 409);

  const exp = await a.get(`/api/clients/${id}/export`);
  assert.deepEqual(exp.data.cuestionarios, []);
});
```

- [ ] **Step 2: Comprobar que fallan**

Run: `node --test server/questionnaires.test.mjs`
Expected: FAIL — `r.data.cuestionarios` es `undefined`, y tras anonimizar las
respuestas siguen ahí.

- [ ] **Step 3: Añadirlos al export**

En `server/privacy.js`, en los imports:

```js
import { clientForms } from './questionnaires.js';
```

Y en `fullClientData`, cambiar el `return` por:

```js
  // Los cuestionarios de alta son el dato de salud mas detallado que hay
  // aqui: sin ellos el export no es el expediente completo.
  const cuestionarios = await clientForms(id);
  return { client, appointments, invoices, cuestionarios };
```

- [ ] **Step 4: Borrarlos al anonimizar**

En el mismo fichero, en `privacyRouter.post('/:id/anonymize')`, justo después
de la línea que vacía las notas de las citas:

```js
    // Las citas guardan notas de seguimiento, que también son datos de salud.
    await run("UPDATE appointments SET notes = '' WHERE clientId = ?", [id]);
    // Y el cuestionario entero, que es dato de salud de principio a fin: aquí
    // no hay nada que conservar, al contrario que en las facturas.
    await run('DELETE FROM client_forms WHERE clientId = ?', [id]);
```

- [ ] **Step 5: Comprobar que pasan**

Run: `node --test server/questionnaires.test.mjs server/privacy.test.mjs`
Expected: PASS las dos, sin tocar `privacy.test.mjs`. Su prueba del export
comprueba clave por clave (`res.data.client.name`, `res.data.invoices.length`)
y no la forma entera del objeto, así que una clave nueva no la rompe.

- [ ] **Step 6: Commit**

```bash
git add server/privacy.js server/questionnaires.test.mjs
git commit -m "El cuestionario entra en el export y se borra al anonimizar"
```

---

### Tarea 5: Cliente HTTP

**Files:**
- Modify: `src/api.js` (dentro del objeto `api`, tras el bloque `// Privacidad`)

- [ ] **Step 1: Añadir los tres métodos**

```js
  // Cuestionarios de alta
  clientForms: () => req('GET', '/api/clients/forms'),
  clientForm: (id, kind) => req('GET', `/api/clients/${id}/form?kind=${encodeURIComponent(kind)}`),
  saveClientForm: (id, body) => req('PUT', `/api/clients/${id}/form`, body),
```

- [ ] **Step 2: Comprobar que el front sigue compilando**

Run: `npm run build`
Expected: `✓ built in …`, sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/api.js
git commit -m "api.js: cuestionarios de alta"
```

---

### Tarea 6: `cancelLabel` en Modal y los dos badges

**Files:**
- Modify: `src/components/ui.jsx` (función `Modal`)
- Modify: `src/styles.css` (tras el bloque `.badge-rectificada`, ~línea 715)

- [ ] **Step 1: Añadir el `cancelLabel`**

En `src/components/ui.jsx`, en la firma de `Modal`:

```jsx
export function Modal({
  title,
  onClose,
  children,
  onSubmit,
  submitLabel = 'Guardar',
  cancelLabel = 'Cancelar',
  error,
  hideCancel,
}) {
```

Y en el botón de cancelar:

```jsx
            {!hideCancel && (
              <button type="button" onClick={onClose}>
                {cancelLabel}
              </button>
            )}
```

El valor por defecto es el texto que había, así que ningún modal existente
cambia. Hace falta porque en el paso 2 ese botón no cancela nada: la ficha ya
está guardada y lo que dice es «lo relleno más tarde».

- [ ] **Step 2: Añadir los dos badges**

En `src/styles.css`, después del bloque de `.badge-rectificada, .badge-anulada`:

```css
/* Cuestionario de alta: pendiente avisa, completo descansa. */
.badge-pendiente {
  background: var(--terracotta-light);
  color: var(--terracotta-dark);
}

.badge-completo {
  background: var(--green-light);
  color: var(--green-dark);
}
```

Son las mismas parejas de color que ya usan «Nuevo contacto» y «Activa», así
que la tabla no gana un color nuevo.

- [ ] **Step 3: Comprobar que compila**

Run: `npm run build`
Expected: `✓ built in …`.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui.jsx src/styles.css
git commit -m "Modal con texto de cancelar propio, y badges del cuestionario"
```

---

### Tarea 7: El formulario

**Files:**
- Create: `src/components/QuestionnaireModal.jsx`

- [ ] **Step 1: Escribir el componente**

```jsx
import { useEffect, useState } from 'react';
import { api, gestWeeks } from '../api.js';
import { Modal, Field } from './ui.jsx';
import { QUESTIONNAIRES, KINDS, visibleFields, computeStatus } from '../data/questionnaires.js';

// Valor del desplegable que abre el campo libre. No se guarda: lo que se
// guarda es lo que ella escriba al lado.
const OTHER = 'Otro';

/**
 * El cuestionario de alta de una clienta, pintado desde su definicion. No hay
 * JSX por pregunta: anadir una pregunta al modulo de definiciones la hace
 * aparecer aqui.
 *
 * @param {{
 *   client: { id: number, name: string, dueDate?: string, consentAt?: string },
 *   kind: 'lactancia'|'parto',
 *   onClose: () => void,
 *   onSaved?: () => void,
 *   cancelLabel?: string,
 * }} props
 */
export default function QuestionnaireModal({ client, kind: initialKind, onClose, onSaved, cancelLabel }) {
  const [kind, setKind] = useState(initialKind);
  const [data, setData] = useState({});
  // Campos cuyo desplegable esta en "Otro". Es estado de pantalla y no dato:
  // en la base solo queda el texto que escribio.
  const [others, setOthers] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api
      .clientForm(client.id, kind)
      .then((r) => {
        if (!alive) return;
        const loaded = { ...r.data };
        // La semana de gestacion se propone desde la FPP de la ficha, que es
        // el mismo calculo que muestra el listado. Queda editable: la FPP
        // puede no estar puesta, o ella decir otra semana.
        if (kind === 'parto' && !loaded.gestWeeks && client.dueDate) {
          const g = gestWeeks(client.dueDate);
          if (g && !g.past && g.weeks > 0) loaded.gestWeeks = String(g.weeks);
        }
        setData(loaded);
        // Una respuesta guardada que no esta entre las opciones vino del
        // campo libre, asi que el desplegable tiene que abrir en "Otro".
        setOthers(
          new Set(
            QUESTIONNAIRES[kind].fields
              .filter((f) => f.other && loaded[f.id] && !f.options.includes(loaded[f.id]))
              .map((f) => f.id),
          ),
        );
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [client.id, client.dueDate, kind]);

  const set = (id) => (e) => setData((d) => ({ ...d, [id]: e.target.value }));

  function chooseOption(f, value) {
    setOthers((prev) => {
      const next = new Set(prev);
      if (value === OTHER) next.add(f.id);
      else next.delete(f.id);
      return next;
    });
    // Al pasar a "Otro" se vacia: lo que valia como opcion no vale como texto.
    setData((d) => ({ ...d, [f.id]: value === OTHER ? '' : value }));
  }

  function control(f) {
    const value = data[f.id] ?? '';
    if (f.type === 'textarea') return <textarea rows={3} value={value} onChange={set(f.id)} />;
    if (f.type === 'number') return <input type="number" min="0" value={value} onChange={set(f.id)} />;
    if (f.type === 'date') return <input type="date" value={value} onChange={set(f.id)} />;
    if (f.type === 'select') {
      const isOther = others.has(f.id);
      return (
        <>
          <select value={isOther ? OTHER : value} onChange={(e) => chooseOption(f, e.target.value)}>
            <option value="">—</option>
            {f.options.map((o) => (
              <option key={o}>{o}</option>
            ))}
            {f.other && <option value={OTHER}>{OTHER}</option>}
          </select>
          {isOther && (
            <input value={value} onChange={set(f.id)} placeholder="¿Cuál?" aria-label={`${f.label}: otro`} />
          )}
        </>
      );
    }
    return <input value={value} onChange={set(f.id)} />;
  }

  async function save() {
    try {
      await api.saveClientForm(client.id, { kind, data });
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e.message);
    }
  }

  const fields = visibleFields(kind, data);
  const pendiente = computeStatus(kind, data) === 'pendiente';

  return (
    <Modal
      title={`${QUESTIONNAIRES[kind].label} · ${client.name}`}
      onClose={onClose}
      onSubmit={save}
      submitLabel="Guardar cuestionario"
      cancelLabel={cancelLabel ?? 'Cancelar'}
      error={error}
    >
      {!client.consentAt && (
        <p className="notice">
          <strong>Sin consentimiento registrado.</strong> Aquí vas a escribir datos de salud de ella y
          del bebé. Antes de guardarlos tiene que haberlo autorizado, y hay que poder demostrar cuándo
          y cómo: está en el bloque «Consentimiento (RGPD)» de su ficha.
        </p>
      )}

      <Field label="Cuestionario">
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {QUESTIONNAIRES[k].label}
            </option>
          ))}
        </select>
      </Field>

      {loading ? (
        <p className="muted">Cargando…</p>
      ) : (
        <>
          {fields.map((f) => (
            <Field key={f.id} label={f.required ? `${f.label}*` : f.label}>
              {control(f)}
              {f.hint && <span className="muted small">{f.hint}</span>}
            </Field>
          ))}
          <p className="muted small">
            {pendiente
              ? 'Puedes guardarlo a medias: queda marcado como pendiente hasta que estén las preguntas con asterisco.'
              : 'Están todas las obligatorias: al guardar queda completo.'}
          </p>
        </>
      )}
    </Modal>
  );
}
```

El selector tiene dos valores y no tres: dentro del formulario, «ninguno» es
cerrarlo. Está ahí porque los nombres de los servicios se editan desde Ajustes
y el emparejamiento por palabra clave puede no acertar; con él se corrige a
mano sin tocar código.

- [ ] **Step 2: Comprobar que compila**

Run: `npm run build`
Expected: `✓ built in …`. Un error de sintaxis en JSX lo caza aquí.

- [ ] **Step 3: Commit**

```bash
git add src/components/QuestionnaireModal.jsx
git commit -m "QuestionnaireModal: el formulario sale de la definicion"
```

---

### Tarea 8: Paso 2 al crear la clienta

**Files:**
- Modify: `src/views/Clients.jsx`

- [ ] **Step 1: Imports y estado**

Añadir a los imports del principio:

```jsx
import QuestionnaireModal from '../components/QuestionnaireModal.jsx';
import { kindForService } from '../data/questionnaires.js';
```

Y junto a los demás `useState` del componente:

```jsx
  // { client, kind, fromCreate }: el cuestionario abierto, y si venimos de
  // crear la ficha (entonces el boton de cerrar dice "lo relleno mas tarde").
  const [formFor, setFormFor] = useState(null);
  // { [clientId]: Array<{ kind, status }> } para marcar los pendientes.
  const [formStatus, setFormStatus] = useState({});
```

- [ ] **Step 2: Cargar el resumen con el listado**

Sustituir la línea de `load`:

```jsx
  const load = () => api.list('clients').then(setRows);
```

por:

```jsx
  const load = () => {
    // El resumen de cuestionarios es una peticion para toda la tabla, no una
    // por fila. Si falla, el listado se pinta igual y sin marcas.
    api.clientForms().then(setFormStatus).catch(() => setFormStatus({}));
    return api.list('clients').then(setRows);
  };
```

- [ ] **Step 3: Abrir el paso 2 al guardar una ficha nueva**

En `save()`, sustituir:

```jsx
      if (editingId) await api.update('clients', editingId, body);
      else await api.create('clients', body);
      setOpen(false);
      load();
```

por:

```jsx
      const saved = editingId
        ? await api.update('clients', editingId, body)
        : await api.create('clients', body);
      setOpen(false);
      load();
      // Al crear, el cuestionario del servicio es el paso siguiente. Al
      // editar no: para eso esta el boton del listado.
      const kind = editingId ? null : kindForService(saved.service);
      if (kind) setFormFor({ client: saved, kind, fromCreate: true });
```

- [ ] **Step 4: La columna del listado**

En el `<thead>`, añadir una cabecera antes de la columna vacía de acciones:

```jsx
            <th>Estado</th>
            <th>Cuestionario</th>
            <th></th>
```

En el `<tbody>`, añadir esta celda justo después de la del `Badge` del estado:

```jsx
              <td>
                {(() => {
                  if (c.anonymizedAt) return <span className="muted">—</span>;
                  const saved = formStatus[c.id] || [];
                  // El del servicio; si el servicio no pide ninguno pero hay
                  // uno guardado (el servicio cambio despues), ese.
                  const kind = kindForService(c.service) || saved[0]?.kind;
                  if (!kind) return <span className="muted">—</span>;
                  const row = saved.find((f) => f.kind === kind);
                  return (
                    <button onClick={() => setFormFor({ client: c, kind })}>
                      {row ? <Badge value={row.status === 'completo' ? 'Completo' : 'Pendiente'} /> : 'Rellenar'}
                    </button>
                  );
                })()}
              </td>
```

Y subir el `colSpan` de la fila vacía, que ahora se queda corta:

```jsx
          {visible.length === 0 && <EmptyRow colSpan={7} />}
```

- [ ] **Step 5: Pintar el modal**

Al final del `return`, después del bloque `{open && (<Modal …>)}`:

```jsx
      {formFor && (
        <QuestionnaireModal
          client={formFor.client}
          kind={formFor.kind}
          cancelLabel={formFor.fromCreate ? 'Lo relleno más tarde' : 'Cancelar'}
          onClose={() => setFormFor(null)}
          onSaved={load}
        />
      )}
```

- [ ] **Step 6: Comprobar que compila**

Run: `npm run build`
Expected: `✓ built in …`.

- [ ] **Step 7: Commit**

```bash
git add src/views/Clients.jsx
git commit -m "Clientas: el cuestionario al crear y en el listado"
```

---

### Tarea 9: Toda la suite

- [ ] **Step 1: Correr todas las pruebas**

Run: `node --test src/search.test.mjs src/growth.test.mjs src/questionnaires.test.mjs server/auth.test.mjs server/expenses.test.mjs server/invoices.test.mjs server/migration.test.mjs server/oncall.test.mjs server/privacy.test.mjs server/reminders.test.mjs server/settings.test.mjs server/calendar.test.mjs server/questionnaires.test.mjs`
Expected: PASS todo. Si falla algo que no sea de cuestionarios, arreglarlo
antes de seguir: lo ha roto este trabajo.

Las rutas van explícitas porque `npm test` usa comodines (`src/*.test.mjs`) y
PowerShell no los expande.

- [ ] **Step 2: Commit si hubo arreglos**

```bash
git add -A
git commit -m "Arreglos tras pasar la suite entera"
```

---

### Tarea 10: Verificación en el navegador

El front no tiene pruebas automáticas, así que esto se mira. Cada paso dice
qué tiene que pasar.

- [ ] **Step 1: Arrancar**

Run: `npm run dev`
Abrir `http://localhost:5173` y entrar con la cuenta de desarrollo.

- [ ] **Step 2: Lactancia, el camino entero**

Clientas → + Nueva clienta → nombre «Prueba Lactancia», servicio
**Lactancia**, fecha de consentimiento de hoy → Guardar.
Esperado: se cierra la ficha y se abre «Consultoría de lactancia · Prueba
Lactancia» con 13 preguntas, sin aviso de consentimiento, y los botones
«Guardar cuestionario» y «Lo relleno más tarde».

- [ ] **Step 3: El campo libre**

En «Tipo de parto» elegir **Otro**.
Esperado: aparece un campo de texto al lado. Escribir «Parto en casa».
Rellenar solo eso y «Guardar cuestionario».
Esperado: en el listado, la columna Cuestionario marca **Pendiente** en ámbar.

- [ ] **Step 4: Que lo guardado vuelve**

Pulsar el badge **Pendiente**.
Esperado: abre con «Tipo de parto» en **Otro** y «Parto en casa» en el campo
de al lado. Completar las preguntas con asterisco y guardar.
Esperado: la columna pasa a **Completo** en verde.

- [ ] **Step 5: Preparación al parto y el aviso de consentimiento**

Nueva clienta «Prueba Parto», servicio **Hipnoparto / Preparación al parto**,
FPP dentro de tres meses, **sin** fecha de consentimiento → Guardar.
Esperado: se abre «Preparación al parto» con el aviso «Sin consentimiento
registrado» arriba, y «Semana de gestación actual» ya propuesta desde la FPP.

- [ ] **Step 6: Las preguntas que aparecen y desaparecen**

En «¿Qué parto es?» elegir **Segundo**.
Esperado: aparecen «¿Cómo fueron los partos anteriores?» y «¿En qué país
fueron?». Volver a **Primero**: desaparecen las dos.

- [ ] **Step 7: Lo relleno más tarde**

Pulsar «Lo relleno más tarde».
Esperado: se cierra el cuestionario y la ficha **sigue creada** en el listado,
con su botón «Rellenar».

- [ ] **Step 8: Servicio sin cuestionario**

Nueva clienta con servicio **Consulta online** → Guardar.
Esperado: no se abre ningún cuestionario y la columna muestra «—».

- [ ] **Step 9: El export**

En la fila de «Prueba Lactancia», pulsar «Datos».
Esperado: el JSON descargado tiene `cuestionarios`, con `cuestionario:
"Consultoría de lactancia"` y las respuestas con la pregunta escrita en texto.

- [ ] **Step 10: El registro de accesos**

Ajustes → registro de accesos (como administradora), filtrar por
`client_forms`.
Esperado: aparecen `client_form_view`, `client_form_update` y
`client_form_list`.

- [ ] **Step 11: Commit de lo que haya hecho falta arreglar**

```bash
git add -A
git commit -m "Arreglos de la verificacion en el navegador"
```

---

## Qué queda fuera, a propósito

- **El enlace público** para que la clienta rellene el cuestionario ella misma.
  Es el sustituto real del Google Form y el siguiente paso natural, pero
  necesita endpoint sin sesión, token con caducidad y el texto de
  consentimiento dentro del propio enlace.
- **Los pesos a la gráfica de crecimiento** de Herramientas, que hoy no guarda
  medidas por clienta.
- **Migrar las respuestas de la hoja de Google.** Son pocas fichas y se pasan
  a mano.
