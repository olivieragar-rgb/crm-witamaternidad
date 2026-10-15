// PDF de factura generado en el servidor con pdfkit.
//
// La presentación sigue el artículo 6.1 del RD 1619/2012 (Reglamento por el
// que se regulan las obligaciones de facturación), que es el que dice qué
// tiene que llevar una factura completa:
//
//   a) número y, en su caso, serie, correlativos dentro de cada serie
//   b) fecha de expedición
//   c) nombre y apellidos o razón social completa del emisor y del destinatario
//   d) NIF del emisor (y del destinatario cuando procede)
//   e) domicilio de ambos
//   f) descripción de las operaciones, con el precio unitario sin impuestos
//      y los descuentos que no estén incluidos en ese precio
//   g) tipo o tipos impositivos aplicados
//   h) cuota repercutida, consignada por separado
//   i) fecha de la operación, si es distinta de la de expedición
//   j) en operaciones exentas, la referencia al precepto que lo justifica
//   m) mención «inversión del sujeto pasivo» cuando proceda
//
// Se elige pdfkit y no Puppeteer porque Puppeteer arrastra un Chromium de
// cientos de megas, inviable en una función serverless. Las fuentes estándar
// del PDF cubren los acentos y el símbolo del euro.
import PDFDocument from 'pdfkit';
import { lineAmount, invoiceTotals } from './invoices.js';

const GREEN = '#476149';
const INK = '#2e2a25';
const SOFT = '#55504a';
const MUTED = '#7d766c';
const RULE = '#ded7cd';

