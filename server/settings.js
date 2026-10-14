// Ajustes del negocio. Lo que antes estaba escrito en el código (datos
// fiscales, serie de facturación, tipos por defecto) vive aquí, para que se
// pueda cambiar sin tocar el código y para poder adaptar el CRM a otro
// negocio sin reescribirlo.
import express from 'express';
import { get, run } from './db.js';
import { requireAdmin, audit } from './auth.js';

export const DEFAULTS = {
  issuer: {
    name: '',
    taxId: '',
    address: '',
    postalCode: '',
    city: '',
    province: '',
    country: 'España',
    email: '',
    phone: '',
  },
  brand: {
    name: 'Witamaternidad',
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
