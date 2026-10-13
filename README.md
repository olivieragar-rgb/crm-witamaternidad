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
- Base de datos: `server/crm.db` (SQLite local, se crea y rellena sola).

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

## Estructura

```
api/index.js        Punto de entrada serverless (Vercel)
server/app.js       App Express con todas las rutas
server/db.js        Capa de datos (node:sqlite en local, Turso en producción)
server/index.js     Punto de entrada local
src/                Frontend React (vistas por módulo)
src/search.js       Filtro de búsqueda compartido cliente/servidor
```
