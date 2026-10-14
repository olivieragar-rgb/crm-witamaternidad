# Encargados de tratamiento

Empresas que tratan datos de las clientas por cuenta del responsable. Con cada
una hace falta un contrato de encargado de tratamiento (Art. 28 RGPD). Los tres
ofrecen el suyo como adenda estándar que se acepta desde el panel de la cuenta.

Última revisión: 2026-10-14

| Proveedor | Para qué | Qué datos ve | Contrato |
|---|---|---|---|
| **Vercel** | Alojar la aplicación | Todo lo que pasa por la API, en tránsito | DPA en la configuración de la cuenta |
| **Turso** | Base de datos | **Todos**, incluidos los de salud, almacenados | DPA en la configuración de la cuenta |
| **Google (Gmail)** | Enviar las facturas por email | Nombre, email e importe de la clienta | DPA de Google Workspace |

## Lo que hay que verificar

### Turso — región de los datos ✅

**Verificado el 2026-10-14: la base está en Irlanda**, dentro de la Unión
Europea. No hay transferencia internacional del almacenamiento, que es lo que
más importa al contener datos de salud.

Si alguna vez se replica o se migra la base, hay que volver a comprobarlo:
sacarla de la UE obligaría a documentar la transferencia con cláusulas
contractuales tipo y una evaluación de impacto.

### Vercel — región de la función

La API se ejecuta en una región de Vercel. Conviene fijarla en Europa para
reducir el trasiego de datos fuera de la UE, aunque el almacenamiento (que es
lo que más importa) esté en Turso.

### Google — cuenta de envío

El envío de facturas usa una contraseña de aplicación de una cuenta de Gmail.
Si es una cuenta personal, el DPA de Workspace no aplica: para uso profesional
con datos de clientas conviene una cuenta de Google Workspace del negocio.

## Notas

- Los correos enviados quedan en la bandeja de "Enviados" de esa cuenta de
  Gmail, con el PDF de la factura adjunto. Es un almacén de datos personales
  más, y entra en los plazos de conservación.
- Las credenciales (`TURSO_AUTH_TOKEN`, `GMAIL_APP_PASSWORD`) viven en
  variables de entorno de Vercel y nunca en el repositorio.

## Pendiente

- [x] Verificar y documentar la región de la base de Turso → Irlanda (UE).
- [ ] Fijar la región de ejecución en Vercel en Europa.
- [ ] Aceptar y guardar copia de los tres DPA.
- [ ] Decidir si el envío de facturas pasa a una cuenta de Workspace.
