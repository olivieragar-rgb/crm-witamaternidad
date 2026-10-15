// Ajustes del negocio. Lo que antes estaba escrito en el código (datos
// fiscales, serie de facturación, tipos por defecto) vive aquí, para que se
// pueda cambiar sin tocar el código y para poder adaptar el CRM a otro
// negocio sin reescribirlo.
import express from 'express';
import { get, run } from './db.js';
import { requireAdmin, audit } from './auth.js';

export const DEFAULTS = {
  // Datos del emisor. Los marcados como obligatorios lo son por el art. 6.1
  // del RD 1619/2012 (Reglamento de facturacion): sin ellos la factura no es
  // valida, y por eso el sistema no deja emitir hasta tenerlos.
  issuer: {
    name: '', // 6.1.c  nombre y apellidos o razon social completa
    taxId: '', // 6.1.d  NIF
    address: '', // 6.1.e  domicilio
    postalCode: '',
    city: '',
    province: '',
    country: 'España',
    email: '',
    phone: '',
    // Solo para sociedades: la Ley de Sociedades de Capital obliga a hacer
    // constar los datos registrales en la documentacion mercantil. Una
    // autonoma lo deja vacio.
    registryData: '',
  },
  brand: {
    name: 'Wita',
    sidebarFooter: 'WawaywawO',
  },
  emailTemplate: {
    subject: 'Factura {{numero}} · {{negocio}}',
    greeting: 'Hola {{clienta}}, adjuntamos tu factura {{numero}} ({{fecha}}).',
    signature: '',
  },
  // Semanas de disponibilidad permanente alrededor de la FPP. Por defecto,
  // desde la semana 37 (termino) hasta dos despues de la fecha prevista.
  reminders: {
    // Dias de cortesia despues de la fecha de factura cuando no hay
    // vencimiento explicito: sin esto, una factura sin vencimiento no
    // venceria nunca y no aparecria en ningun aviso.
    graceDays: 15,
    appointmentDaysAhead: 2,
    invoiceSubject: 'Recordatorio de la factura {{numero}}',
    invoiceBody:
      'Hola {{clienta}},\n' +
      'Te recordamos que la factura {{numero}}, de {{total}}, vencio el {{vencimiento}}.\n' +
      'Si ya la has pagado, no hagas caso de este mensaje y disculpa las molestias.\n' +
      'Un abrazo.',
    appointmentSubject: 'Tu cita del {{fecha}}',
    appointmentBody:
      'Hola {{clienta}},\n' +
      'Te recordamos tu cita de {{servicio}} el {{fecha}} a las {{hora}} ({{modalidad}}).\n' +
      'Si no te viene bien, avisanos y la cambiamos.\n' +
      'Nos vemos.',
  },
  oncall: {
    weeksBefore: 3,
    weeksAfter: 2,
  },
  // Publicacion del calendario como suscripcion .ics. Arranca apagado: lo
  // que publica son datos personales y encenderlo tiene que ser una decision,
  // no algo que venga puesto.
  calendar: {
    feedToken: '',
    includeClientNames: 1,
    includeOnCall: 1,
  },
  privacy: {
    retentionYears: 5,
    consentVersion: '1',
    consentText:
      'Autorizo a que se traten mis datos, incluidos los de salud relacionados con el embarazo y la ' +
      'lactancia, con la única finalidad de prestarme el servicio contratado y cumplir las obligaciones ' +
      'legales y fiscales derivadas. Puedo acceder a ellos, rectificarlos, oponerme a su tratamiento o ' +
      'pedir su supresión escribiendo al responsable.',
  },
  invoicing: {
    series: '', // serie de las facturas ordinarias; vacía = solo año y correlativo
    rectifySeries: 'R', // serie de las rectificativas
    vatRate: 0,
    irpfRate: 0,
    dueDays: 0, // días de vencimiento desde la fecha de factura
    exemptionNote:
      'Operación exenta de IVA conforme al artículo 20.Uno.3º de la Ley 37/1992 del IVA (asistencia sanitaria).',
    paymentDetails: '',
    footer: '',
  },
};

/** Mezcla superficial sobre los valores por defecto: si falta una clave, vale la de fábrica. */
const withDefaults = (key, stored) => ({ ...DEFAULTS[key], ...(stored || {}) });

/** @param {keyof DEFAULTS} key */
export async function getSetting(key) {
  const row = await get('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return { ...DEFAULTS[key] };
  try {
    return withDefaults(key, JSON.parse(row.value));
  } catch {
    return { ...DEFAULTS[key] };
  }
}

export async function getSettings() {
  const out = {};
  for (const key of Object.keys(DEFAULTS)) out[key] = await getSetting(key);
  return out;
}

/**
 * Guarda solo las claves que existen en los valores por defecto: así el
 * cuerpo de la petición no puede meter campos arbitrarios en los ajustes.
 */
async function setSetting(key, patch) {
  const current = await getSetting(key);
  const next = { ...current };
  for (const field of Object.keys(DEFAULTS[key])) {
    if (patch?.[field] === undefined) continue;
    next[field] = typeof DEFAULTS[key][field] === 'number' ? Number(patch[field]) || 0 : String(patch[field]);
  }
  const exists = await get('SELECT key FROM settings WHERE key = ?', [key]);
  if (exists) {
    await run("UPDATE settings SET value = ?, updatedAt = datetime('now') WHERE key = ?", [
      JSON.stringify(next),
      key,
    ]);
  } else {
    await run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, JSON.stringify(next)]);
  }
  return next;
}

/** ¿Están los datos mínimos para emitir una factura válida? */
export function issuerIsComplete(issuer) {
  return !!(issuer.name && issuer.taxId && issuer.address && issuer.city);
}

export const settingsRouter = express.Router();

// Cualquiera que haya entrado puede leer los ajustes (la interfaz los
// necesita para pintar formularios y facturas); solo admin los cambia.
settingsRouter.get('/', async (req, res, next) => {
  try {
    res.json(await getSettings());
  } catch (e) {
    next(e);
  }
});

/**
 * Genera o revoca el enlace del calendario. El token no se escribe a mano:
 * se pide uno nuevo o se quita. Revocarlo deja fuera a cualquiera que tuviera
 * la URL, que es justo lo que hace falta si se comparte por error.
 */
settingsRouter.post('/calendar/token', requireAdmin, async (req, res, next) => {
  try {
    const { nuevoToken } = await import('./calendar.js');
    const value = await setSetting('calendar', {
      feedToken: req.body?.revoke ? '' : nuevoToken(),
    });
    await audit(req, {
      action: req.body?.revoke ? 'calendar_revoke' : 'calendar_token',
      entity: 'settings',
      entityId: 'calendar',
    });
    res.json(value);
  } catch (e) {
    next(e);
  }
});

settingsRouter.put('/:key', requireAdmin, async (req, res, next) => {
  try {
    const key = req.params.key;
    if (!Object.hasOwn(DEFAULTS, key)) return res.status(404).json({ error: 'Ajuste desconocido' });
    const value = await setSetting(key, req.body ?? {});
    await audit(req, { action: 'settings_update', entity: 'settings', entityId: key });
    res.json(value);
  } catch (e) {
    next(e);
  }
});
