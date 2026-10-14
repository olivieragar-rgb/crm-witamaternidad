// PDF de factura generado en el servidor con pdfkit.
//
// Se elige pdfkit y no Puppeteer porque Puppeteer arrastra un Chromium de
// cientos de megas, inviable en una función serverless. Las fuentes estándar
// del PDF cubren los acentos y el símbolo del euro, así que no hace falta
// empaquetar ninguna tipografía.
import PDFDocument from 'pdfkit';
import { lineAmount, invoiceTotals } from './invoices.js';

const GREEN = '#476149';
const SOFT = '#6b6259';
const MUTED = '#9c9489';
const RULE = '#e5ddd4';

const money = (n) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`;
const pct = (n) => `${Number(n) || 0}%`;

const fmtDate = (d) => {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return y && m && day ? `${day}/${m}/${y}` : String(d);
};

/** Dirección en líneas, saltándose lo que esté vacío. */
const addressLines = (p) =>
  [
    p?.name,
    p?.taxId ? `NIF ${p.taxId}` : '',
    p?.address,
    [p?.postalCode, p?.city].filter(Boolean).join(' '),
    p?.province,
    p?.country,
  ].filter(Boolean);

/**
 * @param {object} inv factura tal y como la devuelve invoiceWithItems
 * @returns {Promise<Buffer>}
 */
export function invoicePdf(inv) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const totals = inv.totals || invoiceTotals(inv.items, inv.irpfRate);
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    // ---- cabecera ----
    const isRectify = !!inv.rectifiesId;
    doc.fillColor(GREEN).fontSize(20).font('Helvetica-Bold').text(inv.issuer?.name || 'Factura', left, 50);
    doc.fontSize(9).fillColor(MUTED).font('Helvetica');
    doc.text(addressLines(inv.issuer).slice(1).join(' · '), { width: width * 0.55 });
    if (inv.issuer?.email || inv.issuer?.phone) {
      doc.text([inv.issuer.email, inv.issuer.phone].filter(Boolean).join(' · '));
    }

    doc.font('Helvetica-Bold').fontSize(13).fillColor('#2e2a25');
    doc.text(isRectify ? 'FACTURA RECTIFICATIVA' : 'FACTURA', left, 50, { width, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(SOFT);
    doc.text(inv.number || 'Sin número (borrador)', { width, align: 'right' });
    doc.text(fmtDate(inv.date), { width, align: 'right' });
    if (inv.status === 'Anulada') {
      doc.font('Helvetica-Bold').fillColor('#a36b54').text('ANULADA', { width, align: 'right' });
    }

    doc.moveTo(left, 125).lineTo(right, 125).strokeColor(GREEN).lineWidth(1.5).stroke();

    // ---- destinataria ----
    let y = 142;
    doc.fontSize(8).fillColor(MUTED).font('Helvetica-Bold').text('FACTURAR A', left, y);
    y += 14;
    doc.fontSize(10).fillColor('#2e2a25').font('Helvetica');
    for (const line of addressLines(inv.client)) {
      doc.text(line, left, y, { width: width * 0.5 });
      y += 13;
    }

    if (inv.rectifies) {
      doc.fontSize(9).fillColor(SOFT).font('Helvetica-Oblique');
      doc.text(`Rectifica a la factura ${inv.rectifies.number} de ${fmtDate(inv.rectifies.date)}.`, left, y + 4, {
        width,
      });
      if (inv.rectifyReason) doc.text(`Motivo: ${inv.rectifyReason}`, { width });
      y = doc.y + 4;
    }

    // ---- líneas ----
    y = Math.max(y + 18, 230);
    const cols = [
      { key: 'description', label: 'Concepto', x: left, w: width - 290, align: 'left' },
      { key: 'qty', label: 'Cant.', x: right - 290, w: 45, align: 'right' },
      { key: 'price', label: 'Precio', x: right - 240, w: 65, align: 'right' },
      { key: 'discount', label: 'Dto.', x: right - 170, w: 45, align: 'right' },
      { key: 'vat', label: 'IVA', x: right - 120, w: 45, align: 'right' },
      { key: 'amount', label: 'Importe', x: right - 70, w: 70, align: 'right' },
    ];

    doc.fontSize(8).fillColor(MUTED).font('Helvetica-Bold');
    for (const c of cols) doc.text(c.label.toUpperCase(), c.x, y, { width: c.w, align: c.align });
    y += 13;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(RULE).lineWidth(0.5).stroke();
    y += 8;

    doc.fontSize(9.5).fillColor('#2e2a25').font('Helvetica');
    for (const it of inv.items) {
      // Una línea puede ocupar varios renglones si el concepto es largo.
      const h = doc.heightOfString(String(it.description || ''), { width: cols[0].w });
      if (y + h > doc.page.height - 170) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      doc.text(String(it.description || ''), cols[0].x, y, { width: cols[0].w });
      doc.text(String(it.qty), cols[1].x, y, { width: cols[1].w, align: 'right' });
      doc.text(money(it.price), cols[2].x, y, { width: cols[2].w, align: 'right' });
      doc.text(it.discount ? pct(it.discount) : '—', cols[3].x, y, { width: cols[3].w, align: 'right' });
      doc.text(pct(it.vat), cols[4].x, y, { width: cols[4].w, align: 'right' });
      doc.text(money(lineAmount(it)), cols[5].x, y, { width: cols[5].w, align: 'right' });
      y += Math.max(h, 12) + 7;
      doc.moveTo(left, y - 4).lineTo(right, y - 4).strokeColor('#ede7df').lineWidth(0.5).stroke();
    }

    // ---- totales ----
    y += 12;
    const boxX = right - 220;
    const row = (label, value, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10);
      doc.fillColor(bold ? GREEN : SOFT);
      doc.text(label, boxX, y, { width: 110 });
      doc.text(value, boxX + 110, y, { width: 110, align: 'right' });
      y += bold ? 18 : 15;
    };
    row('Base imponible', money(totals.base));
    row('IVA', money(totals.vat));
    if (totals.irpf) row(`Retención IRPF ${pct(inv.irpfRate)}`, `-${money(totals.irpf)}`);
    doc.moveTo(boxX, y).lineTo(right, y).strokeColor(GREEN).lineWidth(1).stroke();
    y += 8;
    row('TOTAL', money(totals.total), true);

    // ---- pie ----
    y += 16;
    doc.fontSize(8.5).fillColor(SOFT).font('Helvetica');
    const notes = [];
    // La nota de exención es obligatoria cuando se factura sin IVA.
    if (totals.vat === 0 && inv.exemptionNote) notes.push(inv.exemptionNote);
    if (inv.dueDate) notes.push(`Vencimiento: ${fmtDate(inv.dueDate)}.`);
    if (inv.paymentMethod) notes.push(`Forma de pago: ${inv.paymentMethod}.`);
    if (inv.paymentDetails) notes.push(inv.paymentDetails);
    if (inv.notes) notes.push(inv.notes);
    for (const n of notes) {
      doc.text(n, left, y, { width });
      y = doc.y + 4;
    }
    if (inv.footer) {
      doc.fontSize(8).fillColor(MUTED).text(inv.footer, left, doc.page.height - 70, { width, align: 'center' });
    }

    doc.end();
  });
}
