// Formularios de consentimiento y de derechos del RGPD, en PDF.
//
// Tres documentos, pensados para imprimir y firmar (o enviar por email):
//
//   consentimiento  información del Art. 13 + autorizaciones por separado
//                   (datos de salud, datos del bebé, comunicaciones)
//   revocacion      retirada del consentimiento
//   derechos        solicitud de acceso, rectificación, supresión, oposición,
//                   limitación y portabilidad
//
// Se rellenan con los datos fiscales de Ajustes (el responsable) y con la ficha
// de la clienta si se pide con su id. Si falta un dato sale una línea en blanco
// para escribirlo a mano: un formulario con huecos sirve; uno que no se puede
// generar, no.
//
// La autorización de los datos de salud es el texto de consentimiento de
// Ajustes · Privacidad, tal cual, y el pie lleva su versión. Así lo que firma
// la clienta es lo que queda registrado en su ficha.
//
// Esto es una plantilla razonable, no asesoramiento jurídico: la base legal del
// Art. 9 y los plazos están pendientes de confirmar con la asesoría
// (docs/rgpd/registro-actividades.md).
import express from 'express';
import PDFDocument from 'pdfkit';
import { get, run } from './db.js';
import { audit } from './auth.js';
import { getSetting } from './settings.js';

const INK = '#2e2a25';
const SOFT = '#55504a';
const MUTED = '#7d766c';
const RULE = '#b9b1a5';
const ACCENT = '#476149';

const MARGIN = 54;
const BOX = 11;

/** Qué formularios hay, y cómo se llama el fichero de cada uno. */
export const FORMS = {
  consentimiento: { file: 'consentimiento' },
  revocacion: { file: 'retirada-consentimiento' },
  derechos: { file: 'solicitud-derechos' },
};

const fmtDate = (d) => {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return y && m && day ? `${day}/${m}/${y}` : String(d);
};
const today = () => new Date().toISOString().slice(0, 10);
const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';

/** "Lucía Fernández" -> "lucia-fernandez", para el nombre del fichero. */
export const slug = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// ---- piezas de dibujo ----------------------------------------------------

const width = (doc) => doc.page.width - MARGIN * 2;

/** Si lo que sigue no cabe, página nueva. */
function need(doc, h) {
  if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function title(doc, text, sub) {
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(text, MARGIN, doc.y, { width: width(doc) });
  if (sub) {
    doc.moveDown(0.3).font('Helvetica').fontSize(9).fillColor(MUTED).text(sub, { width: width(doc) });
  }
  doc.moveDown(0.9);
}

function heading(doc, text) {
  need(doc, 60);
  doc.moveDown(0.5).font('Helvetica-Bold').fontSize(10.5).fillColor(ACCENT).text(text, MARGIN, doc.y, { width: width(doc) });
  doc.moveDown(0.25);
}

function para(doc, text, opts = {}) {
  doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 9.5).fillColor(opts.color || INK);
  doc.text(text, MARGIN + (opts.indent || 0), doc.y, {
    width: width(doc) - (opts.indent || 0),
    lineGap: 2,
    align: 'left',
  });
  doc.moveDown(opts.gap ?? 0.5);
}

/** "Etiqueta: valor", con una línea para escribir a mano si no hay valor. */
function field(doc, label, value, labelW = 150) {
  need(doc, 24);
  const y = doc.y;
  doc.font('Helvetica').fontSize(9.5).fillColor(SOFT).text(label, MARGIN, y, { width: labelW, lineBreak: false });
  if (has(value)) {
    doc.font('Helvetica-Bold').fillColor(INK).text(String(value), MARGIN + labelW, y, { width: width(doc) - labelW });
  } else {
    doc.moveTo(MARGIN + labelW, y + 11).lineTo(MARGIN + width(doc), y + 11).lineWidth(0.6).strokeColor(RULE).stroke();
  }
  doc.y = y + 20;
}

/** Un espacio en blanco con renglones, para lo que se escribe a mano. */
function lines(doc, n) {
  for (let i = 0; i < n; i++) {
    need(doc, 20);
    const y = doc.y + 14;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + width(doc), y).lineWidth(0.6).strokeColor(RULE).stroke();
    doc.y = y + 6;
  }
}

