# CRM Witamaternidad — seguridad, facturación, configuración y RGPD

Fecha: 2026-10-14

## Contexto

CRM propio para un servicio de acompañamiento en maternidad (hipnoparto y
lactancia, Granada y online). React + Vite en el navegador, Express en el
servidor, SQLite en local y Turso (libSQL) en producción sobre Vercel.

Lo usa hoy una sola profesional. A medio plazo lo usarán varias profesionales
en un local pequeño. Más adelante se construirá una capa de personalización
para adaptarlo a otros negocios, así que todo lo que hoy está escrito en el
código y es propio de este negocio debe pasar a configuración.

### Estado de partida

Auditoría del 2026-10-14 sobre 2.000 líneas:

- **La API no tiene autenticación.** Cualquiera con la URL de Vercel lee,
  edita y borra las fichas de clientas, que incluyen datos de salud.
- `POST /api/invoices/:id/email` tomaba destinatario y adjunto del cuerpo de la
  petición: relay de correo abierto sobre la cuenta de Gmail del proyecto.
  **Corregido antes de este spec** (commit `4435899`).
- Las facturas emitidas no son válidas en España: faltan datos fiscales de
  emisor y receptor, nota de exención de IVA, numeración correlativa protegida
  y rectificativas.
- `GET /api/invoices` y `GET /api/dashboard` hacen una consulta por factura
  para calcular totales (N+1). Con años de histórico no escala.
- Datos propios del negocio escritos en el código: datos del emisor, pie de
  página, estados, catálogos de servicios y modalidades, plantillas de PDF y
  de email, serie de numeración.
- Sin medidas de RGPD, tratándose de datos de categoría especial (Art. 9).

No hay inyección SQL: todas las consultas usan parámetros y los nombres de
tabla y campo son constantes del código, nunca entrada del usuario.

## Decisiones tomadas

1. **Usuarios reales con roles desde el primer día**, no una contraseña única.
   Sin multi-tenancy: una instalación, un negocio.
2. **Facturas: borrador libre, emitida inmutable.** En `Borrador` se edita
   todo. Al emitir se congela, toma número correlativo definitivo y solo admite
   cambios de estado de cobro. Los errores se corrigen con factura
   rectificativa enlazada a la original.
3. Se guardan los campos del encadenado por hash desde ya (`hash`, `hashPrev`),
   sin enviar nada a la AEAT, para no rediseñar si Verifactu acaba aplicando.
   **Pendiente de confirmar con la gestoría** si ya aplica.
4. Todo lo demás del CRM es editable al 100%.

## Alcance y orden

Cuatro bloques, cada uno con su commit o serie de commits.

| Bloque | Depende de |
|---|---|
| 1. Seguridad y acceso | — |
| 2. Facturación | — |
| 3. Configuración editable | 1 |
| 4. RGPD | 1 |

El bloque 1 va primero porque hasta que esté, cada día en Vercel es una brecha
de datos de salud notificable.

---

## Bloque 1 — Seguridad y acceso

### Modelo de datos

```sql
users (
  id, email UNIQUE, name, role,          -- 'admin' | 'pro'
  passwordHash,                          -- 'scrypt$N$r$p$salt$hash'
  active, createdAt, lastLoginAt,
  failedAttempts, lockedUntil
)

sessions (
  id, tokenHash UNIQUE,                  -- SHA-256 del token de la cookie
  userId, createdAt, expiresAt, lastSeenAt,
  ip, userAgent
)

audit_log (
  id, at, userId, action, entity, entityId, detail, ip, userAgent
)
```

### Contraseñas

`scrypt` de `node:crypto`, sin dependencias nuevas y sin compilación nativa
(importante en Vercel). Parámetros N=16384, r=8, p=1, keylen=64, sal aleatoria
de 16 bytes. Comparación con `timingSafeEqual`.

Se descartan bcrypt y argon2 porque requieren binarios nativos que complican
el despliegue serverless, y scrypt con estos parámetros es suficiente para el
tamaño de este sistema.

### Sesiones

Sesión en servidor, no JWT. Token aleatorio de 32 bytes en una cookie
`HttpOnly; Secure; SameSite=Lax; Path=/`, y en la base de datos solo su
SHA-256. Caducidad 30 días, renovada en cada uso.

