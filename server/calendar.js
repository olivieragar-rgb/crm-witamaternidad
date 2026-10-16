// Publicación del calendario del CRM como suscripción iCalendar.
//
// Google Calendar (y Apple, y Outlook) saben suscribirse a una URL .ics y
// refrescarla solas. Con eso las citas del CRM aparecen dentro del calendario
// personal sin que haya que copiar nada a mano.
//
// Es de ida: el CRM manda sus citas al calendario. Traer los eventos de
// Google al CRM exige OAuth y un proyecto en Google Cloud, que es otra cosa.
//
// La URL lleva un token secreto porque lo que publica son datos personales:
// nombres de clientas y a qué hora las ve. Quien tenga la URL lo ve todo, así
// que el token se genera a propósito, se puede revocar, y el feed puede
// publicarse sin nombres.
import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { all } from './db.js';
import { getSetting } from './settings.js';

/** Escapa según RFC 5545: comas, puntos y comas, barras y saltos de línea. */
const esc = (s) =>
  String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

/** 'YYYY-MM-DD HH:mm' -> 'YYYYMMDDTHHMMSS' (hora local del evento). */
function toIcsLocal(fecha) {
  const [d, h = '00:00'] = String(fecha || '').split(' ');
  const [y, m, dd] = d.split('-');
  const [hh, mm] = h.split(':');
  if (!y || !m || !dd) return null;
  return `${y}${m}${dd}T${(hh || '00').padStart(2, '0')}${(mm || '00').padStart(2, '0')}00`;
}

const toIcsDate = (fecha) => String(fecha || '').slice(0, 10).replace(/-/g, '');

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Las líneas de un .ics no pueden pasar de 75 octetos; se parten con un espacio. */
function fold(line) {
  const out = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 73) {
    let corte = 73;
    while (Buffer.byteLength(rest.slice(0, corte)) > 73) corte--;
    out.push(rest.slice(0, corte));
    rest = ' ' + rest.slice(corte);
  }
  out.push(rest);
  return out.join('\r\n');
}

/**
 * Construye el calendario.
 * @param {{ nombre: string, conNombres: boolean, conPartos: boolean }} opciones
 */
export async function buildIcs({ nombre, conNombres, conPartos }) {
  const citas = await all(
    `SELECT a.id, a.date, a.mode, a.status, a.notes, c.name AS clientName, s.name AS serviceName,
            s.durationMin AS durationMin
     FROM appointments a
     LEFT JOIN clients c ON c.id = a.clientId
     LEFT JOIN services s ON s.id = a.serviceId
     WHERE a.date <> '' AND a.status <> 'Cancelada'
     ORDER BY a.date`,
  );

  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Wita CRM//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(nombre)}`,
    'X-WR-TIMEZONE:Europe/Madrid',
    // Cada media hora es suficiente: una cita no se mueve cada minuto.
    'REFRESH-INTERVAL;VALUE=DURATION:PT30M',
    'X-PUBLISHED-TTL:PT30M',
  ];

  for (const cita of citas) {
    const inicio = toIcsLocal(cita.date);
    if (!inicio) continue;
    const mins = Number(cita.durationMin) || 60;
    const fin = toIcsLocal(sumarMinutos(cita.date, mins));
    // Sin nombres, el evento dice qué hay pero no con quién: útil para quien
    // comparte el calendario del móvil con su pareja.
    const quien = conNombres ? cita.clientName || 'Cita' : 'Cita';
    const titulo = [quien, cita.serviceName].filter(Boolean).join(' · ');

    lineas.push(
      'BEGIN:VEVENT',
      `UID:cita-${cita.id}@wita-crm`,
      `DTSTAMP:${stamp()}`,
      `DTSTART;TZID=Europe/Madrid:${inicio}`,
      `DTEND;TZID=Europe/Madrid:${fin}`,
      fold(`SUMMARY:${esc(titulo)}`),
      cita.mode ? fold(`LOCATION:${esc(cita.mode)}`) : null,
      conNombres && cita.notes ? fold(`DESCRIPTION:${esc(cita.notes)}`) : null,
      `STATUS:${cita.status === 'Realizada' ? 'CONFIRMED' : 'CONFIRMED'}`,
      'END:VEVENT',
    );
  }

  if (conPartos) {
    const clientas = await all(
      `SELECT id, name, dueDate FROM clients
       WHERE dueDate <> '' AND (anonymizedAt IS NULL OR anonymizedAt = '')`,
    );
    for (const c of clientas) {
      const inicio = desplazar(c.dueDate, 0);
      // DTEND de un evento de día completo es exclusivo: un día más.
      const fin = desplazar(c.dueDate, 1);
      if (!inicio || !fin) continue;
      lineas.push(
        'BEGIN:VEVENT',
        `UID:fpp-${c.id}@wita-crm`,
        `DTSTAMP:${stamp()}`,
        `DTSTART;VALUE=DATE:${toIcsDate(inicio)}`,
        `DTEND;VALUE=DATE:${toIcsDate(fin)}`,
        fold(`SUMMARY:Fecha probable de parto${conNombres ? ` · ${esc(c.name)}` : ''}`),
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
      );
    }
  }

  lineas.push('END:VCALENDAR');
  return lineas.filter(Boolean).join('\r\n') + '\r\n';
}

function sumarMinutos(fecha, mins) {
  const [d, h = '00:00'] = String(fecha).split(' ');
  const base = new Date(`${d}T${h}:00Z`);
  base.setUTCMinutes(base.getUTCMinutes() + mins);
  return `${base.toISOString().slice(0, 10)} ${base.toISOString().slice(11, 16)}`;
}

function desplazar(iso, dias) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Comparación en tiempo constante, para que el token no se pueda adivinar a base de intentos. */
function mismoToken(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export const nuevoToken = () => randomBytes(24).toString('base64url');

export const calendarRouter = express.Router();

/**
 * El feed. No lleva sesión a propósito: quien lo pide son los servidores de
 * Google, que no pueden iniciar sesión. Lo que lo protege es el token.
 */
// Cualquier otra forma de la URL responde igual que un token equivocado. Si
// no, una URL mal pegada cae en la zona con sesion y contesta 401, que
// confunde y ademas delata que ahi hay algo.
calendarRouter.use((req, res, next) => {
  if (/^\/[A-Za-z0-9_-]+\.ics$/.test(req.path)) return next();
  res.status(404).type('text/plain').send('No encontrado');
});

calendarRouter.get('/:token.ics', async (req, res, next) => {
  try {
    const cfg = await getSetting('calendar');
    if (!cfg.feedToken || !mismoToken(req.params.token, cfg.feedToken)) {
      return res.status(404).type('text/plain').send('No encontrado');
    }
    const brand = await getSetting('brand');
    const ics = await buildIcs({
      nombre: `${brand.name} · Citas`,
      conNombres: !!cfg.includeClientNames,
      conPartos: !!cfg.includeOnCall,
    });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="wita.ics"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(ics);
  } catch (e) {
    next(e);
  }
});