/** Casilla cuadrada (Helvetica no tiene ☐) con su texto al lado. */
function checkbox(doc, text, { note, bold } = {}) {
  const w = width(doc) - 22;
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5);
  let h = doc.heightOfString(text, { width: w, lineGap: 2 });
  if (note) h += doc.font('Helvetica').fontSize(8.5).heightOfString(note, { width: w }) + 3;
  need(doc, h + 10);
  const y = doc.y;
  doc.rect(MARGIN + 1, y + 1, BOX, BOX).lineWidth(0.9).strokeColor(INK).stroke();
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(INK).text(text, MARGIN + 22, y, { width: w, lineGap: 2 });
  if (note) {
    doc.moveDown(0.15).font('Helvetica').fontSize(8.5).fillColor(MUTED).text(note, MARGIN + 22, doc.y, { width: w });
  }
  doc.y += 7;
  doc.x = MARGIN;
}

function signature(doc, { who = 'Firma de la clienta', place = true } = {}) {
  need(doc, 120);
  doc.moveDown(1);
  const y = doc.y;
  const half = width(doc) / 2 - 15;
  if (place) {
    doc.font('Helvetica').fontSize(9.5).fillColor(SOFT).text('Lugar y fecha', MARGIN, y + 52, { width: half, lineBreak: false });
    doc.moveTo(MARGIN, y + 48).lineTo(MARGIN + half, y + 48).lineWidth(0.6).strokeColor(INK).stroke();
  }
  const x2 = MARGIN + half + 30;
  doc.moveTo(x2, y + 48).lineTo(x2 + half, y + 48).lineWidth(0.6).strokeColor(INK).stroke();
  doc.font('Helvetica').fontSize(9.5).fillColor(SOFT).text(who, x2, y + 52, { width: half, lineBreak: false });
  doc.y = y + 80;
  doc.x = MARGIN;
}

/** Quién es el responsable, arriba de cada formulario. */
function header(doc, issuer) {
  const name = has(issuer?.name) ? issuer.name : '';
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(name || '________________________', MARGIN, MARGIN, { width: width(doc) });
  const bits = [
    has(issuer?.taxId) ? `NIF ${issuer.taxId}` : '',
    [issuer?.address, [issuer?.postalCode, issuer?.city].filter(has).join(' '), issuer?.province].filter(has).join(', '),
    [issuer?.email, issuer?.phone].filter(has).join(' · '),
  ].filter(has);
  if (bits.length) doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(bits.join('  ·  '), { width: width(doc) });
  doc.moveDown(0.5);
  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + width(doc), doc.y).lineWidth(0.8).strokeColor(ACCENT).stroke();
  doc.moveDown(1);
}

/** Pie de la última página: versión del texto y fecha. Fuera del margen, sin crear página. */
function footer(doc, text) {
  const mb = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(text, MARGIN, doc.page.height - 38, {
    width: width(doc),
    lineBreak: false,
  });
  doc.page.margins.bottom = mb;
}

// ---- datos que se repiten ------------------------------------------------

function responsable(issuer) {
  const who = has(issuer?.name) ? issuer.name : '________________________';
  const nif = has(issuer?.taxId) ? issuer.taxId : '__________';
  const dir = [issuer?.address, [issuer?.postalCode, issuer?.city].filter(has).join(' ')].filter(has).join(', ') || '________________________';
  const via = [issuer?.email, issuer?.phone].filter(has).join(' o ') || '________________________';
  return { who, nif, dir, via };
}

function personData(doc, client) {
  heading(doc, 'Tus datos');
  field(doc, 'Nombre y apellidos', client?.name);
  field(doc, 'NIF / DNI', client?.taxId);
  field(doc, 'Email', client?.email);
  field(doc, 'Teléfono', client?.phone);
}

// ---- los tres formularios ------------------------------------------------

