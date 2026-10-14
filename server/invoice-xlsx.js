// Excel attachment for the invoice email, built on the server from the stored
// invoice. It used to arrive as base64 in the request body, which let anyone
// attach an arbitrary file to a mail sent from our own Gmail account.
import * as XLSX from 'xlsx';

const money = (n) => Number(n) || 0;

/** @param {{number:string,date:string,clientName?:string,status:string,items:Array,totals:{base:number,vat:number,total:number}}} inv */
export function invoiceXlsxBase64(inv) {
  const rows = inv.items.map((it) => ({
    Concepto: it.description,
    Cantidad: money(it.qty),
    Precio: money(it.price),
    'IVA %': money(it.vat),
    Importe: money(it.qty) * money(it.price),
  }));
  rows.push({}, { Concepto: 'Base', Importe: inv.totals.base });
  rows.push({ Concepto: 'IVA', Importe: inv.totals.vat });
  rows.push({ Concepto: 'Total', Importe: inv.totals.total });

  const sheet = XLSX.utils.json_to_sheet(rows, {
    header: ['Concepto', 'Cantidad', 'Precio', 'IVA %', 'Importe'],
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Factura');
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}
