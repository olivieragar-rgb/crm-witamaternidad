# Cuestionarios de alta por servicio

Fecha: 2026-10-15

## Contexto

Al dar de alta una clienta de **consultoría de lactancia**, la profesional
recoge hoy los datos en un Google Form externo
(«Consultoría de lactancia», 16 preguntas). Los datos quedan en una hoja de
cálculo de Google, fuera del CRM: no aparecen en la ficha de la clienta, no
entran en el export del derecho de acceso, no se borran al anonimizar y no
quedan en el registro de accesos. Son datos de salud del Art. 9 del RGPD
viviendo fuera del sistema que los protege.

Para **preparación al parto** no hay formulario: se pregunta de viva voz y
acaba, con suerte, en el campo de notas.

Este spec lleva los dos cuestionarios dentro del CRM.

### Estado de partida

- Las clientas se crean y editan en un único modal de `src/views/Clients.jsx`,
  que ya tiene bloques plegables para consentimiento RGPD y datos fiscales.
- El servicio de la ficha (`clients.service`) es texto libre que sale del
  catálogo editable `clientService` (`server/catalogs.js`), hoy con los valores
  `Hipnoparto / Preparación al parto`, `Lactancia`, `Consulta online`, `Otro`.
- `clients.dueDate` es la **fecha probable de parto (FPP)**, no la fecha real
  del parto. `src/api.js` calcula semanas de gestación a partir de ella.
- La privacidad está centralizada en `server/privacy.js`: export completo de
  la clienta, anonimización por campos y listado de conservación. El acceso a
  `/api/clients` ya se audita, incluidas las lecturas.
- `server/app.js` monta un CRUD genérico sobre la tabla `clients`, y monta
  `privacyRouter` **antes** para que las rutas con nombre no se lean como
  identificadores.
- El servidor ya importa módulos puros de `src/` (`src/search.js`), así que
  compartir código entre los dos lados es el patrón de la casa.

## Decisiones tomadas

1. **Lo rellena la profesional dentro del CRM.** No se genera un enlace
   público para que la clienta lo rellene ella. El modelo de datos se diseña
   de modo que ese enlace se pueda añadir después sin rehacerlo.
2. **Las respuestas se guardan como JSON** en una tabla propia, no como
   columnas de `clients`.
3. **No se repiten los datos que ya están en la ficha.** El cuestionario de
   lactancia pierde las preguntas de nombre, apellidos y email del Google Form
   original: esos datos viven en la ficha y se corrigen en un solo sitio.
4. **Aparece como paso 2 al guardar la ficha**, con salida explícita para
   rellenarlo más tarde.
5. **El cuestionario se deduce del servicio, pero se puede cambiar a mano.**

## Modelo de datos

Tabla nueva, en el `SCHEMA` de `server/db.js`:

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

- `kind`: `lactancia` o `parto`. Una clienta puede tener uno de cada (contrata
  los dos servicios en momentos distintos), de ahí que el único sea la pareja.
- `data`: objeto JSON `{ idDePregunta: respuesta }`. Solo se guardan las
  claves que existen en la definición del cuestionario; lo demás se descarta.
- `status`: `pendiente` mientras falte alguna respuesta obligatoria,
  `completo` cuando estén todas. Lo calcula el servidor al guardar, no lo manda
  el cliente.

### Por qué JSON y no columnas

Los dos cuestionarios no comparten ni una pregunta: en columnas serían unas 25
columnas nuevas en `clients`, la mitad siempre vacías, y la tabla ya tiene más
de veinte. Y las preguntas van a cambiar —este cuestionario lo ha ido ajustando
su autora y lo seguirá ajustando—, lo que con columnas significa una migración
por pregunta.

El precio es real: no se puede filtrar ni ordenar clientas por una respuesta
en SQL. Se acepta porque las respuestas se leen de una en una en la ficha de
cada clienta. Si algún día hace falta buscar por respuesta, se añade una
columna generada o una tabla de índice sin tocar lo que ya hay guardado.

Alternativas descartadas: columnas en `clients` (lo anterior); texto libre en
`notes` (sin estructura, sin poder marcar «pendiente» ni exportar en orden).

## Definición de las preguntas

Un único módulo, `src/data/questionnaires.js`, que importan el front (para
pintar) y el servidor (para validar y exportar). Añadir una pregunta es una
línea en un sitio.

```js
export const QUESTIONNAIRES = {
  lactancia: { label: 'Consultoría de lactancia', fields: [ /* … */ ] },
  parto: { label: 'Preparación al parto', fields: [ /* … */ ] },
};
```

Cada campo: `{ id, label, type, required, options?, other?, hint?, showIf? }`.