Se elige sesión en servidor sobre JWT por dos razones: se puede **revocar al
instante** (necesario cuando hay datos de salud y alguien deja el equipo), y
produce gratis el registro de accesos que exige el RGPD.

### CSRF

`SameSite=Lax` ya bloquea las peticiones POST entre sitios, que es toda la
superficie de CSRF de una SPA del mismo origen. Como segunda barrera, las
peticiones que modifican datos comprueban que la cabecera `Origin` coincida
con el host. No se introduce una capa de tokens CSRF: no añadiría protección
real sobre lo anterior y sí complejidad.

### Límite de intentos

Contador de fallos por usuario en la base de datos, no en memoria: en
serverless cada petición puede caer en una instancia distinta y un contador en
memoria no sirve de nada. 5 fallos consecutivos bloquean el acceso 15 minutos.
El contador se reinicia al entrar bien.

La respuesta de login es idéntica para "email que no existe" y "contraseña
incorrecta", para no revelar qué cuentas existen.

### Primer arranque

Si la tabla `users` está vacía, la aplicación muestra una pantalla de creación
de la primera cuenta (rol `admin`). Esa ruta deja de responder en cuanto
existe un usuario. Así no se despliega nunca una contraseña por defecto.

### Roles

- `admin`: todo, incluida la gestión de usuarios y la configuración.
- `pro`: todo el trabajo diario. No gestiona usuarios ni configuración, y no
  puede anular facturas emitidas.

### Cabeceras y endurecimiento

