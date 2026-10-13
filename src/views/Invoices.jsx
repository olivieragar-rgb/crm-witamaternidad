import { useEffect, useState } from 'react';
import { api, eur, fmtDate } from '../api.js';
import { searchItems } from '../search.js';
import { Toolbar, Badge, Modal, Field, EmptyRow } from '../components/ui.jsx';

const STATUSES = ['Borrador', 'Enviada', 'Pagada'];
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const blankItem = () => ({ description: '', qty: 1, price: 0, vat: 0 });
const EMPTY = () => ({ number: '', clientId: '', date: new Date().toISOString().slice(0, 10), status: 'Borrador', notes: '', items: [blankItem()] });
const text = (i) => `${i.number} ${i.clientName} ${i.status}`;

function totals(items) {
  let base = 0;
  let vat = 0;
  for (const it of items) {
    const line = (Number(it.qty) || 0) * (Number(it.price) || 0);
    base += line;
    vat += line * ((Number(it.vat) || 0) / 100);
  }
  const r = (n) => Math.round(n * 100) / 100;
  return { base: r(base), vat: r(vat), total: r(base + vat) };
}

export default function Invoices({ initialFilter }) {
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialFilter?.status || '');
  const [months, setMonths] = useState([]); // 'YYYY-MM' seleccionados; vacío = todos
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY());
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  const load = () => api.list('invoices').then(setRows);
  useEffect(() => {
    load();
    api.list('clients').then(setClients);
    api.list('services').then(setServices);
  }, []);

  // Meses disponibles (YYYY-MM) a partir de las fechas, más recientes primero.
  const availableMonths = [...new Set(rows.map((i) => (i.date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  const monthLabel = (ym) => {
    const [y, m] = ym.split('-');
    const name = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-ES', { month: 'short', year: 'numeric' });
    return name.charAt(0).toUpperCase() + name.slice(1);
  };
  const toggleMonth = (ym) => setMonths((ms) => (ms.includes(ym) ? ms.filter((x) => x !== ym) : [...ms, ym]));

  const bySearch = searchItems(rows, query, text);
  const visible = bySearch.filter((i) => {
    if (statusFilter === 'pendientes' && i.status === 'Pagada') return false;
    if (statusFilter && statusFilter !== 'pendientes' && i.status !== statusFilter) return false;
    if (months.length && !months.includes((i.date || '').slice(0, 7))) return false;
    return true;
  });
  const set = (f) => (e) => setForm({ ...form, [f]: e.target.value });

  async function exportPdf(row) {
    const inv = await api.get('invoices', row.id);
    const win = window.open('', '_blank');
    if (!win) {
      alert('Permite las ventanas emergentes para exportar el PDF.');
      return;
    }
    const rowsHtml = inv.items
      .map(
        (it) => `<tr>
          <td>${escapeHtml(it.description)}</td>
          <td class="n">${it.qty}</td>
          <td class="n">${eur(it.price)}</td>
          <td class="n">${it.vat}%</td>
          <td class="n">${eur((Number(it.qty) || 0) * (Number(it.price) || 0))}</td>
        </tr>`,
      )
      .join('');
    win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8">
      <title>Factura ${escapeHtml(inv.number)}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Lato:wght@400;700&family=Playfair+Display:wght@600&display=swap');
        * { box-sizing: border-box; }
        body { font-family: 'Lato', sans-serif; color: #2e2a25; max-width: 720px; margin: 40px auto; padding: 0 24px; }
        header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #5b7f5e; padding-bottom: 16px; margin-bottom: 24px; }
        .brand { font-family: 'Playfair Display', serif; font-size: 26px; color: #476149; }
        .brand small { display:block; font-family:'Lato'; font-size:12px; color:#9c9489; font-weight:400; }
        h1 { font-family: 'Playfair Display', serif; font-size: 22px; margin: 0; }
        .meta { text-align: right; font-size: 14px; color: #6b6259; }
        table { width: 100%; border-collapse: collapse; margin: 24px 0; }
        th { text-align: left; font-size: 12px; text-transform: uppercase; color: #9c9489; border-bottom: 1px solid #e5ddd4; padding: 8px 6px; }
        td { padding: 10px 6px; border-bottom: 1px solid #ede7df; font-size: 14px; }
        .n { text-align: right; }
        .totals { margin-left: auto; width: 260px; }
        .totals div { display: flex; justify-content: space-between; padding: 4px 6px; font-size: 14px; }
        .totals .grand { border-top: 2px solid #5b7f5e; margin-top: 4px; padding-top: 8px; font-size: 18px; font-weight: 700; color: #476149; }
        .notes { margin-top: 28px; font-size: 13px; color: #6b6259; }
        @media print { body { margin: 0; } }
      </style></head><body>
      <header>
        <div class="brand">Witamaternidad<small>Hipnoparto · Lactancia · Granada</small></div>
        <div class="meta"><strong>Factura ${escapeHtml(inv.number)}</strong><br>${fmtDate(inv.date)}<br>Estado: ${escapeHtml(inv.status)}</div>
      </header>
      <h1>${escapeHtml(inv.clientName || 'Clienta')}</h1>
      <table>
        <thead><tr><th>Concepto</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">IVA</th><th class="n">Importe</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="totals">
        <div><span>Base</span><span>${eur(inv.totals.base)}</span></div>
        <div><span>IVA</span><span>${eur(inv.totals.vat)}</span></div>
        <div class="grand"><span>Total</span><span>${eur(inv.totals.total)}</span></div>
      </div>
      ${inv.notes ? `<div class="notes">${escapeHtml(inv.notes)}</div>` : ''}
      <script>window.onload = () => { window.print(); };<\/script>
      </body></html>`);
    win.document.close();
  }

  function newRow() {
    setForm(EMPTY());
    setEditingId(null);
    setError('');
    setOpen(true);
  }
  async function edit(row) {
    const inv = await api.get('invoices', row.id);
    setForm({
      number: inv.number,
      clientId: inv.clientId || '',
      date: inv.date,
      status: inv.status,
      notes: inv.notes,
      items: inv.items.length ? inv.items.map(({ description, qty, price, vat }) => ({ description, qty, price, vat })) : [blankItem()],
    });
    setEditingId(inv.id);
    setError('');
    setOpen(true);
  }
  async function save() {
    try {
      if (editingId) await api.update('invoices', editingId, form);
      else await api.create('invoices', form);
      setOpen(false);
      load();
    } catch (e) {
      setError(e.message);
    }
  }
  async function remove(id) {
    if (!confirm('¿Borrar esta factura?')) return;
    await api.remove('invoices', id);
    load();
  }

  async function exportExcel() {
    const XLSX = await import('xlsx'); // carga diferida: solo al exportar
    // Hoja resumen con las facturas visibles + hoja de detalle con sus líneas.
    const summary = visible.map((i) => ({
      Nº: i.number,
      Fecha: i.date,
      Clienta: i.clientName || '',
      Estado: i.status,
      Base: i.totals?.base ?? 0,
      IVA: i.totals?.vat ?? 0,
      Total: i.totals?.total ?? 0,
    }));

    const detailRows = [];
    for (const row of visible) {
      const inv = await api.get('invoices', row.id);
      for (const it of inv.items) {
        detailRows.push({
          Nº: inv.number,
          Clienta: inv.clientName || '',
          Concepto: it.description,
          Cantidad: it.qty,
          Precio: it.price,
          'IVA %': it.vat,
          Importe: (Number(it.qty) || 0) * (Number(it.price) || 0),
        });
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Facturas');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'Líneas');
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `facturas-witamaternidad-${stamp}.xlsx`);
  }

  // ---- line item editing ----
  const setItem = (idx, field) => (e) => {
    const items = form.items.map((it, i) => (i === idx ? { ...it, [field]: e.target.value } : it));
    setForm({ ...form, items });
  };
  const addItem = () => setForm({ ...form, items: [...form.items, blankItem()] });
  const removeItem = (idx) => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
  const pickService = (idx) => (e) => {
    const s = services.find((x) => x.id === Number(e.target.value));
    if (!s) return;
    const items = form.items.map((it, i) => (i === idx ? { ...it, description: s.name, price: s.price } : it));
    setForm({ ...form, items });
  };

  const t = totals(form.items);

  return (
    <section>
      <Toolbar title="Facturas" query={query} setQuery={setQuery} onNew={newRow} newLabel="Nueva factura" />

      <div className="filters">
        <span className="muted">Estado:</span>
        {['', 'pendientes', 'Borrador', 'Enviada', 'Pagada'].map((s) => (
          <button
            key={s || 'todas'}
            className={'chip' + (statusFilter === s ? ' active' : '')}
            onClick={() => setStatusFilter(s)}
          >
            {s === '' ? 'Todas' : s === 'pendientes' ? 'Pendientes' : s}
          </button>
        ))}
        <button className="export" onClick={exportExcel} disabled={visible.length === 0} title="Descargar las facturas filtradas en Excel">
          ↓ Exportar Excel ({visible.length})
        </button>
      </div>

      {availableMonths.length > 1 && (
        <div className="filters">
          <span className="muted">Mes:</span>
          <button className={'chip' + (months.length === 0 ? ' active' : '')} onClick={() => setMonths([])}>
            Todos
          </button>
          {availableMonths.map((ym) => (
            <button key={ym} className={'chip' + (months.includes(ym) ? ' active' : '')} onClick={() => toggleMonth(ym)}>
              {monthLabel(ym)}
            </button>
          ))}
        </div>
      )}

      <table className="grid-table">
        <thead>
          <tr>
            <th>Nº</th>
            <th>Fecha</th>
            <th>Clienta</th>
            <th>Estado</th>
            <th className="num">Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((i) => (
            <tr key={i.id}>
              <td>
                <strong>{i.number}</strong>
              </td>
              <td className="muted">{fmtDate(i.date)}</td>
              <td>{i.clientName || <span className="muted">—</span>}</td>
              <td>
                <Badge value={i.status} />
              </td>
              <td className="num">{eur(i.totals?.total)}</td>
              <td className="row-actions">
                <button onClick={() => exportPdf(i)}>PDF</button>
                <button onClick={() => edit(i)}>Editar</button>
                <button className="danger" onClick={() => remove(i.id)}>
                  Borrar
                </button>
              </td>
            </tr>
          ))}
          {visible.length === 0 && <EmptyRow colSpan={6} />}
        </tbody>
      </table>

      {open && (
        <Modal
          title={editingId ? `Factura ${form.number}` : 'Nueva factura'}
          onClose={() => setOpen(false)}
          onSubmit={save}
          error={error}
          submitLabel={editingId ? 'Guardar' : 'Crear factura'}
        >
          <div className="form-grid">
            <Field label="Nº (auto si vacío)">
              <input value={form.number} onChange={set('number')} placeholder="2026-0003" />
            </Field>
            <Field label="Clienta">
              <select value={form.clientId} onChange={set('clientId')}>
                <option value="">—</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Fecha">
              <input type="date" value={form.date} onChange={set('date')} />
            </Field>
            <Field label="Estado">
              <select value={form.status} onChange={set('status')}>
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="items">
            <div className="items-head">
              <span>Concepto</span>
              <span className="num">Cant.</span>
              <span className="num">Precio</span>
              <span className="num">IVA %</span>
              <span className="num">Importe</span>
              <span></span>
            </div>
            {form.items.map((it, idx) => (
              <div className="item-row" key={idx}>
                <div className="concept">
                  <input value={it.description} onChange={setItem(idx, 'description')} placeholder="Concepto" />
                  <select className="svc-pick" value="" onChange={pickService(idx)}>
                    <option value="">+ servicio…</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <input className="num" type="number" step="0.5" min="0" value={it.qty} onChange={setItem(idx, 'qty')} />
                <input className="num" type="number" step="0.01" min="0" value={it.price} onChange={setItem(idx, 'price')} />
                <input className="num" type="number" step="1" min="0" value={it.vat} onChange={setItem(idx, 'vat')} />
                <span className="num line-total">{eur((Number(it.qty) || 0) * (Number(it.price) || 0))}</span>
                <button type="button" className="icon" onClick={() => removeItem(idx)} aria-label="Quitar línea">
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="add-line" onClick={addItem}>
              + Añadir línea
            </button>
          </div>

          <div className="totals">
            <div>
              <span>Base</span>
              <strong>{eur(t.base)}</strong>
            </div>
            <div>
              <span>IVA</span>
              <strong>{eur(t.vat)}</strong>
            </div>
            <div className="grand">
              <span>Total</span>
              <strong>{eur(t.total)}</strong>
            </div>
          </div>

          <Field label="Notas">
            <textarea rows={2} value={form.notes} onChange={set('notes')} placeholder="Servicios sanitarios exentos de IVA, forma de pago…" />
          </Field>
        </Modal>
      )}
    </section>
  );
}
