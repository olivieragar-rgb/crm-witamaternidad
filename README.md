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

## Estructura

```
api/index.js         Punto de entrada serverless (Vercel)
server/app.js        App Express con todas las rutas
server/auth.js       Sesiones, usuarios y registro de accesos
server/passwords.js  Hash de contrasenas con scrypt
server/security.js   Cabeceras, cookies y comprobacion de origen
server/db.js         Capa de datos (node:sqlite en local, Turso en produccion)
server/index.js      Punto de entrada local
src/                 Frontend React (vistas por modulo)
src/search.js        Filtro de busqueda compartido cliente/servidor
docs/superpowers/    Documentos de diseno
```