- `Content-Security-Policy` con `default-src 'self'`, los dominios de Google
  Fonts, `frame-ancestors 'none'`.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Strict-Transport-Security`, `Permissions-Policy` restrictiva.
- `express.json({ limit: '64kb' })`.
- `app.set('trust proxy', 1)` para que la IP registrada sea la real tras el
  proxy de Vercel.
- La exportación a PDF deja de inyectar un `<script>` inline en la ventana
  emergente (el `window.print()` se llama desde la ventana que la abre), para
  que la CSP no tenga que permitir scripts inline.

### Rutas

```
POST   /api/auth/login        { email, password }  -> usuario + cookie
POST   /api/auth/logout
GET    /api/auth/me
POST   /api/auth/setup        solo si no hay usuarios
POST   /api/auth/password     cambiar la propia contraseña
GET    /api/users             admin
POST   /api/users             admin
PUT    /api/users/:id         admin
DELETE /api/users/:id         admin, no puede ser uno mismo ni el último admin
```

Todo `/api/*` exige sesión salvo `/api/auth/login`, `/api/auth/setup` y
`/api/setup-status`.

### Interfaz

Pantalla de login a pantalla completa antes de la aplicación. En la barra
lateral, el nombre del usuario con un menú de cerrar sesión y cambiar
contraseña. Vista de Usuarios visible solo para `admin`.

### Pruebas

`server/auth.test.mjs`: hash y verificación de contraseña, login correcto,
login con contraseña mala, bloqueo al quinto fallo, acceso sin cookie
rechazado con 401, `setup` rechazado cuando ya existe un usuario, un `pro` no
puede crear usuarios.

---

## Bloque 2 — Facturación

### Datos fiscales

`clients` suma `taxId`, `address`, `postalCode`, `city`, `province`, `country`.
Los datos del emisor viven en la configuración (bloque 3) y hasta entonces en
una tabla `settings` mínima.

### Estados y bloqueo

`status` pasa a: `Borrador`, `Emitida`, `Enviada`, `Pagada`, `Rectificada`,
`Anulada`.

Solo `Borrador` se puede editar o borrar. El resto admite únicamente cambios
de estado de cobro (`Emitida` → `Enviada` → `Pagada`) y anulación por un
`admin`. El servidor lo impone; la interfaz lo refleja.

### Inmutabilidad por copia

Al emitir, la factura guarda una copia JSON de los datos fiscales del emisor
(`issuerSnapshot`) y de la clienta (`clientSnapshot`). Si la clienta cambia
luego de dirección, la factura ya emitida sigue mostrando lo que se emitió.
Sin esto, "inmutable" sería mentira: el PDF se reconstruiría con datos nuevos.

### Numeración

```sql
invoices ( ..., series, seq, number UNIQUE, issuedAt, UNIQUE(series, seq) )
```

El número se asigna **al emitir**, no al crear: `series + '-' + año + '-' +
seq` con `seq` correlativo por serie y año. Los borradores no tienen número.

Con `UNIQUE(series, seq)` dos emisiones simultáneas no pueden duplicar
número: la segunda falla y se reintenta con el siguiente. Es la forma correcta
de garantizarlo sin transacciones distribuidas en Turso.

Series por defecto: `F` ordinarias, `R` rectificativas. Configurables.

### Rectificativas

Desde una factura emitida, "Rectificar" crea un borrador en la serie `R` con
las líneas de la original, enlazado por `rectifiesId` y con `rectifyReason`
obligatorio. Al emitirlo, la original pasa a `Rectificada`. Ninguna de las dos
se modifica ni se borra.

### Campos nuevos de factura

`dueDate` (vencimiento), `paidAt` (fecha de cobro), `paymentMethod`,
`irpfRate` (retención de IRPF), `exemptionNote` (motivo de exención de IVA),
`hash` y `hashPrev` (encadenado, calculados al emitir).

`invoice_items` suma `discount` (porcentaje por línea).

Cálculo: `importe = qty * price * (1 - discount/100)`;
`base = Σ importe`; `iva = Σ importe * vat/100`;
`irpf = base * irpfRate/100`; `total = base + iva - irpf`.

### Rendimiento e histórico

Los totales se calculan en **una sola consulta** con `GROUP BY`, no una por
factura:

```sql
SELECT i.*, c.name AS clientName,
       COALESCE(SUM(it.qty * it.price * (1 - it.discount/100.0)), 0) AS base,
       COALESCE(SUM(it.qty * it.price * (1 - it.discount/100.0) * it.vat/100.0), 0) AS vatAmount
FROM invoices i
LEFT JOIN clients c ON c.id = i.clientId
LEFT JOIN invoice_items it ON it.invoiceId = i.id
GROUP BY i.id
```

El dashboard calcula los ingresos del mes igual, en una consulta.

`GET /api/invoices` acepta `year`, `month`, `status`, `q`, `page`, `pageSize`
y filtra y pagina **en el servidor**. Devuelve `{ rows, total, years }`, donde
`years` son los años con facturas para pintar el selector. La interfaz pasa a
un selector de año más chips de mes, en lugar de derivar los meses de la lista
completa cargada en el navegador.

Índices: `invoices(date)`, `invoices(clientId)`, `invoices(status)`,
`invoice_items(invoiceId)`.

### PDF

El PDF se genera **en el servidor** con `pdfkit` (JavaScript puro, sin
binarios nativos, funciona en Vercel) y se sirve en
`GET /api/invoices/:id/pdf`. Se elige pdfkit sobre Puppeteer porque Puppeteer
arrastra un Chromium de cientos de megas, inviable en una función serverless.

Esto resuelve tres cosas de golpe: el navegador deja de bloquear la ventana
emergente, queda un fichero descargable, y el email puede adjuntar un **PDF**
en lugar del Excel actual, que es lo que una clienta espera recibir.

El Excel sigue existiendo para la exportación contable de varias facturas.

### Integridad referencial

Las tablas declaran las claves ajenas que hoy no tienen. Borrar una clienta ya
no deja facturas huérfanas: si tiene facturas emitidas, no se borra (bloque 4
lo resuelve anonimizando, porque las facturas hay que conservarlas).
`invoice_items` se borra en cascada con su factura.

### Pruebas

`server/invoices.test.mjs`: totales con descuento, IVA e IRPF; el número se
asigna al emitir y es correlativo; una emitida rechaza la edición con 409;
rectificar enlaza las dos y marca la original; el filtro por año y mes pagina
bien; borrar una clienta con facturas se rechaza.

---

## Bloque 3 — Configuración editable

### Modelo

```sql
settings ( key PRIMARY KEY, value )      -- value es JSON
catalogs ( id, type, value, sortOrder, active )
```

`settings` guarda valores sueltos; `catalogs` las listas que hoy son arrays en
el código (`type` = `clientStatus`, `clientService`, `mode`,
`appointmentStatus`, `paymentMethod`, `vatRate`).

### Qué pasa a configuración

- **Emisor**: nombre fiscal, NIF, dirección completa, email, teléfono, logo.
- **Facturación**: series, IVA por defecto, nota de exención por defecto, tipo
  de IRPF, días de vencimiento, datos de pago, pie de la factura.
- **Marca**: nombre, subtítulo, pie de la barra lateral (hoy `WawaywawO`).
- **Plantillas**: asunto y cuerpo del email de factura, con marcadores
  (`{{clienta}}`, `{{numero}}`, `{{total}}`).
- **Catálogos**: las listas de arriba.

### Interfaz

Vista "Ajustes", solo `admin`, con pestañas Emisor / Facturación / Marca /
Plantillas / Catálogos. Los catálogos se editan como listas ordenables.

Las vistas dejan de importar constantes del código y leen los catálogos de la
API. Un contexto de React carga la configuración una vez al arrancar.

Un catálogo desactivado deja de ofrecerse en los formularios nuevos, pero los
registros que ya lo usaban lo siguen mostrando: desactivar no reescribe el
pasado.

### Pruebas

`server/settings.test.mjs`: un `pro` recibe 403 al escribir ajustes; los
valores por defecto se crean en el primer arranque; desactivar un valor de
catálogo no altera los registros existentes.

---

## Bloque 4 — RGPD

Los datos de embarazo, lactancia y las notas son **datos de salud, Art. 9
RGPD**: categoría especial, el nivel máximo de protección.

### Consentimiento

`clients` suma `consentAt`, `consentChannel` (web, email, papel, presencial),
`consentTextVersion`. El formulario de clienta pide el consentimiento de forma
explícita y guarda qué texto se aceptó y cuándo. El texto vive en `settings`
con versión, para poder demostrar qué se aceptó en cada momento.

### Derechos de la clienta

- **Acceso y portabilidad**: `GET /api/clients/:id/export` devuelve toda su
  información (ficha, citas, facturas) en JSON y en PDF legible.
- **Supresión**: `POST /api/clients/:id/anonymize` borra nombre, email,
  teléfono, FPP y notas, y marca `anonymizedAt`. Las facturas se conservan con
  su copia fiscal, porque Hacienda obliga a guardarlas y el RGPD admite esa
  base legal.

Ese es el punto delicado de todo el bloque: "derecho al olvido" y "conserva
las facturas" se contradicen. Se resuelve anonimizando la ficha y conservando
el documento fiscal, no borrando a medias.

### Registro de accesos

`audit_log` del bloque 1 se extiende a las lecturas de fichas de clientas, no
solo a los cambios. Con datos de categoría especial hay que poder demostrar
quién vio qué. Vista "Registro" para `admin`, de solo lectura.

### Conservación

`settings.retentionYears` (por defecto 5). Una vista lista las fichas sin
actividad por encima de ese plazo y propone anonimizarlas. La decisión es
siempre manual: nada se borra automáticamente.

### Documentación

`docs/rgpd/`:

- `registro-actividades.md` — el RAT, con finalidad, base legal, categorías de
  datos, plazos y destinatarios.
- `encargados.md` — Vercel, Turso y Google, con el enlace a su contrato de
  encargado de tratamiento y la ubicación de los datos.
- `brecha.md` — qué hacer en 72 horas si hay una brecha.
- `politica-privacidad.md` — el texto para la web y para el consentimiento.

### Dónde viven los datos

Hay que verificar que la base de Turso esté en **región de la UE**. Si no lo
está, se migra. Turso cifra en reposo; la copia local `server/crm.db` no, así
que la recomendación es no tener datos reales en local y, si los hay, cifrar
el disco con BitLocker.

### Pruebas

`server/rgpd.test.mjs`: anonimizar borra los datos personales y conserva la
factura con su copia fiscal; la exportación incluye ficha, citas y facturas;
leer una ficha deja una entrada en el registro; un `pro` no ve el registro.

---

## Riesgos y cosas pendientes

- **Verifactu**: pendiente de confirmar con la gestoría si ya aplica. El
  diseño deja los campos del encadenado listos, pero no implementa el envío a
  la AEAT ni el QR. Si aplica, es un bloque 5.
- **Región de Turso**: a verificar antes de dar el RGPD por hecho.
- **Datos de prueba**: el `seed` actual inventa clientas con nombres y
  teléfonos. Al añadir el login hay que dejar de sembrar datos de ejemplo en
  producción; solo en local.
- La migración del esquema se hace con `ALTER TABLE ... ADD COLUMN` idempotente
  al arrancar, porque la base de producción ya tiene datos reales.