function drawConsent(doc, { issuer, privacy, client }) {
  const r = responsable(issuer);
  const years = Number(privacy?.retentionYears) || 5;
  header(doc, issuer);
  title(
    doc,
    'Consentimiento para el tratamiento de datos personales y de salud',
    'Información y autorización conforme al Reglamento (UE) 2016/679 (RGPD) y a la Ley Orgánica 3/2018.',
  );
  personData(doc, client);

  heading(doc, '1. Quién trata tus datos');
  para(doc, `${r.who}, con NIF ${r.nif} y domicilio en ${r.dir}. Puedes escribirnos o llamarnos en ${r.via}.`);

  heading(doc, '2. Qué datos tratamos y para qué');
  para(
    doc,
    'Tus datos de contacto (nombre, email y teléfono), para ponernos en contacto contigo y organizar las sesiones. ' +
      'Tu fecha probable de parto, el servicio contratado y las notas que tomamos en las sesiones, que pueden incluir ' +
      'información sobre tu embarazo, tu parto o tu lactancia: son datos de salud, y la ley los protege de forma ' +
      'especial (Art. 9 del RGPD). Si te emitimos factura, tu NIF y tu dirección fiscal. Los usamos solo para ' +
      'prestarte el servicio contratado, hacer el seguimiento y cumplir las obligaciones legales y fiscales.',
  );

  heading(doc, '3. Por qué podemos tratarlos');
  para(
    doc,
    'Los datos de contacto y del servicio, porque hacen falta para prestarte el servicio contratado (Art. 6.1.b). ' +
      'Los datos de salud, porque nos autorizas expresamente (Art. 9.2.a): puedes retirar esa autorización cuando ' +
      'quieras, sin dar explicaciones, y retirarla no afecta a lo que hicimos antes. Los datos de la factura, ' +
      'porque la normativa fiscal nos obliga a emitirla y conservarla (Art. 6.1.c).',
  );

  heading(doc, '4. A quién se los comunicamos');
  para(
    doc,
    'A nadie, salvo a las empresas que nos prestan servicios técnicos y que tratan los datos solo siguiendo ' +
      'nuestras instrucciones: la que aloja nuestro sistema, la que guarda la base de datos (dentro de la Unión ' +
      'Europea) y la que nos presta el correo con el que te enviamos la factura. No vendemos tus datos ni los ' +
      'usamos para publicidad.',
  );

  heading(doc, '5. Cuánto tiempo los guardamos');
  para(
    doc,
    `Mientras dure nuestra relación y ${years} años más; después revisamos tu ficha y borramos tus datos personales. ` +
      'Las facturas las conservamos el tiempo que exige la normativa fiscal, aunque pidas que borremos el resto.',
  );

  heading(doc, '6. Tus derechos');
  para(
    doc,
    `Puedes pedirnos acceso a tus datos, que los corrijamos, que los borremos, oponerte a su uso, que limitemos su ` +
      `tratamiento o llevártelos (portabilidad), escribiéndonos a ${r.via}. Respondemos en el plazo de un mes. ` +
      'Si crees que no hemos cumplido, puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).',
  );

  // El título, las casillas y la firma van juntos: que no se quede el título
  // solo al pie de una hoja y las casillas en la siguiente.
  need(doc, 330);
  // La hoja de la firma tiene que decir de quién es: el nombre está en la primera.
  para(doc, `${has(client?.name) ? client.name : 'Nombre: ________________________'}  ·  ${r.who}`, {
    color: MUTED,
    size: 8.5,
    gap: 0,
  });
  heading(doc, 'Autorizaciones');
  para(doc, 'Marca las casillas con las que estés de acuerdo. Son independientes: puedes aceptar unas y otras no.', {
    color: MUTED,
    size: 8.5,
  });
  checkbox(doc, String(privacy?.consentText || '').trim() || '________________________________', {
    note: 'Necesaria para poder prestarte el servicio.',
  });
  checkbox(
    doc,
    'Como madre, padre o tutor/a legal, autorizo también el tratamiento de los datos de salud de mi hijo/a ' +
      '(fecha de nacimiento, peso y datos de lactancia) con la misma finalidad.',
    { note: 'Solo si el servicio incluye el seguimiento del bebé.' },
  );
  checkbox(
    doc,
    'Autorizo que se me envíen recordatorios de mis citas y de mis facturas por email o por teléfono.',
    { note: 'Opcional: no hace falta para recibir el servicio y puedes retirarla cuando quieras.' },
  );

  signature(doc, { who: 'Firma de la clienta' });
  para(doc, 'Se entrega una copia de este documento a la clienta.', { color: MUTED, size: 8.5, gap: 0 });
}

