# CRM Witamaternidad

CRM/ERP propio para un servicio de acompañamiento en maternidad (hipnoparto y
lactancia, en Granada y online). Módulos: Panel, Clientas, Citas, Servicios y
Facturas. Interfaz React (Vite) y API Express; los datos se guardan en SQLite
en local y en Turso (libSQL) en producción.

## Desarrollo local

```bash
npm install
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:3001 (proxy desde la web en `/api`)
- Base de datos: `server/crm.db` (SQLite local, se crea y rellena sola con
  datos de ejemplo; en produccion arranca vacia).

La primera vez que se abre, la aplicacion pide crear la cuenta de
administradora. A partir de ahi hay que entrar con email y contrasena. Para
volver a ver esa pantalla en local, basta con borrar `server/crm.db`.

Pruebas del módulo de búsqueda:

```bash
npm test
```

## Despliegue en Vercel + Turso

En producción el sistema de archivos de Vercel no persiste, así que la base de
datos vive en Turso (SQLite en la nube). Pasos:

1. **Turso** — crear una base y obtener credenciales:
   - `TURSO_DATABASE_URL` (empieza por `libsql://`)
   - `TURSO_AUTH_TOKEN`
2. **GitHub** — subir este repositorio.
3. **Vercel** — importar el repo de GitHub y añadir esas dos variables de
   entorno. Vercel detecta Vite, compila el frontend a `dist/` y publica la API
   de `api/` como función serverless (ver `vercel.json`).

El esquema y los datos de ejemplo se crean automáticamente la primera vez.

## Acceso y datos personales

El CRM guarda datos de salud (embarazo, lactancia, notas), que el RGPD trata
como categoria especial. Por eso:

- Toda la API exige sesion; sin ella responde 401.
- Las contrasenas se guardan con `scrypt`, nunca en claro.
- La sesion va en una cookie `HttpOnly` y vive en la base de datos, asi que se
  puede revocar al instante (desactivar a alguien cierra sus sesiones).
- Cinco intentos fallidos bloquean la cuenta 15 minutos.
- Cada entrada, salida y cambio queda en la tabla `audit_log`.

Dos roles: `admin` (todo, incluidos usuarios) y `pro` (el trabajo diario).

## Facturacion

Una factura nace como **borrador**, sin numero, y se edita entera. Al
**emitirla** toma numero correlativo, guarda una copia de los datos fiscales
de emisor y clienta, y queda congelada: a partir de ahi solo cambia su estado
de cobro. Los errores se corrigen con una **factura rectificativa** enlazada a
la original, que es lo que exige la norma.

- El numero es `serie + ano + correlativo` (`2026-0001`, `R2026-0001`), unico
  por los tres a la vez, asi que el correlativo reinicia cada ano sin chocar.
- La copia de datos fiscales hace que una factura emitida no cambie aunque
  luego cambie la ficha de la clienta.
- Cada factura emitida guarda un hash encadenado con la anterior. No se envia
  a ningun sitio: esta para poder demostrar que el historico no se ha tocado,
  y para no rediseñar nada si Verifactu acaba aplicando.
- El PDF se genera en el servidor (`pdfkit`) y se adjunta al email junto al
  Excel.

Antes de poder emitir hay que rellenar los datos fiscales en **Ajustes**, y la
clienta necesita NIF en su ficha.

## Configuracion

Nada de lo propio del negocio esta escrito en el codigo. En **Ajustes** (solo
administradoras) se editan:

- **Datos fiscales**: nombre, NIF y direccion que salen en las facturas.
- **Facturacion**: series, IVA e IRPF por defecto, nota de exencion, datos de
  pago y pie de la factura.
- **Marca**: nombre, subtitulo y pie de la barra lateral.
- **Email**: asunto y texto del correo de factura, con los marcadores
  `{{clienta}}`, `{{numero}}`, `{{fecha}}`, `{{total}}` y `{{negocio}}`.
- **Listas**: las opciones de los desplegables (servicios, modalidades,
  estados de clienta y de cita, formas de pago).

Desactivar una opcion de una lista la quita de los formularios nuevos pero no
toca las fichas que ya la usaban, y renombrarla tampoco reescribe lo ya
guardado: cambiar la lista de opciones no deberia reescribir el pasado.

## Agenda de guardia

Alrededor de la fecha probable de parto hay unas semanas de disponibilidad
permanente, configurables en Ajustes (por defecto 3 antes y 2 despues). El
calendario pinta esa franja para cada clienta, en verde con una guardia y en
terracota cuando hay dos a la vez, y el formulario de clienta avisa del choque
mientras se escribe la FPP, que es cuando sirve de algo. Avisa, no bloquea.

## Gastos e impuestos

