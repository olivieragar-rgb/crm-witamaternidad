import { useEffect, useState } from 'react';
import { api, eur, fmtDate } from '../api.js';
import { searchItems } from '../search.js';
import { Toolbar, Badge, Modal, Field, EmptyRow } from '../components/ui.jsx';

const STATUSES = ['Borrador', 'Enviada', 'Pagada'];
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

export default function Invoices() {
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [query, setQuery] = useState('');
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

  const visible = searchItems(rows, query, text);
  const set = (f) => (e) => setForm({ ...form, [f]: e.target.value });

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
