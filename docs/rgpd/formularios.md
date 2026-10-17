# Formularios de consentimiento y de derechos

Tres documentos en PDF que el CRM prepara para que la clienta los firme (en
papel o por email). Salen con los datos fiscales de **Ajustes** como
responsable y, desde su ficha, con los datos de la clienta.

> **Esto es una plantilla razonable, no asesoramiento jurídico.** Antes de usarlos
> con clientas reales hay que revisar el texto con la asesoría (ver
> «Pendiente» al final).

Última revisión: 2026-10-17

## Los tres documentos

| Documento | Para qué | Dónde se descarga |
|---|---|---|
| **Consentimiento** | Información del Art. 13 y autorizaciones por separado | Ficha de la clienta · Ajustes · Privacidad (en blanco) |
| **Retirada del consentimiento** | Que la clienta retire lo que autorizó (Art. 7.3) | Ficha de la clienta · Ajustes · Privacidad (en blanco) |
| **Solicitud de derechos** | Acceso, rectificación, supresión, oposición, limitación y portabilidad | Ficha de la clienta · Ajustes · Privacidad (en blanco) |

### Consentimiento (2 hojas)

La **hoja 1** informa, con el mismo contenido que la
[política de privacidad](politica-privacidad.md): quién es el responsable, qué
datos se tratan y para qué, la base legal de cada uno, a quién se comunican, el
plazo de conservación (el de Ajustes) y los derechos, con la vía de reclamación
ante la AEPD.

La **hoja 2** recoge tres autorizaciones **independientes**, cada una con su
casilla, porque el RGPD no admite mezclar finalidades en un solo «acepto»:

1. **Datos de salud** (Art. 9.2.a). Es el *texto de consentimiento* de
   Ajustes · Privacidad, palabra por palabra. Necesaria para prestar el servicio.
2. **Datos del bebé**, firmada como madre, padre o tutor/a legal. Solo si el
   servicio incluye su seguimiento.
3. **Recordatorios** de citas y facturas por email o teléfono. Opcional: no
   puede condicionar el servicio.

La hoja de la firma lleva el nombre de la clienta y el pie indica la **versión**
del texto de consentimiento.

## Registrar que se ha firmado

El PDF no guarda nada por sí solo. En la ficha de la clienta, bloque
**Consentimiento (RGPD)**:

- **Registrar que lo ha firmado** anota la fecha (la del campo de arriba, o hoy),
  cómo lo dio (el canal; por defecto «Papel firmado») y la **versión vigente**
  del texto. Queda en el registro de accesos como *Consentimiento registrado*.
- **Retirar consentimiento** quita la constancia de la ficha y deja en el
  registro *Consentimiento retirado*, con cuándo se había dado. **No borra
  nada**: no se anotan más datos de salud, pero lo que ya hay sigue en la
  ficha. La supresión (que además pida que se borre) es otra decisión; las
  facturas se conservan siempre por obligación legal.
- Preparar un formulario con los datos de una clienta queda en el registro como
  *Formulario de consentimiento*. Los formularios en blanco no se registran.

Si se cambia el texto de consentimiento, hay que **subir la versión** (Ajustes ·
Privacidad). La ficha avisa cuando el texto aceptado por una clienta no es ya el
vigente.

## Qué pasa si faltan datos

Si Ajustes · Datos fiscales está incompleto, el formulario sale igual con los
huecos en blanco para escribirlos a mano. Una ficha anonimizada no admite
formularios con sus datos ni consentimiento nuevo.

## Pendiente

Antes de usarlos con clientas reales:

- [ ] Revisar con la asesoría el texto de los tres documentos.
- [ ] Confirmar la **base legal del Art. 9** (¿consentimiento explícito 9.2.a o
      asistencia sanitaria 9.2.h?): cambia lo que debe decir la hoja 1.
- [ ] Confirmar el plazo de conservación (5 años por defecto) y los plazos
      fiscales de las facturas.
- [ ] Decidir si los datos del bebé necesitan un documento propio en lugar de la
      casilla de la hoja 2.
- [ ] Rellenar los datos fiscales en Ajustes, que son los del responsable.

## Dónde está en el código

- `server/consent-forms.js` — los PDF (pdfkit) y las rutas.
- `GET /api/consent-forms/:kind` — `consentimiento`, `revocacion` o `derechos`;
  con `?clientId=` sale rellenado.
- `POST /api/clients/:id/consent` — `{ action: 'grant' | 'revoke', date?, channel? }`.
- `src/components/ConsentTools.jsx` — los botones de la ficha.
