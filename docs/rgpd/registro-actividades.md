# Registro de actividades de tratamiento (RAT)

> Plantilla rellenada con lo que el CRM hace de verdad. **Hay que completar lo
> que está entre corchetes** y revisarlo con tu asesoría antes de darlo por
> bueno. Este documento no es asesoramiento jurídico.

Última revisión: 2026-10-14

## Responsable del tratamiento

| | |
|---|---|
| Nombre / razón social | [el que figure en Ajustes · Datos fiscales] |
| NIF | [NIF] |
| Dirección | [dirección fiscal] |
| Contacto | [email y teléfono] |
| Delegado de protección de datos | No procede (actividad de pequeña escala) [confirmar] |

La escala importa: un tratamiento de datos de salud **a gran escala** obligaría
a nombrar un DPD y a hacer una evaluación de impacto. Para una consulta con una
o pocas profesionales no se considera gran escala, pero conviene que lo
confirme tu asesoría, porque es la diferencia entre un trámite y varios.

---

## Actividad 1 — Acompañamiento en maternidad

**Finalidad.** Prestar el servicio contratado (preparación al parto, hipnoparto,
acompañamiento en lactancia), gestionar las citas y hacer el seguimiento.

**Categorías de personas.** Clientas del servicio.

**Categorías de datos.**

- Identificativos: nombre y apellidos, email, teléfono.
- **Datos de salud (Art. 9 RGPD, categoría especial):** fecha probable de
  parto, semanas de gestación, servicio contratado y las notas de la ficha y de
  las citas, que pueden incluir información clínica y del embarazo.

**Base legal.**

- Art. 6.1.b (ejecución del contrato) para los datos identificativos.
- **Art. 9.2.a (consentimiento explícito)** para los datos de salud. El
  consentimiento se recoge en la ficha de la clienta (fecha, canal y versión
  del texto aceptado) y el texto vive en Ajustes · Privacidad.
- Art. 9.2.h (asistencia sanitaria) podría aplicar según cómo esté encuadrada
  la actividad profesional. **A confirmar con la asesoría**: cambia qué hay que
  documentar.

**Plazo de conservación.** Mientras dure la relación y [5] años después, que es
el plazo configurado en Ajustes. Pasado ese plazo, la vista Privacidad ·
Conservación propone las fichas afectadas y la anonimización la decide una
persona; no se borra nada automáticamente.

**Destinatarios.** Ninguno, salvo los encargados de tratamiento listados en
[`encargados.md`](encargados.md).

**Transferencias internacionales.** Ver `encargados.md`. **Pendiente de
verificar** que la base de datos de Turso esté en región de la UE.

**Medidas de seguridad.** Ver la sección final.

---

## Actividad 2 — Facturación

**Finalidad.** Emitir y conservar las facturas y cumplir las obligaciones
fiscales y contables.

**Categorías de personas.** Clientas a las que se factura.

**Categorías de datos.** Nombre, NIF, dirección fiscal, conceptos facturados e
importes. **Sin datos de salud:** el concepto de la factura describe el
servicio, no el estado de la clienta.

**Base legal.** Art. 6.1.c, obligación legal (normativa fiscal y mercantil).

**Plazo de conservación.** El que marque la normativa fiscal y mercantil
(orientativamente 4 años para lo fiscal y 6 para lo mercantil; **a confirmar
con la asesoría**).

Esta es la razón de que anonimizar una ficha no borre sus facturas: el derecho
de supresión no alcanza a lo que otra ley obliga a conservar. Cada factura
emitida guarda su propia copia de los datos fiscales, así que sigue siendo
válida aunque la ficha de la clienta se haya vaciado.

---

## Actividad 3 — Acceso al sistema

**Finalidad.** Controlar quién accede al CRM y poder demostrar quién ha
consultado o modificado datos de salud.

**Categorías de personas.** Profesionales con cuenta en el CRM.

**Categorías de datos.** Nombre, email, hash de la contraseña, fecha de último
acceso, dirección IP y navegador en el registro de accesos.

**Base legal.** Art. 6.1.f, interés legítimo en la seguridad del sistema, y
Art. 32 RGPD, que exige poder verificar el acceso a datos de categoría
especial.

**Plazo de conservación.** El registro de accesos crece sin límite. **Decisión
pendiente**: fijar un plazo (p. ej. 2 años) y purgarlo, equilibrando la
capacidad de demostrar accesos pasados con el principio de minimización.

---

## Medidas de seguridad aplicadas

- Acceso con contraseña; toda la API responde 401 sin sesión válida.
- Contraseñas con `scrypt`, nunca en claro ni reversibles.
- Sesiones en servidor, revocables al instante: desactivar una cuenta o
  cambiar la contraseña cierra sus sesiones abiertas.
- Cinco intentos fallidos bloquean la cuenta 15 minutos.
- Dos roles: `admin` y `pro`. El registro de accesos y los ajustes solo los ve
  `admin`.
- Registro de accesos con **las lecturas de fichas además de los cambios**,
  porque con datos de categoría especial hay que poder demostrar quién vio qué.
- HTTPS obligado por la plataforma; cabeceras CSP, HSTS, `nosniff`,
  `frame-ancestors 'none'` y `Cache-Control: no-store` en la API.
- Cifrado en reposo en la base de datos gestionada.
- Facturas inalterables una vez emitidas, con encadenado por hash.

## Pendiente

- [ ] Confirmar con la asesoría la base legal del Art. 9 y los plazos fiscales.
- [ ] Verificar que la base de Turso está en región de la UE.
- [ ] Fijar y aplicar un plazo de conservación del registro de accesos.
- [ ] Firmar los contratos de encargado con los proveedores (`encargados.md`).
- [ ] Publicar la política de privacidad y enlazarla desde donde se recoja el
      consentimiento.