Tipos: `text`, `textarea`, `number`, `date`, `select`.

- `other: true` en un `select` añade la opción «Otro» con campo de texto
  libre al lado, que es cómo se comporta el Google Form original.
- `showIf: (data) => boolean` oculta un campo según otra respuesta. Un campo
  oculto nunca cuenta como obligatorio.

### Cuestionario `lactancia` (13 preguntas)

Son las 16 del Google Form menos nombre, apellidos y email.

| id | Pregunta | Tipo | Obl. |
|---|---|---|---|
| `babyName` | Nombre del bebé | text | sí |
| `birthDate` | Fecha del parto | date | sí |
| `birthType` | Tipo de parto | select (vaginal natural · vaginal instrumental · cesárea programada · cesárea de urgencia · otro) | sí |
| `gestWeeksAtBirth` | Semana de gestación en la que nació el bebé | number | sí |
| `birthWeight` | Peso del bebé al nacimiento | text | sí |
| `currentWeight` | Peso actual o más reciente | text | sí |
| `separation` | ¿Hubo separación tras el nacimiento? | select (sí · no) + otro | sí |
| `conditions` | Diabetes gestacional, SOP, tiroides… | text | no |
| `painWhenFeeding` | ¿Notas dolor al amamantar? | select (sí · no) + otro | sí |
| `breastChanges` | ¿Notaste cambios en tus pechos durante el embarazo? | select (sí · no · tal vez) | no |
| `feedsPer24h` | ¿Cuántas tomas hace en 24 h? ¿Y cuánto tiempo suele estar en el pecho por toma? | textarea | sí |
| `teats` | ¿Usa tetinas: chupete, biberón? | text | no |
| `howDidYouHearAboutUs` | ¿Cómo nos has conocido? | text | sí |

`birthDate` es la fecha **real** del parto y no toca `clients.dueDate`, que es
la FPP. La ficha de una clienta de lactancia puede tener las dos: la FPP que se
anotó durante el embarazo y la fecha en que nació de verdad.

Los pesos se guardan como texto libre, igual que en el Google Form: ahí se
escribe «3.450 kg» o «3450 g» o «3,45». Normalizarlos a gramos solo haría falta
el día que esos pesos alimenten la gráfica de crecimiento, y ese día es otro
spec.

### Cuestionario `parto` (5 preguntas)

| id | Pregunta | Tipo | Obl. |
|---|---|---|---|
| `birthNumber` | ¿Qué parto es? | select (primero · segundo · tercero · cuarto o más) | sí |
| `previousBirths` | ¿Cómo fueron los partos anteriores? | textarea | sí, salvo si `birthNumber` es «primero» |
| `previousCountry` | ¿En qué país fueron? | text | sí, salvo si `birthNumber` es «primero» |
| `gestWeeks` | Semana de gestación actual | number | sí |
| `extra` | Datos adicionales | textarea | no |

`previousBirths` y `previousCountry` se ocultan con `showIf` cuando es el
primer parto.

`gestWeeks` se propone calculado desde la FPP de la ficha cuando la hay
(`gestWeeks()` de `src/api.js` ya hace ese cálculo), y queda editable: la FPP
puede no estar puesta todavía, o la clienta puede dar una semana distinta a la
que sale del cálculo.

## Qué cuestionario le toca a cada clienta

`kindForService(service)` en el módulo compartido: busca `lactancia` en el
texto del servicio, y `parto` o `hipnoparto`; devuelve `null` si no encuentra
ninguno. Insensible a mayúsculas y acentos.

El emparejamiento por palabra clave se rompe si alguien renombra el valor del
catálogo a algo sin esas palabras, y el catálogo es editable desde Ajustes a
propósito. Por eso el paso 2 lleva un **selector de cuestionario** encima del
formulario, con tres valores (lactancia, preparación al parto, ninguno),
rellenado con lo que diga `kindForService`. El automático acierta casi siempre
y, cuando falla, se corrige a mano sin tocar código.

## API

Módulo nuevo `server/questionnaires.js` con su router, montado en
`server/app.js` sobre `/api/clients` **antes del CRUD genérico** y junto a
`privacyRouter`, con el mismo motivo: si va después, `/api/clients/5/form`
entra por `/api/clients/:id`.

- `GET /api/clients/forms` → `{ [clientId]: { kind, status } }`. Resumen para
  pintar el estado en el listado con una sola petición.
- `GET /api/clients/:id/form?kind=lactancia` → `{ kind, data, status, updatedAt }`,
  o `{ kind, data: {}, status: 'pendiente' }` si no hay nada guardado todavía.
