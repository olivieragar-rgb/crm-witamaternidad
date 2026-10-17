import { useCallback, useEffect, useState } from 'react';
import { api, eur, fmtDate } from '../api.js';
import { Toolbar, Modal, Field, EmptyRow, Skeleton } from '../components/ui.jsx';
import { useConfig, options } from '../config.jsx';

const QUARTERS = [
  { value: '', label: 'Todo el año' },
  { value: '1', label: '1T · ene-mar' },
  { value: '2', label: '2T · abr-jun' },
  { value: '3', label: '3T · jul-sep' },
  { value: '4', label: '4T · oct-dic' },
];

const today = () => new Date().toISOString().slice(0, 10);
const currentQuarter = () => String(Math.floor(new Date().getMonth() / 3) + 1);
const EMPTY = () => ({
  date: today(),
  description: '',
  supplier: '',
  supplierTaxId: '',
  category: '',
  paymentMethod: '',
  base: 0,
  vatRate: 21,
  deductible: true,
  notes: '',
});

const num = (v) => Number(v) || 0;

export default function Expenses() {
  const config = useConfig();
  const [data, setData] = useState({ rows: [], years: [], totals: { base: 0, vat: 0, total: 0 } });
  const [taxes, setTaxes] = useState(null);
  const [query, setQuery] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarter, setQuarter] = useState(currentQuarter());
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY());
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.expenses({ q: query, year, quarter }).then(setData);
    // El resumen fiscal siempre es de un trimestre concreto: sin trimestre
    // elegido se muestra el que corre.
    api.taxes(year, quarter || currentQuarter()).then(setTaxes);
  }, [query, year, quarter]);
  useEffect(() => {
    load();
  }, [load]);

  const set = (f) => (e) =>
    setForm({ ...form, [f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  function newRow() {
    setForm(EMPTY());
    setEditingId(null);
    setError('');
    setOpen(true);
  }
  function edit(row) {
    setForm({ ...row, deductible: !!row.deductible });
    setEditingId(row.id);
    setError('');
    setOpen(true);
  }
  async function save() {
    try {
      if (editingId) await api.updateExpense(editingId, form);
      else await api.createExpense(form);
      setOpen(false);
      load();
    } catch (e) {
      setError(e.message);
    }
  }
  async function remove(row) {
    if (!confirm(`¿Borrar el gasto "${row.description}"?`)) return;
    await api.removeExpense(row.id);
    load();
  }

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const sheet = data.rows.map((r) => ({
      Fecha: r.date,
      Concepto: r.description,
      Proveedor: r.supplier,
      NIF: r.supplierTaxId,
      Categoría: r.category,
      'Forma de pago': r.paymentMethod,
      Base: r.amounts.base,
      'IVA %': r.vatRate,
      IVA: r.amounts.vat,
      Total: r.amounts.total,
      Deducible: r.deductible ? 'Sí' : 'No',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'Gastos');
    XLSX.writeFile(wb, `gastos-${year}${quarter ? `-T${quarter}` : ''}.xlsx`);
  }

  const vatPreview = num(form.base) * (num(form.vatRate) / 100);
  const years = [...new Set([...data.years, String(new Date().getFullYear())])].sort().reverse();

  return (
    <section>
      <Toolbar title="Gastos" query={query} setQuery={setQuery} onNew={newRow} newLabel="Nuevo gasto" />

      <div className="filters">
        <span className="muted">Año:</span>
        {years.map((y) => (
          <button key={y} className={'chip' + (year === y ? ' active' : '')} onClick={() => setYear(y)}>
            {y}
          </button>
        ))}
        <span className="muted spacer">Trimestre:</span>
        {QUARTERS.map((q) => (
          <button
            key={q.value || 'todo'}
            className={'chip' + (quarter === q.value ? ' active' : '')}
            onClick={() => setQuarter(q.value)}
          >
            {q.label}
          </button>
        ))}
        <button className="export" onClick={exportExcel} disabled={data.rows.length === 0}>
          ↓ Exportar Excel ({data.rows.length})
        </button>
      </div>

      {taxes && <TaxSummary t={taxes} />}

      <div className="table-wrap">
        <table className="grid-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Concepto</th>
            <th>Categoría</th>
            <th>Forma de pago</th>
            <th className="num">Base</th>
            <th className="num">IVA</th>
            <th className="num">Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.id} className={r.deductible ? '' : 'inactive-row'}>
              <td className="muted">{fmtDate(r.date)}</td>
              <td>
                <strong>{r.description}</strong>
                {r.supplier && <div className="muted">{r.supplier}</div>}
              </td>
              <td className="muted">
                {r.category || '—'}
                {!r.deductible && <div className="muted">No deducible</div>}
              </td>
              <td className="muted">{r.paymentMethod || '—'}</td>
              <td className="num">{eur(r.amounts.base)}</td>
              <td className="num">{eur(r.amounts.vat)}</td>
              <td className="num">{eur(r.amounts.total)}</td>
              <td className="row-actions">
                <a className="btn" href={api.expensePdfUrl(r.id)} target="_blank" rel="noreferrer"
                   title="Justificante del gasto en PDF, para enviarlo">
                  PDF
                </a>
                <button onClick={() => edit(r)}>Editar</button>
                <button className="danger" onClick={() => remove(r)}>
                  Borrar
                </button>
              </td>
            </tr>
          ))}
          {data.rows.length === 0 && <EmptyRow colSpan={8} />}
        </tbody>
        {data.rows.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={4} className="muted">
                {data.rows.length} gastos
              </td>
              <td className="num">
                <strong>{eur(data.totals.base)}</strong>
              </td>
              <td className="num">
                <strong>{eur(data.totals.vat)}</strong>
              </td>
              <td className="num">
                <strong>{eur(data.totals.total)}</strong>
              </td>
              <td />
            </tr>
          </tfoot>
        )}
        </table>
      </div>

      {open && (
        <Modal
          title={editingId ? 'Editar gasto' : 'Nuevo gasto'}
          onClose={() => setOpen(false)}
          onSubmit={save}
          error={error}
          submitLabel={editingId ? 'Guardar' : 'Añadir gasto'}
        >
          <div className="form-grid">
            <Field label="Fecha">
              <input type="date" value={form.date} onChange={set('date')} />
            </Field>
            <Field label="Concepto*">
              <input value={form.description} onChange={set('description')} placeholder="Qué has pagado" />
            </Field>
            <Field label="Proveedor">
              <input value={form.supplier} onChange={set('supplier')} />
            </Field>
            <Field label="NIF del proveedor">
              <input value={form.supplierTaxId} onChange={set('supplierTaxId')} />
            </Field>
            <Field label="Categoría">
              <select value={form.category} onChange={set('category')}>
                <option value="">—</option>
                {options(config.catalogs.expenseCategory, form.category).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Forma de pago">
              <select value={form.paymentMethod} onChange={set('paymentMethod')}>
                <option value="">—</option>
                {options(config.catalogs.paymentMethod, form.paymentMethod).map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Base imponible">
              <input type="number" step="0.01" min="0" value={form.base} onChange={set('base')} />
            </Field>
            <Field label="IVA %">
              <input type="number" step="1" min="0" value={form.vatRate} onChange={set('vatRate')} />
            </Field>
          </div>

          <div className="totals">
            <div>
              <span>IVA</span>
              <strong>{eur(vatPreview)}</strong>
            </div>
            <div className="grand">
              <span>Total pagado</span>
              <strong>{eur(num(form.base) + vatPreview)}</strong>
            </div>
          </div>

          <label className="check">
            <input type="checkbox" checked={form.deductible} onChange={set('deductible')} />
            <span>Gasto deducible</span>
          </label>
          <p className="muted small">
            Un gasto no deducible sigue siendo dinero que sale, pero no resta en el 303 ni en el 130.
          </p>

          <Field label="Notas">
            <textarea rows={2} value={form.notes} onChange={set('notes')} />
          </Field>
        </Modal>
      )}
    </section>
  );
}

