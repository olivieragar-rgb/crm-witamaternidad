import { useCallback, useEffect, useState } from 'react';
import { api, eur, fmtDate } from '../api.js';
import { Toolbar, Badge, Modal, Field, EmptyRow } from '../components/ui.jsx';
import { useConfig, options } from '../config.jsx';
import ReminderModal from '../components/ReminderModal.jsx';

const PAYMENT_STATES = ['Emitida', 'Enviada', 'Pagada'];
const FILTERS = [
  { value: '', label: 'Todas' },
  { value: 'Borrador', label: 'Borradores' },
  { value: 'pendientes', label: 'Pendientes de cobro' },
  { value: 'Pagada', label: 'Pagadas' },
  { value: 'Rectificada', label: 'Rectificadas' },
  { value: 'Anulada', label: 'Anuladas' },
];
const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const monthLabel = (m) => {
  const name = new Date(2000, Number(m) - 1, 1).toLocaleDateString('es-ES', { month: 'short' });
  return name.charAt(0).toUpperCase() + name.slice(1).replace('.', '');
};

const blankItem = () => ({ description: '', qty: 1, price: 0, vat: 0, discount: 0 });
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY = (invoicing) => ({
  clientId: '',
  date: today(),
  dueDate: '',
  paymentMethod: '',
  irpfRate: invoicing?.irpfRate ?? 0,
  exemptionNote: '',
  notes: '',
  items: [{ ...blankItem(), vat: invoicing?.vatRate ?? 0 }],
});

const num = (v) => Number(v) || 0;
const lineAmount = (it) => num(it.qty) * num(it.price) * (1 - num(it.discount) / 100);

function totals(items, irpfRate) {
  let base = 0;
  let vat = 0;
  for (const it of items) {
    const line = lineAmount(it);
    base += line;
    vat += line * (num(it.vat) / 100);
  }
  const irpf = base * (num(irpfRate) / 100);
  const r = (n) => Math.round(n * 100) / 100;
  return { base: r(base), vat: r(vat), irpf: r(irpf), total: r(base + vat - irpf) };
}

