// Justificante de un gasto en PDF, para enviarlo (a la gestoría, por ejemplo).
//
// No sustituye a la factura del proveedor, que hay que conservar: es el
// documento propio con los datos del gasto y el desglose del IVA soportado.
import PDFDocument from 'pdfkit';
import { expenseAmounts } from './expenses.js';

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
const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';

/**
 * @param {object} expense fila de la tabla expenses
 * @param {object} issuer  datos fiscales de Ajustes (quien soporta el gasto)
 * @returns {Promise<Buffer>}
 */
export function expensePdf(expense, issuer) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Gasto ${expense.id}` } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    draw(doc, expense, issuer || {});
    doc.end();
  });
}

function draw(doc, e, issuer) {
  const left = 50;
  const width = doc.page.width - 100;
  const right = left + width;
  const a = expenseAmounts(e);

  // Quién soporta el gasto.
  doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(issuer.name || '________________________', left, 50, { width });
  const bits = [
    has(issuer.taxId) ? `NIF ${issuer.taxId}` : '',
    [issuer.address, [issuer.postalCode, issuer.city].filter(has).join(' ')].filter(has).join(', '),
    [issuer.email, issuer.phone].filter(has).join(' · '),
  ].filter(has);
  if (bits.length) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(bits.join('  ·  '), { width });
  doc.moveDown(0.6);
  doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(1).strokeColor(GREEN).stroke();
  doc.moveDown(1);

  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text('Justificante de gasto', left, doc.y, { width });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Referencia G-${String(e.id).padStart(4, '0')} · Fecha ${fmtDate(e.date)}`);
  doc.moveDown(1.2);

  const row = (label, value) => {
    const y = doc.y;
    doc.font('Helvetica').fontSize(10).fillColor(SOFT).text(label, left, y, { width: 150, lineBreak: false });
    doc.font('Helvetica-Bold').fillColor(INK).text(has(value) ? String(value) : '—', left + 150, y, { width: width - 150 });
    doc.moveDown(0.5);
  };
  row('Proveedor', e.supplier);
  row('NIF del proveedor', e.supplierTaxId);
  row('Concepto', e.description);
  row('Categoría', e.category);
  row('Fecha del gasto', fmtDate(e.date));
  row('Deducible', e.deductible ? 'Sí' : 'No');

  // Desglose.
  doc.moveDown(1);
  const boxX = right - 240;
  let y = doc.y;
  const line = (label, value, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor(bold ? INK : SOFT);
    doc.text(label, boxX, y, { width: 150, lineBreak: false });
    doc.text(value, boxX + 150, y, { width: 90, align: 'right' });
    y += bold ? 22 : 18;
  };
  doc.moveTo(boxX, y - 4).lineTo(right, y - 4).lineWidth(0.6).strokeColor(RULE).stroke();
  line('Base imponible', money(a.base));
  line(`IVA soportado (${pct(e.vatRate)})`, money(a.vat));
  doc.moveTo(boxX, y).lineTo(right, y).lineWidth(1).strokeColor(GREEN).stroke();
  y += 8;
  line('TOTAL', money(a.total), true);

  doc.y = y + 16;
  if (has(e.notes)) {
    doc.font('Helvetica').fontSize(9).fillColor(SOFT).text(`Notas: ${e.notes}`, left, doc.y, { width });
    doc.moveDown(0.8);
  }
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
    'Documento interno generado por el CRM. No sustituye a la factura del proveedor, que debe conservarse.',
    left,
    doc.page.height - 62,
    { width, align: 'center', lineBreak: false },
  );
}