function drawRevocation(doc, { issuer, privacy, client }) {
  const r = responsable(issuer);
  header(doc, issuer);
  title(doc, 'Retirada del consentimiento', 'Art. 7.3 del RGPD: puedes retirarlo en cualquier momento y sin dar explicaciones.');
  personData(doc, client);

  heading(doc, 'Qué retiras');
  const given = client?.consentAt
    ? `el ${fmtDate(client.consentAt)}${client.consentVersion ? ` (versión ${client.consentVersion} del texto)` : ''}`
    : 'en la fecha que consta en mi ficha';
  para(
    doc,
    `Retiro el consentimiento que presté ${given} a ${r.who} para el tratamiento de los datos que marco a continuación:`,
  );
  checkbox(doc, 'Mis datos de salud (embarazo, parto, lactancia y notas de las sesiones).');
  checkbox(doc, 'Los datos de salud de mi hijo/a.');
  checkbox(doc, 'El envío de recordatorios y comunicaciones por email o por teléfono.');

  heading(doc, 'Qué entiendo');
  para(
    doc,
    'Retirar el consentimiento no afecta al tratamiento hecho antes de hoy. Las facturas ya emitidas se conservan ' +
      'porque la normativa fiscal lo exige. Sin mi autorización para los datos de salud, no se pueden seguir ' +
      'anotando datos míos en las sesiones.',
  );

  heading(doc, 'Además, quiero que');
  checkbox(doc, 'Se borren mis datos personales y las notas de mi ficha (derecho de supresión).');
  checkbox(doc, 'Se me entregue antes una copia de mis datos (derecho de acceso).');

  signature(doc, { who: 'Firma de la clienta' });
  para(
    doc,
    `Entrégalo en persona o envíalo a ${r.via}. Responderemos en el plazo de un mes.`,
    { color: MUTED, size: 8.5, gap: 0 },
  );
}

function drawRights(doc, { issuer, client }) {
  const r = responsable(issuer);
  header(doc, issuer);
  title(doc, 'Solicitud de ejercicio de derechos de protección de datos', 'Arts. 15 a 22 del RGPD.');
  personData(doc, client);

  heading(doc, 'Qué solicitas');
  checkbox(doc, 'Acceso: quiero saber qué datos míos guardáis y recibir una copia.', { bold: true });
  checkbox(doc, 'Rectificación: quiero que corrijáis un dato que es incorrecto o está incompleto.', { bold: true });
  checkbox(doc, 'Supresión: quiero que borréis mis datos.', {
    bold: true,
    note: 'Las facturas ya emitidas se conservan por obligación legal.',
  });
  checkbox(doc, 'Oposición: me opongo a que tratéis mis datos para una finalidad concreta.', { bold: true });
  checkbox(doc, 'Limitación: quiero que dejéis de usar mis datos mientras se resuelve una duda o reclamación.', { bold: true });
  checkbox(doc, 'Portabilidad: quiero recibir mis datos en un formato que pueda llevarme a otro sitio.', { bold: true });

  heading(doc, 'Explica tu solicitud');
  para(doc, 'Qué dato o qué tratamiento, y qué quieres que hagamos:', { color: MUTED, size: 8.5, gap: 0 });
  lines(doc, 5);

  heading(doc, 'Cómo lo comprobamos');
  para(
    doc,
    'Para que nadie acceda a tus datos haciéndose pasar por ti, tráenos tu DNI o adjunta una copia al enviarlo. ' +
      `${r.who} responderá en el plazo de un mes, ampliable dos meses más si la solicitud es muy compleja, y te lo avisará.`,
  );

  signature(doc, { who: 'Firma de la solicitante' });
  para(
    doc,
    `Entrégalo en persona o envíalo a ${r.via}. Si no estás conforme con la respuesta, puedes reclamar ante la ` +
      'Agencia Española de Protección de Datos (www.aepd.es).',
    { color: MUTED, size: 8.5, gap: 0 },
  );
}

const DRAW = { consentimiento: drawConsent, revocacion: drawRevocation, derechos: drawRights };

/**
 * @param {keyof typeof FORMS} kind
 * @param {{ issuer: object, privacy: object, client?: object|null }} ctx
 * @returns {Promise<Buffer>}
 */
export function consentFormPdf(kind, { issuer, privacy, client = null }) {
  if (!DRAW[kind]) throw new Error(`Formulario desconocido: ${kind}`);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: FORMS[kind].file } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    DRAW[kind](doc, { issuer, privacy, client });
    // La versión del texto solo importa donde hay un consentimiento de por medio.
    const conVersion = kind !== 'derechos' && has(privacy?.consentVersion);
    const version = conVersion ? `Texto de consentimiento: versión ${privacy.consentVersion}  ·  ` : '';
    footer(doc, `${version}Documento generado el ${fmtDate(today())}`);
    doc.end();
  });
}