Los gastos se registran con base, IVA, categoria y si son deducibles. La vista
Gastos resume el trimestre con las cifras del **modelo 303** (IVA repercutido
menos soportado deducible) y del **130** (rendimiento, el 20%, menos las
retenciones ya practicadas en factura).

Las facturas cuentan por fecha de factura, no de cobro, que es el criterio de
devengo del IVA. Anuladas, rectificadas y borradores quedan fuera. **No
presenta nada ante Hacienda**: da los numeros para rellenar el modelo o
pasarselos a la gestoria.

## Recordatorios

El inicio lista las facturas pasadas de vencimiento y las citas proximas.
Nada se envia solo: se puede leer el texto antes de mandarlo y hay que
confirmar cada envio. Las plantillas se editan en Ajustes.

## Herramientas

Dos calculadoras de consulta, en su propia seccion:

- **Fecha probable de parto**: regla de Naegele, 280 dias desde la ultima
  regla, con las semanas de gestacion de hoy.
- **Percentil de peso**: peso para la edad segun los **patrones de crecimiento
  infantil de la OMS**, del nacimiento a los 24 meses, con la curva del bebe
  sobre las de referencia.

Los datos de la OMS no estan escritos a mano: `scripts/build-who-data.mjs` los
genera desde los ficheros oficiales, y las pruebas comprueban que el calculo a
partir de L, M y S reproduce los pesos que publica la propia OMS, con 126
comparaciones dentro de un gramo.

Es una ayuda visual para la consulta, no un diagnostico, y la pantalla lo dice.
Lo que se teclea ahi no se guarda en el CRM.

## Proteccion de datos

El CRM guarda datos de embarazo, lactancia y notas de seguimiento: **datos de
salud, categoria especial del Art. 9 del RGPD**. Lo que hace el sistema:

- La ficha de clienta recoge el **consentimiento** con fecha, canal y version
  del texto aceptado. El texto se edita en Ajustes · Privacidad.
- **Derecho de acceso y portabilidad**: el boton "Datos" descarga todo lo que
  el sistema guarda de esa clienta, con sus citas y sus facturas.
- **Derecho de supresion**: "Anonimizar" vacia nombre, contacto, FPP, notas y
  datos fiscales de la ficha, y tambien las notas de sus citas. Las facturas
  se conservan, porque la ley obliga: cada una guarda su propia copia de los
  datos fiscales, asi que sigue siendo valida con la ficha ya vaciada.
- **Registro de accesos** (Privacidad · Registro): quien entro, que ficha
  consulto y que cambio. Con datos de categoria especial hay que poder
  demostrar quien vio que, no solo quien cambio que.
- **Conservacion**: Privacidad · Conservacion lista las fichas sin actividad
  por encima del plazo configurado y propone anonimizarlas. Nunca se borra
  nada de forma automatica.

La base de datos esta en **Irlanda (UE)**, asi que no hay transferencia
internacional del almacenamiento.

En `docs/rgpd/` estan el registro de actividades de tratamiento, los
encargados de tratamiento, el protocolo de brecha y el borrador de politica de
privacidad. Llevan apartados entre corchetes que hay que completar **antes de
dar de alta a la primera clienta real**; mientras el uso sea propio y con
datos de prueba, quedan como borrador.

**Verifactu no aplica todavia.** El CRM ya guarda el hash encadenado de cada
factura emitida, asi que el dia que aplique faltaria anadir el QR y el envio a
la AEAT, no rediseñar el modelo de datos.

## Estructura

```
api/index.js         Punto de entrada serverless (Vercel)
server/app.js        App Express con todas las rutas
server/auth.js       Sesiones, usuarios y registro de accesos
server/passwords.js  Hash de contrasenas con scrypt
server/security.js   Cabeceras, cookies y comprobacion de origen
server/invoices.js   Facturacion: borrador, emision, rectificativas
server/invoice-pdf.js  PDF de factura
server/settings.js   Ajustes del negocio (datos fiscales, facturacion, marca)
server/catalogs.js   Listas desplegables editables
server/oncall.js     Ventanas de guardia alrededor de la FPP
server/expenses.js   Gastos y resumen del 303 y el 130
server/reminders.js  Recordatorios de cobro y de cita
server/privacy.js    Derechos de la clienta, conservacion y registro de accesos
src/lib/growth.js    Percentiles de peso (metodo LMS de la OMS)
src/data/           Tablas de la OMS, generadas por scripts/build-who-data.mjs
src/config.jsx       Ajustes y catalogos cargados una vez para toda la app
docs/rgpd/           RAT, encargados, protocolo de brecha, politica
server/db.js         Capa de datos (node:sqlite en local, Turso en produccion)
server/index.js      Punto de entrada local
src/                 Frontend React (vistas por modulo)
src/search.js        Filtro de busqueda compartido cliente/servidor
docs/superpowers/    Documentos de diseno
```
