# Qué hacer si hay una brecha de datos

Una brecha es cualquier acceso, pérdida o divulgación no autorizada de datos
personales. Aquí hay datos de salud, así que el listón de gravedad es alto y
los plazos son cortos.

**El plazo clave: 72 horas** desde que te enteras, para notificar a la AEPD si
la brecha supone un riesgo para las personas.

## En la primera hora: cortar

1. **Cerrar todas las sesiones.** Ajustes · Usuarios: desactiva las cuentas
   sospechosas. Desactivar una cuenta cierra sus sesiones al instante.
2. **Cambiar las contraseñas** de las cuentas afectadas (cambiarlas también
   cierra las demás sesiones de esa cuenta).
3. **Rotar las credenciales** en Vercel si pudieran estar comprometidas:
   `TURSO_AUTH_TOKEN` y `GMAIL_APP_PASSWORD`. Al rotarlas hay que volver a
   desplegar.
4. Si la aplicación entera está comprometida, quitarla de producción es
   preferible a dejarla expuesta.

## Ese mismo día: entender qué pasó

La vista **Privacidad · Registro de accesos** responde a casi todo:

- `Intento fallido` y `Cuenta bloqueada` → alguien probó contraseñas.
- `Entrada` desde una IP que no reconoces → alguien entró.
- `Consulta de ficha`, `Listado de clientas`, `Exportación de datos` → qué vio.
- `Cambio`, `Borrado`, `Anonimización` → qué tocó.

Anota: cuándo empezó, cuándo acabó, qué cuentas, qué fichas, cuántas personas
afectadas y qué categorías de datos (si hay datos de salud, dilo).

## Antes de 72 horas: notificar

**A la AEPD** (sede electrónica, formulario de brechas) salvo que sea
improbable que suponga un riesgo. Con datos de salud, lo normal es que haya que
notificar. Si no llegas con toda la información, se notifica igual y se
completa después: el plazo es para avisar, no para tenerlo todo resuelto.

**A las clientas afectadas**, sin demora, si la brecha supone un riesgo alto
para ellas. Con datos de salud expuestos, lo normal es que sí. Hay que decirles
en lenguaje claro qué ha pasado, qué datos, qué estás haciendo y a quién pueden
dirigirse.

## Después: dejarlo por escrito

Toda brecha se documenta aunque no se notifique, incluida la razón de no
notificar. La AEPD puede pedir ese registro.

Guarda aquí mismo, en `docs/rgpd/`, un fichero por incidente con: qué pasó,
cuándo se detectó, alcance, qué se hizo, si se notificó y por qué, y qué se ha
cambiado para que no vuelva a pasar.

## Contactos

| | |
|---|---|
| AEPD | www.aepd.es · sede electrónica |
| Asesoría | [rellenar] |
| Soporte Vercel / Turso | desde el panel de cada cuenta |