const money = (n) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`;
const pct = (n) => `${String(Number(n) || 0).replace('.', ',')} %`;

const fmtDate = (d) => {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return y && m && day ? `${day}/${m}/${y}` : String(d);
};

/** Dirección en líneas, saltándose lo que esté vacío. */
const addressLines = (p) =>
  [
    p?.address,
    [p?.postalCode, p?.city].filter(Boolean).join(' '),
    [p?.province, p?.country].filter(Boolean).join(' · '),
  ].filter(Boolean);

/**
 * @param {object} inv factura tal y como la devuelve invoiceWithItems
 * @param {PDFDocument} [doc] documento ya abierto, para juntar varias facturas
 * @returns {Promise<Buffer>|void} el PDF, o nada si se escribe en uno dado
 */
export function invoicePdf(inv, doc) {
  if (doc) return drawInvoice(doc, inv);
  return new Promise((resolve, reject) => {
    const d = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    d.on('data', (c) => chunks.push(c));
    d.on('end', () => resolve(Buffer.concat(chunks)));
    d.on('error', reject);
    drawInvoice(d, inv);
    d.end();
  });
}

/**
 * Varias facturas en un solo PDF, una por página.
 * @param {Array<object>} invoices
 * @returns {Promise<Buffer>}
 */
export function invoicesPdf(invoices) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    invoices.forEach((inv, i) => {
      if (i > 0) doc.addPage();
      drawInvoice(doc, inv);
    });
    doc.end();
  });
}

function drawInvoice(doc, inv) {
  const totals = inv.totals || invoiceTotals(inv.items, inv.irpfRate);
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const isRectify = !!inv.rectifiesId;
  const top = doc.y;

  // ---- cabecera: quién emite (6.1.c, 6.1.d, 6.1.e) ----
  doc.fillColor(GREEN).fontSize(17).font('Helvetica-Bold');
  doc.text(inv.issuer?.name || 'Factura', left, top, { width: width * 0.56 });
  doc.font('Helvetica').fontSize(9).fillColor(SOFT);
  if (inv.issuer?.taxId) doc.text(`NIF ${inv.issuer.taxId}`, { width: width * 0.56 });
  for (const line of addressLines(inv.issuer)) doc.text(line, { width: width * 0.56 });
  if (inv.issuer?.email || inv.issuer?.phone) {
    doc.text([inv.issuer.email, inv.issuer.phone].filter(Boolean).join(' · '), { width: width * 0.56 });
  }
  if (inv.issuer?.registryData) {
    doc.fontSize(7.5).fillColor(MUTED).text(inv.issuer.registryData, { width: width * 0.56 });
  }
  const afterIssuer = doc.y;

  // ---- identificación de la factura (6.1.a, 6.1.b, 6.1.i) ----
  doc.font('Helvetica-Bold').fontSize(13).fillColor(INK);
  doc.text(isRectify ? 'FACTURA RECTIFICATIVA' : 'FACTURA', left, top, { width, align: 'right' });

  let metaY = doc.y + 2;
  const meta = (etiqueta, valor) => {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    doc.text(etiqueta, right - 220, metaY, { width: 110, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK);
    doc.text(valor, right - 108, metaY, { width: 108, align: 'right' });
    metaY += 13;
  };
  meta('Número', inv.number || 'Sin emitir (borrador)');
  meta('Fecha de expedición', fmtDate(inv.date));
  // 6.1.i: solo se consigna cuando difiere de la fecha de expedición.
  if (inv.operationDate && inv.operationDate !== inv.date) {
    meta('Fecha de la operación', fmtDate(inv.operationDate));
  }
  if (inv.dueDate) meta('Vencimiento', fmtDate(inv.dueDate));
  if (inv.status === 'Anulada') {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#a36b54');
    doc.text('ANULADA', right - 108, metaY, { width: 108, align: 'right' });
    metaY += 13;
  }

  let y = Math.max(afterIssuer, metaY) + 14;
  doc.moveTo(left, y).lineTo(right, y).strokeColor(GREEN).lineWidth(1.2).stroke();
  y += 16;

  // ---- destinataria (6.1.c, 6.1.d, 6.1.e) ----
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED);
  doc.text('FACTURAR A', left, y);
  y += 12;
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK);
  doc.text(inv.client?.name || '—', left, y, { width: width * 0.55 });
  y = doc.y + 1;
  doc.font('Helvetica').fontSize(9).fillColor(SOFT);
  if (inv.client?.taxId) {
    doc.text(`NIF ${inv.client.taxId}`, left, y, { width: width * 0.55 });
    y = doc.y;
  }
  for (const line of addressLines(inv.client)) {
    doc.text(line, left, y, { width: width * 0.55 });
    y = doc.y;
  }

  if (inv.rectifies) {
    y += 8;
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(SOFT);
    doc.text(
      `Rectifica a la factura ${inv.rectifies.number} de ${fmtDate(inv.rectifies.date)}.` +
        (inv.rectifyReason ? ` Motivo: ${inv.rectifyReason}` : ''),
      left,
      y,
      { width },
    );
    y = doc.y;
  }

  // ---- líneas (6.1.f): precio unitario sin impuestos y descuentos ----
  y += 22;
  const cols = [
    { label: 'Descripción', x: left, w: width - 290, align: 'left' },
    { label: 'Cant.', x: right - 290, w: 42, align: 'right' },
    { label: 'Precio ud.', x: right - 243, w: 62, align: 'right' },
    { label: 'Dto.', x: right - 176, w: 42, align: 'right' },
    { label: 'IVA', x: right - 129, w: 42, align: 'right' },
    { label: 'Importe', x: right - 82, w: 82, align: 'right' },
  ];

  const header = () => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED);
    for (const c of cols) doc.text(c.label.toUpperCase(), c.x, y, { width: c.w, align: c.align });
    y += 12;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(RULE).lineWidth(0.6).stroke();
    y += 8;
  };
  header();

  doc.fontSize(9.5);
  for (const it of inv.items) {
    const h = doc.heightOfString(String(it.description || ''), { width: cols[0].w });
    if (y + h > doc.page.height - 190) {
      doc.addPage();
      y = doc.page.margins.top;
      header();
    }
    doc.font('Helvetica').fillColor(INK);
    doc.text(String(it.description || ''), cols[0].x, y, { width: cols[0].w });
    doc.text(String(it.qty).replace('.', ','), cols[1].x, y, { width: cols[1].w, align: 'right' });
    doc.text(money(it.price), cols[2].x, y, { width: cols[2].w, align: 'right' });
    doc.text(it.discount ? pct(it.discount) : '—', cols[3].x, y, { width: cols[3].w, align: 'right' });
    doc.text(pct(it.vat), cols[4].x, y, { width: cols[4].w, align: 'right' });
    doc.text(money(lineAmount(it)), cols[5].x, y, { width: cols[5].w, align: 'right' });
    y += Math.max(h, 12) + 7;
    doc.moveTo(left, y - 4).lineTo(right, y - 4).strokeColor('#efe9e1').lineWidth(0.5).stroke();
  }

  // ---- desglose por tipo (6.1.g) y cuota repercutida aparte (6.1.h) ----
  y += 14;
  if (y > doc.page.height - 170) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  const boxX = right - 250;
  const fila = (etiqueta, valor, fuerte = false) => {
    doc.font(fuerte ? 'Helvetica-Bold' : 'Helvetica').fontSize(fuerte ? 11.5 : 9.5);
    doc.fillColor(fuerte ? GREEN : SOFT);
    doc.text(etiqueta, boxX, y, { width: 150 });
    doc.text(valor, boxX + 150, y, { width: 100, align: 'right' });
    y += fuerte ? 17 : 14;
  };

  const desglose = totals.vatBreakdown || [];
  if (desglose.length > 1) {
    // Con varios tipos en la misma factura, la base y la cuota van tipo a
    // tipo: un total unico de IVA no cumple el 6.1.h.
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED);
    doc.text('DESGLOSE POR TIPO', boxX, y, { width: 250 });
    y += 12;
    for (const t of desglose) {
      fila(`Base al ${pct(t.rate)}`, money(t.base));
      fila(`Cuota IVA ${pct(t.rate)}`, money(t.vat));
    }
    doc.moveTo(boxX, y).lineTo(right, y).strokeColor(RULE).lineWidth(0.6).stroke();
    y += 8;
    fila('Base imponible total', money(totals.base));
    fila('Total cuota IVA', money(totals.vat));
  } else {
    const t = desglose[0];
    fila('Base imponible', money(totals.base));
    fila(t ? `Cuota IVA (${pct(t.rate)})` : 'Cuota IVA', money(totals.vat));
  }
  if (totals.irpf) fila(`Retención IRPF ${pct(inv.irpfRate)}`, `−${money(totals.irpf)}`);

  doc.moveTo(boxX, y).lineTo(right, y).strokeColor(GREEN).lineWidth(1).stroke();
  y += 8;
  fila('TOTAL FACTURA', money(totals.total), true);

  // ---- menciones obligatorias y datos de pago ----
  y += 14;
  doc.fontSize(8.5).fillColor(SOFT).font('Helvetica');
  const notas = [];
  // 6.1.j: en operaciones exentas, la referencia al precepto que lo ampara.
  // Basta con que UNA linea vaya al 0%: en una factura que mezcla tipos, la
  // parte exenta sigue necesitando su referencia. Mirar solo el IVA total
  // dejaba la mencion fuera en cuanto habia otra linea con IVA.
  const hayExento = (desglose.length ? desglose : [{ rate: 0 }]).some((t) => t.rate === 0);
  if (hayExento && inv.exemptionNote) notas.push(inv.exemptionNote);
  // 6.1.m
  if (inv.reverseCharge) notas.push('Inversión del sujeto pasivo.');
  if (inv.paymentMethod) notas.push(`Forma de pago: ${inv.paymentMethod}.`);
  if (inv.paymentDetails) notas.push(inv.paymentDetails);
  if (inv.notes) notas.push(inv.notes);
  for (const n of notas) {
    doc.text(n, left, y, { width });
    y = doc.y + 4;
  }

  if (inv.footer) {
    doc.fontSize(7.5).fillColor(MUTED);
    doc.text(inv.footer, left, doc.page.height - 62, { width, align: 'center' });
  }
}