export default function Invoices({ initialFilter }) {
  const config = useConfig();
  const [data, setData] = useState({ rows: [], total: 0, years: [], page: 1, pageSize: 50 });
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(initialFilter?.status || '');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [page, setPage] = useState(1);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY(null));
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null); // factura emitida que se está mirando
  const [reminder, setReminder] = useState(null); // id de la factura a recordar

  const load = useCallback(
    () => api.invoices({ q: query, status, year, month, page }).then(setData),
    [query, status, year, month, page],
  );
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    api.list('clients').then(setClients);
    api.list('services').then(setServices);
  }, []);
  const settings = config;

  // Al cambiar un filtro se vuelve a la primera página: si no, la lista sale
  // vacía porque la página 3 del filtro anterior ya no existe.
  const filterSetter = (set) => (value) => {
    set(value);
    setPage(1);
  };

  const set = (f) => (e) => setForm({ ...form, [f]: e.target.value });
  const rows = data.rows;
  const pages = Math.ceil(data.total / data.pageSize) || 1;

  function newRow() {
    setForm(EMPTY(settings?.invoicing));
    setEditingId(null);
    setError('');
    setOpen(true);
  }

  async function edit(row) {
    const inv = await api.get('invoices', row.id);
    if (inv.locked) return setDetail(inv);
    setForm({
      clientId: inv.clientId || '',
      date: inv.date,
      dueDate: inv.dueDate || '',
      paymentMethod: inv.paymentMethod || '',
      irpfRate: inv.irpfRate || 0,
      exemptionNote: inv.exemptionNote || '',
      notes: inv.notes,
      items: inv.items.length
        ? inv.items.map(({ description, qty, price, vat, discount }) => ({
            description,
            qty,
            price,
            vat,
            discount,
          }))
        : [blankItem()],
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

  async function remove(row) {
    if (!confirm('¿Borrar este borrador?')) return;
    try {
      await api.remove('invoices', row.id);
      load();
    } catch (e) {
      alert(e.message);
    }
  }

  async function issue(row) {
    if (
      !confirm(
        'Al emitir, la factura toma número definitivo y deja de poder editarse.\n' +
          'Los errores se corrigen después con una rectificativa.\n\n¿Emitir?',
      )
    ) {
      return;
    }
    try {
      const inv = await api.issueInvoice(row.id);
      load();
      setDetail(inv);
    } catch (e) {
      alert(e.message);
    }
  }

  async function changeStatus(row, next) {
    try {
      await api.invoiceStatus(row.id, { status: next });
      load();
      if (detail?.id === row.id) setDetail(await api.get('invoices', row.id));
    } catch (e) {
      alert(e.message);
    }
  }

  async function rectify(row) {
    const reason = prompt('Motivo de la rectificación:');
    if (reason === null) return;
    if (!reason.trim()) return alert('El motivo es obligatorio.');
    try {
      const rect = await api.rectifyInvoice(row.id, { reason });
      setDetail(null);
      load();
      alert(
        `Creada la rectificativa como borrador. Ajusta los importes y emítela:\n` +
          `al emitirla, la factura ${row.number} quedará marcada como rectificada.`,
      );
      edit(rect);
    } catch (e) {
      alert(e.message);
    }
  }

  async function voidInvoice(row) {
    const reason = prompt('Motivo de la anulación:');
    if (reason === null) return;
    if (!reason.trim()) return alert('El motivo es obligatorio.');
    try {
      await api.voidInvoice(row.id, { reason });
      setDetail(null);
      load();
    } catch (e) {
      alert(e.message);
    }
  }

  async function emailInvoice(row) {
    const inv = await api.get('invoices', row.id);
    if (!inv.clientEmail) {
      return alert('La clienta no tiene email en su ficha. Añádelo en Clientas y vuelve a intentarlo.');
    }
    if (!confirm(`¿Enviar la factura ${inv.number} a ${inv.clientEmail}?\nSe adjunta el PDF y el Excel.`)) return;
    try {
      const res = await api.emailInvoice(row.id);
      alert(`Factura enviada a ${res.to}`);
      load();
    } catch (e) {
      alert(e.message);
    }
  }

  async function exportExcel() {
    const XLSX = await import('xlsx'); // carga diferida: solo al exportar
    const summary = rows.map((i) => ({
      Nº: i.number || '(borrador)',
      Fecha: i.date,
      Vencimiento: i.dueDate || '',
      Cobrada: i.paidAt || '',
      Clienta: i.clientName || '',
      Estado: i.status,
      Base: i.totals?.base ?? 0,
      IVA: i.totals?.vat ?? 0,
      IRPF: i.totals?.irpf ?? 0,
      Total: i.totals?.total ?? 0,
    }));

    const detailRows = [];
    for (const row of rows) {
      const inv = await api.get('invoices', row.id);
      for (const it of inv.items) {
        detailRows.push({
          Nº: inv.number || '(borrador)',
          Clienta: inv.clientName || '',
          Concepto: it.description,
          Cantidad: it.qty,
          Precio: it.price,
          'Dto %': it.discount,
          'IVA %': it.vat,
          Importe: lineAmount(it),
        });
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Facturas');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'Líneas');
    XLSX.writeFile(wb, `facturas-${today()}.xlsx`);
  }

  // ---- líneas ----
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

  const t = totals(form.items, form.irpfRate);
  const issuerReady = settings && settings.issuer.name && settings.issuer.taxId;

  return (
    <section>
      <Toolbar
        title="Facturas"
        query={query}
        setQuery={filterSetter(setQuery)}
        onNew={newRow}
        newLabel="Nueva factura"
      />

      {settings && !issuerReady && (
        <p className="notice">
          Faltan tus datos fiscales, así que todavía no puedes emitir facturas. Complétalos en{' '}
          <strong>Ajustes</strong>.
        </p>
      )}

      <div className="filters">
        <span className="muted">Estado:</span>
        {FILTERS.map((f) => (
          <button
            key={f.value || 'todas'}
            className={'chip' + (status === f.value ? ' active' : '')}
            onClick={() => filterSetter(setStatus)(f.value)}
          >
            {f.label}
          </button>
        ))}
        <button className="export" onClick={exportExcel} disabled={rows.length === 0}>
          ↓ Exportar Excel ({rows.length})
        </button>
      </div>

      <div className="filters">
        <span className="muted">Año:</span>
        <button className={'chip' + (year === '' ? ' active' : '')} onClick={() => filterSetter(setYear)('')}>
          Todos
        </button>
        {data.years.map((y) => (
          <button
            key={y}
            className={'chip' + (year === y ? ' active' : '')}
            onClick={() => filterSetter(setYear)(y)}
          >
            {y}
          </button>
        ))}
        <span className="muted spacer">Mes:</span>
        <button className={'chip' + (month === '' ? ' active' : '')} onClick={() => filterSetter(setMonth)('')}>
          Todos
        </button>
        {MONTHS.map((m) => (
          <button
            key={m}
            className={'chip chip-sm' + (month === m ? ' active' : '')}
            onClick={() => filterSetter(setMonth)(m)}
          >
            {monthLabel(m)}
          </button>
        ))}
      </div>

      <div className="table-wrap">
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
          {rows.map((i) => (
            <tr key={i.id}>
              <td>{i.number ? <strong>{i.number}</strong> : <span className="muted">Sin emitir</span>}</td>
              <td className="muted">{fmtDate(i.date)}</td>
              <td>{i.clientName || <span className="muted">—</span>}</td>
              <td>
                <Badge value={i.status} />
              </td>
              <td className="num">{eur(i.totals?.total)}</td>
              <td className="row-actions">
                {i.locked ? (
                  <>
                    <a className="btn" href={api.invoicePdfUrl(i.id)} target="_blank" rel="noreferrer">
                      PDF
                    </a>
                    {PAYMENT_STATES.includes(i.status) && <button onClick={() => emailInvoice(i)}>Email</button>}
                    <button onClick={() => edit(i)}>Ver</button>
                  </>
                ) : (
                  <>
                    <button className="primary-ghost" onClick={() => issue(i)} disabled={!issuerReady}>
                      Emitir
                    </button>
                    <button onClick={() => edit(i)}>Editar</button>
                    <button className="danger" onClick={() => remove(i)}>
                      Borrar
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <EmptyRow colSpan={6} />}
        </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="pager">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            ← Anterior
          </button>
          <span className="muted">
            Página {page} de {pages} · {data.total} facturas
          </span>
          <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}>
            Siguiente →
          </button>
        </div>
      )}

      {detail && (
        <InvoiceDetail
          inv={detail}
          onClose={() => setDetail(null)}
          onStatus={(s) => changeStatus(detail, s)}
          onRectify={() => rectify(detail)}
          onVoid={() => voidInvoice(detail)}
          onEmail={() => emailInvoice(detail)}
          onRemind={() => setReminder(detail.id)}
        />
      )}

      {reminder && (
        <ReminderModal
          kind="invoice"
          id={reminder}
          onClose={() => setReminder(null)}
          onSent={(to) => {
            setReminder(null);
            load();
            alert(`Recordatorio enviado a ${to}`);
          }}
        />
      )}

      {open && (
        <Modal
          title={editingId ? 'Editar borrador' : 'Nueva factura'}
          onClose={() => setOpen(false)}
          onSubmit={save}
          error={error}
          submitLabel={editingId ? 'Guardar borrador' : 'Crear borrador'}
        >
          <div className="form-grid">
            <Field label="Clienta">
              <select value={form.clientId} onChange={set('clientId')}>
                <option value="">—</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.taxId ? '' : ' (sin NIF)'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Fecha">
              <input type="date" value={form.date} onChange={set('date')} />
            </Field>
            <Field label="Vencimiento">
              <input type="date" value={form.dueDate} onChange={set('dueDate')} />
            </Field>
            <Field label="Forma de pago">
              <select value={form.paymentMethod} onChange={set('paymentMethod')}>
                <option value="">—</option>
                {options(config.catalogs.paymentMethod, form.paymentMethod).map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Retención IRPF %">
              <input type="number" step="0.01" min="0" max="100" value={form.irpfRate} onChange={set('irpfRate')} />
            </Field>
          </div>

          <div className="items">
            <div className="items-head items-head-6">
              <span>Concepto</span>
              <span className="num">Cant.</span>
              <span className="num">Precio</span>
              <span className="num">Dto %</span>
              <span className="num">IVA %</span>
              <span className="num">Importe</span>
              <span></span>
            </div>
            {form.items.map((it, idx) => (
              <div className="item-row item-row-6" key={idx}>
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
                <input
                  className="num"
                  type="number"
                  step="0.01"
                  min="0"
                  value={it.price}
                  onChange={setItem(idx, 'price')}
                />
                <input
                  className="num"
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  value={it.discount}
                  onChange={setItem(idx, 'discount')}
                />
                <input className="num" type="number" step="1" min="0" value={it.vat} onChange={setItem(idx, 'vat')} />
                <span className="num line-total">{eur(lineAmount(it))}</span>
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
            {t.irpf > 0 && (
              <div>
                <span>Retención IRPF</span>
                <strong>−{eur(t.irpf)}</strong>
              </div>
            )}
            <div className="grand">
              <span>Total</span>
              <strong>{eur(t.total)}</strong>
            </div>
          </div>

          {t.vat === 0 && (
            <Field label="Nota de exención de IVA (sale en la factura)">
              <textarea
                rows={2}
                value={form.exemptionNote}
                onChange={set('exemptionNote')}
                placeholder={settings?.invoicing.exemptionNote || ''}
              />
            </Field>
          )}

          <Field label="Notas">
            <textarea rows={2} value={form.notes} onChange={set('notes')} />
          </Field>
        </Modal>
      )}
    </section>
  );
}

/** Ficha de una factura ya emitida: se mira, no se edita. */
function InvoiceDetail({ inv, onClose, onStatus, onRectify, onVoid, onEmail, onRemind }) {
  const closed = inv.status === 'Rectificada' || inv.status === 'Anulada';
  return (
    <Modal title={`Factura ${inv.number}`} onClose={onClose} onSubmit={onClose} submitLabel="Cerrar" hideCancel>
      <p className="locked-note">
        Esta factura está emitida, así que no se puede modificar. Si hay un error, emite una rectificativa.
      </p>

      <div className="detail-grid">
        <div>
          <span className="muted">Clienta</span>
          <strong>{inv.client?.name || '—'}</strong>
          {inv.client?.taxId && <span className="muted">NIF {inv.client.taxId}</span>}
        </div>
        <div>
          <span className="muted">Fecha</span>
          <strong>{fmtDate(inv.date)}</strong>
          {inv.dueDate && <span className="muted">Vence {fmtDate(inv.dueDate)}</span>}
        </div>
        <div>
          <span className="muted">Estado</span>
          <Badge value={inv.status} />
          {inv.paidAt && <span className="muted">Cobrada {fmtDate(inv.paidAt)}</span>}
        </div>
        <div>
          <span className="muted">Total</span>
          <strong>{eur(inv.totals.total)}</strong>
          <span className="muted">
            Base {eur(inv.totals.base)} · IVA {eur(inv.totals.vat)}
            {inv.totals.irpf > 0 && ` · IRPF −${eur(inv.totals.irpf)}`}
          </span>
        </div>
      </div>

      {inv.rectifies && (
        <p className="muted small">
          Rectifica a la factura <strong>{inv.rectifies.number}</strong>. Motivo: {inv.rectifyReason}
        </p>
      )}
      {inv.rectifiedBy && (
        <p className="muted small">
          Rectificada por la factura <strong>{inv.rectifiedBy.number}</strong>.
        </p>
      )}
      {inv.status === 'Anulada' && <p className="muted small">Anulada. Motivo: {inv.rectifyReason}</p>}

      <table className="grid-table compact">
        <thead>
          <tr>
            <th>Concepto</th>
            <th className="num">Cant.</th>
            <th className="num">Precio</th>
            <th className="num">Dto.</th>
            <th className="num">IVA</th>
            <th className="num">Importe</th>
          </tr>
        </thead>
        <tbody>
          {inv.items.map((it) => (
            <tr key={it.id}>
              <td>{it.description}</td>
              <td className="num">{it.qty}</td>
              <td className="num">{eur(it.price)}</td>
              <td className="num">{it.discount ? `${it.discount}%` : '—'}</td>
              <td className="num">{it.vat}%</td>
              <td className="num">{eur(lineAmount(it))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="detail-actions">
        <a className="btn" href={api.invoicePdfUrl(inv.id)} target="_blank" rel="noreferrer">
          Ver PDF
        </a>
        {!closed && (
          <>
            <button type="button" onClick={onEmail}>
              Enviar por email
            </button>
            {inv.status !== 'Pagada' && (
              <button type="button" onClick={onRemind}>
                Recordar el pago
              </button>
            )}
            {PAYMENT_STATES.filter((s) => s !== inv.status).map((s) => (
              <button key={s} type="button" onClick={() => onStatus(s)}>
                Marcar {s.toLowerCase()}
              </button>
            ))}
            <button type="button" onClick={onRectify}>
              Rectificar
            </button>
            <button type="button" className="danger" onClick={onVoid}>
              Anular
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