/** Las cifras del 303 y del 130 del trimestre. */
function TaxSummary({ t }) {
  return (
    <div className="tax-summary">
      <div className="tax-card">
        <h3>
          Modelo 303 · IVA <span className="muted">{t.quarter}T {t.year}</span>
        </h3>
        <div className="tax-line">
          <span>IVA repercutido (facturas emitidas)</span>
          <strong>{eur(t.vat.charged)}</strong>
        </div>
        <div className="tax-line">
          <span>IVA soportado deducible (gastos)</span>
          <strong>−{eur(t.vat.paid)}</strong>
        </div>
        <div className="tax-line grand">
          <span>{t.vat.due >= 0 ? 'A ingresar' : 'A compensar'}</span>
          <strong>{eur(Math.abs(t.vat.due))}</strong>
        </div>
      </div>

      <div className="tax-card">
        <h3>
          Modelo 130 · IRPF <span className="muted">{t.quarter}T {t.year}</span>
        </h3>
        <div className="tax-line">
          <span>Ingresos</span>
          <strong>{eur(t.irpf.income)}</strong>
        </div>
        <div className="tax-line">
          <span>Gastos deducibles</span>
          <strong>−{eur(t.irpf.expenses)}</strong>
        </div>
        <div className="tax-line">
          <span>Rendimiento</span>
          <strong>{eur(t.irpf.profit)}</strong>
        </div>
        <div className="tax-line">
          <span>{t.irpf.rate}% del rendimiento</span>
          <strong>{eur(t.irpf.gross)}</strong>
        </div>
        {t.irpf.withheld > 0 && (
          <div className="tax-line">
            <span>Retenciones ya practicadas en factura</span>
            <strong>−{eur(t.irpf.withheld)}</strong>
          </div>
        )}
        <div className="tax-line grand">
          <span>A ingresar</span>
          <strong>{eur(t.irpf.due)}</strong>
        </div>
      </div>

      <p className="muted small tax-note">
        Las cifras salen de tus facturas emitidas y tus gastos, contados por fecha de factura (criterio de
        devengo), sin anuladas, rectificadas ni borradores. <strong>Esto no presenta nada ante
        Hacienda</strong>: son los números para rellenar el modelo o pasárselos a tu gestoría.
      </p>
    </div>
  );
}