// ---- rutas ---------------------------------------------------------------

export const consentFormsRouter = express.Router();

/**
 * El formulario en PDF. Con `?clientId=` sale con los datos de la clienta (y
 * queda en el registro de accesos); sin él, en blanco, para imprimir.
 */
consentFormsRouter.get('/:kind', async (req, res, next) => {
  try {
    const kind = String(req.params.kind).replace(/\.pdf$/, '');
    if (!FORMS[kind]) return res.status(404).json({ error: 'Ese formulario no existe' });

    let client = null;
    if (req.query.clientId) {
      client = await get('SELECT * FROM clients WHERE id = ?', [Number(req.query.clientId)]);
      if (!client) return res.status(404).json({ error: 'No encontrada' });
      if (client.anonymizedAt) {
        return res.status(409).json({ error: 'Esta ficha está anonimizada: ya no se puede preparar un formulario con sus datos' });
      }
    }
    const [issuer, privacy] = await Promise.all([getSetting('issuer'), getSetting('privacy')]);
    const pdf = await consentFormPdf(kind, { issuer, privacy, client });
    if (client) await audit(req, { action: 'consent_form', entity: 'clients', entityId: client.id, detail: kind });

    const file = `${FORMS[kind].file}-${client ? slug(client.name) || client.id : 'en-blanco'}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${file}"`);
    res.send(pdf);
  } catch (e) {
    next(e);
  }
});

// ---- registrar que se firmó, o que se retiró -----------------------------

export const consentRouter = express.Router();

/**
 * Deja constancia en la ficha de que la clienta dio el consentimiento, o de
 * que lo retiró. Va por una ruta propia, y no por el guardado normal de la
 * ficha, para que cada cosa quede en el registro de accesos con su nombre:
 * con datos de salud hay que poder demostrar cuándo se dio y cuándo se retiró.
 *
 * Retirar no borra nada: quita la constancia, y lo que se haga con sus datos
 * (anonimizarlos, por ejemplo) lo decide una persona.
 */
consentRouter.post('/:id/consent', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const client = await get('SELECT * FROM clients WHERE id = ?', [id]);
    if (!client) return res.status(404).json({ error: 'No encontrada' });
    if (client.anonymizedAt) {
      return res.status(409).json({ error: 'Esta ficha está anonimizada, así que ya no se le pueden añadir datos' });
    }
    const b = req.body ?? {};
    const date = has(b.date) ? String(b.date) : today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
      return res.status(400).json({ error: 'Esa fecha no es válida' });
    }
    if (date > today()) return res.status(400).json({ error: 'La fecha no puede ser futura' });

    if (b.action === 'grant') {
      const channel = String(b.channel || '').trim();
      if (!channel) return res.status(400).json({ error: 'Indica cómo lo dio: en papel, por email...' });
      const { consentVersion } = await getSetting('privacy');
      await run('UPDATE clients SET consentAt = ?, consentChannel = ?, consentVersion = ? WHERE id = ?', [
        date,
        channel,
        String(consentVersion),
        id,
      ]);
      await audit(req, {
        action: 'consent_grant',
        entity: 'clients',
        entityId: id,
        detail: `${date} · ${channel} · versión ${consentVersion}`,
      });
    } else if (b.action === 'revoke') {
      if (!has(client.consentAt)) {
        return res.status(409).json({ error: 'Esta clienta no tiene consentimiento registrado' });
      }
      await run("UPDATE clients SET consentAt = '', consentChannel = '', consentVersion = '' WHERE id = ?", [id]);
      await audit(req, {
        action: 'consent_revoke',
        entity: 'clients',
        entityId: id,
        detail: `retirado el ${date}; lo había dado el ${client.consentAt} (${client.consentChannel || 'sin canal'}, versión ${client.consentVersion || '?'})`,
      });
    } else {
      return res.status(400).json({ error: 'Acción desconocida' });
    }
    res.json(await get('SELECT * FROM clients WHERE id = ?', [id]));
  } catch (e) {
    next(e);
  }
});