- `PUT /api/clients/:id/form` con `{ kind, data }` → guarda y devuelve lo
  guardado.

Reglas del `PUT`:

- `kind` que no esté en `QUESTIONNAIRES` → 400.
- Clienta que no existe → 404.
- Clienta anonimizada → 409. No se vuelven a meter datos de salud en una ficha
  cuyos datos personales se borraron a petición de la clienta.
- Claves de `data` que no son campos del cuestionario → se descartan en
  silencio.
- `status` lo calcula el servidor: `completo` si todos los campos obligatorios
  visibles tienen respuesta, `pendiente` si falta alguno. Se puede guardar a
  medias siempre.

En `src/api.js`: `clientForms()`, `clientForm(id, kind)`, `saveClientForm(id, body)`.

## RGPD

El cuestionario es el dato de salud más detallado del sistema, así que entra en
los tres mecanismos que ya existen:

1. **Export** (`fullClientData` en `server/privacy.js`): se añaden los
   cuestionarios de la clienta, con las preguntas en texto legible y no solo
   los identificadores de campo. Un export que diga `feedsPer24h: "8, 20 min"`
   no sirve para ejercer el derecho de acceso.
2. **Anonimización**: `DELETE FROM client_forms WHERE clientId = ?` en
   `privacyRouter.post('/:id/anonymize')`, al lado del borrado de notas de
   citas.
3. **Registro de accesos**: el router audita explícitamente
   `client_form_view`, `client_form_list` y `client_form_update`, con el `kind`
   en el detalle. El middleware de auditoría de `/api/clients` registra hoy
   `/5/form` como `client_list`, que es inexacto; con la auditoría explícita en
   el router la lectura queda bien registrada.

Y una cosa más en la interfaz: si la ficha no tiene consentimiento registrado
(`consentAt` vacío), el paso 2 lo avisa arriba del formulario, con un enlace al
bloque de consentimiento de la ficha. Avisa, no bloquea: la profesional puede
estar recogiendo el consentimiento en la misma visita y el orden en que teclea
las cosas no es asunto del CRM.

## Interfaz

### Paso 2 al crear la clienta

`Clients.jsx` guarda la ficha y, si `kindForService(form.service)` devuelve
algo, abre un segundo modal en lugar de cerrar: título «Consultoría de
lactancia» o «Preparación al parto», selector de cuestionario, el formulario,
y dos botones: **Guardar cuestionario** y **Lo relleno más tarde**. Salir sin
guardar no pierde la ficha, que ya está guardada.

Al **editar** una ficha ya existente no aparece el paso 2: ahí ya está el botón
del listado.

### Listado de clientas

Una columna nueva, «Cuestionario», con un botón por fila:

- Sin cuestionario guardado y servicio que lo pide → botón «Cuestionario» con
  `Badge` de *Pendiente*.
- Guardado a medias → *Pendiente*. Completo → *Completo*.
- Servicio que no pide cuestionario → `—`, y el formulario se puede abrir
  igualmente desde el selector si hace falta.

### Formulario

Componente nuevo `src/components/QuestionnaireModal.jsx`, que pinta los campos
desde la definición con los componentes `Field` y `Modal` que ya existen. No
hay JSX por pregunta: añadir una pregunta al módulo de definiciones la hace
aparecer en pantalla.

## Pruebas

`server/questionnaires.test.mjs`, al estilo de las que ya hay (`node:test`,
`test-helpers.mjs`):

- Guardar y volver a leer un cuestionario de lactancia.
- Guardado parcial → `status: 'pendiente'`; todas las obligatorias →
  `completo`.
- `showIf`: con `birthNumber: 'primero'`, `previousBirths` vacío sigue dando
  `completo`.
- `kind` desconocido → 400; clienta inexistente → 404; anonimizada → 409.
- Claves que no son campos del cuestionario se descartan.
- `GET /api/clients/forms` devuelve el resumen de varias clientas.
- El export de la clienta incluye el cuestionario con las preguntas legibles.
- Anonimizar borra el cuestionario.
- `kindForService` con los valores de fábrica del catálogo y con uno
  renombrado.

## Fuera de alcance

- **Enlace público** para que la clienta rellene el cuestionario ella misma y
  entre en su ficha. Es el sustituto real del Google Form y el siguiente paso
  natural, pero necesita endpoint sin sesión, token con caducidad y el texto de
  consentimiento dentro del propio enlace.
- **Enchufar los pesos a la gráfica de crecimiento** de Herramientas, que hoy
  no guarda medidas por clienta.
- **Migrar las respuestas que ya están en la hoja de Google.** Se rellenan a
  mano desde el CRM cuando toque, que son pocas fichas.
