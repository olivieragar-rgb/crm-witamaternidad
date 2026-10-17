import { useCallback, useEffect, useState } from 'react';
import { api, eur, fmtDate } from '../api.js';
import { Toolbar, Badge, Modal, Field, EmptyRow, HelpMark } from '../components/ui.jsx';
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

// Qué poner en cada sitio. La facturación es lo más enrevesado de la
// aplicación, así que cada campo dice qué se espera y de dónde sale.
const HELP = {
  page: (
    <>
      Así funciona una factura:
      <ol>
        <li>«Nueva factura» crea un <strong>borrador</strong>: lo puedes cambiar y borrar cuando quieras.</li>
        <li>Al <strong>emitirla</strong> recibe su número definitivo y ya no se puede modificar.</li>
        <li>Envíala por email o descarga el PDF.</li>
        <li>Cuando te paguen, márcala como <strong>pagada</strong>.</li>
      </ol>
      Si te equivocas en una emitida, haz una <strong>rectificativa</strong>.
    </>
  ),
  status:
    'Borrador: aún se puede editar. Emitida: ya tiene número. Enviada: se la has mandado. Pagada: cobrada. Rectificada y Anulada: corregida o cancelada; siguen guardadas.',
  year: 'Cada año tiene su propia numeración: la primera de cada año es la 0001. Las facturas de años anteriores siguen aquí.',
  client: 'A quién le haces la factura. Para emitirla necesita NIF en su ficha (Clientas → Editar → Datos fiscales). Las que no lo tienen salen con «sin NIF».',
  date: 'El día en que haces la factura. De ahí salen el año y el número: la primera de cada año es la 0001.',
  due: 'Hasta cuándo puede pagarla. Si lo dejas vacío, cuenta como vencida pasados unos días de cortesía (Ajustes → Recordatorios).',
  payment: 'Cómo te va a pagar. Sale en la factura.',
  operation: 'Solo la necesitas si prestaste el servicio en un día distinto al de la factura. Si coincide, déjala vacía y no saldrá en el PDF.',
  irpf: 'Lo que tu cliente te retiene y paga a Hacienda por ti. Se aplica cuando facturas como profesional a una empresa o a otro autónomo (suele ser el 15 %, o el 7 % los primeros años). A particulares, 0. Si dudas, pregúntalo a tu gestoría.',
  concept: 'Lo que has hecho, como quieres que lo lea tu cliente. Con «+ servicio…» se rellenan el concepto y el precio desde tus servicios.',
  qty: 'Cuántas unidades: sesiones, horas, paquetes…',
  price: 'El precio de UNA unidad, sin IVA.',
  discount: 'Descuento de esa línea, en porcentaje. Déjalo en 0 si no hay.',
  vat: 'El impuesto de esa línea. Si tu servicio está exento va al 0 %; si no, al 21 % (o el que te corresponda). Con 0 hay que añadir la nota de exención. Si dudas, pregunta a tu gestoría.',
  reverse: 'Solo cuando quien declara el IVA es la clienta y no tú; por ejemplo, al facturar a una empresa de otro país de la UE. En la duda, déjalo sin marcar.',
  exemption: 'El motivo legal por el que no llevas IVA, por ejemplo el artículo de la Ley del IVA que lo exime. Es obligatorio cuando el IVA es 0. Lo normal es dejarlo guardado en Ajustes → Facturación y que salga aquí solo.',
  notes: 'Texto libre que sale en la factura.',
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
  operationDate: '',
  reverseCharge: false,
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
  const [selected, setSelected] = useState(() => new Set());

  const load = useCallback(
    () => api.invoices({ q: query, status, year, month, page }).then(setData),
    [query, status, year, month, page],
  );
  useEffect(() => {
    load();
    setSelected(new Set());
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

  const set = (f) => (e) =>
    setForm({ ...form, [f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const rows = data.rows;

  // Los años salen de las facturas que existen, más el actual: el 1 de enero
  // de 2027 aparece "2027" aunque todavía no haya ninguna, y 2026 sigue ahí.
  // No hay ningún año escrito a mano, así que sirve para los siguientes.
  const currentYear = String(new Date().getFullYear());
  const years = [...new Set([...data.years, currentYear])].sort().reverse();
  // Año nuevo: hay historial, pero ninguna factura de este año todavía.
  const newYear = data.years.length > 0 && !data.years.includes(currentYear);
  const lastYear = data.years[0];
  const series = settings?.invoicing?.series ?? '';

  // El número que tocaría con la fecha del formulario: enseña que cada año
  // empieza de cero sin tocar el historial del anterior.
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!open || !form.date) return setPreview(null);
    let vivo = true;
    api
      .nextInvoiceNumber(form.date)
      .then((r) => vivo && setPreview(r))
      .catch(() => vivo && setPreview(null));
    return () => {
      vivo = false;
    };
  }, [open, form.date]);

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  // Lo que se exporta: la seleccion si hay alguna, y si no lo que se ve.
  const target = selected.size ? rows.filter((r) => selected.has(r.id)) : rows;
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
      operationDate: inv.operationDate || '',
      reverseCharge: !!inv.reverseCharge,
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
        'Al emitirla, la factura recibe su número definitivo y ya no se puede editar.\n' +
          'Si te equivocas, se corrige con una rectificativa.\n\n¿La emitimos?',
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
    if (!reason.trim()) return alert('Escribe el motivo para poder seguir.');
    try {
      const rect = await api.rectifyInvoice(row.id, { reason });
      setDetail(null);
      load();
      alert(
        `Rectificativa creada como borrador. Ajusta los importes y emítela:\n` +
          `en cuanto lo hagas, la factura ${row.number} pasará a rectificada.`,
      );
      edit(rect);
    } catch (e) {
      alert(e.message);
    }
  }

  async function voidInvoice(row) {
    const reason = prompt('Motivo de la anulación:');
    if (reason === null) return;
    if (!reason.trim()) return alert('Escribe el motivo para poder seguir.');
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
    if (!confirm(`¿Enviamos la factura ${inv.number} a ${inv.clientEmail}?\nLe llegarán el PDF y el Excel adjuntos.`)) return;
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
    const summary = target.map((i) => ({
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
    for (const row of target) {
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
        help={HELP.page}
      />

      {settings && !issuerReady && (
        <p className="notice">
          Faltan tus datos fiscales, así que todavía no puedes emitir facturas. Complétalos en{' '}
          <strong>Ajustes</strong>.
        </p>
      )}

      <div className="filters">
        <span className="muted">
          Estado:
          <HelpMark help={HELP.status} label="Ayuda: estados de una factura" />
        </span>
        {FILTERS.map((f) => (
          <button
            key={f.value || 'todas'}
            className={'chip' + (status === f.value ? ' active' : '')}
            onClick={() => filterSetter(setStatus)(f.value)}
          >
            {f.label}
          </button>
        ))}
        <button className="export" onClick={exportExcel} disabled={target.length === 0}>
          ↓ Excel ({target.length})
        </button>
        <a
          className={'export' + (target.length === 0 ? ' disabled' : '')}
          href={target.length ? api.invoicesPdfUrl(target.map((r) => r.id)) : undefined}
          onClick={(e) => target.length === 0 && e.preventDefault()}
        >
          ↓ PDF ({target.length})
        </a>
      </div>

      {newYear && (
        <div className="notice year-notice">
          <span>
            <strong>Empieza {currentYear}.</strong> La numeración arranca de cero: la primera factura será la{' '}
            <strong>
              {series}
              {currentYear}-0001
            </strong>
            . Las de {lastYear} siguen guardadas y las ves con el filtro Año.
          </span>
          <button type="button" className="primary" onClick={newRow}>
            Empezar {currentYear}
          </button>
        </div>
      )}

      <div className="filters">
        <span className="muted">
          Año:
          <HelpMark help={HELP.year} label="Ayuda: años y numeración" />
        </span>
        <button className={'chip' + (year === '' ? ' active' : '')} onClick={() => filterSetter(setYear)('')}>
          Todos
        </button>
        {years.map((y) => (
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
            <th className="pick">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Seleccionar todas las facturas de la página"
              />
            </th>
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
            <tr key={i.id} className={selected.has(i.id) ? 'is-picked' : ''}>
              <td className="pick">
                <input
                  type="checkbox"
                  checked={selected.has(i.id)}
                  onChange={() => toggle(i.id)}
                  aria-label={`Seleccionar la factura ${i.number || 'sin emitir'}`}
                />
              </td>
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
          {rows.length === 0 && (
            <EmptyRow
              colSpan={7}
              text={year && !data.years.includes(year) ? `Aún no hay facturas de ${year}.` : 'Sin resultados'}
            />
          )}
        </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <div className="selection-bar">
          <span>
            <strong>{selected.size}</strong> {selected.size === 1 ? 'factura seleccionada' : 'facturas seleccionadas'}
          </span>
          <a className="btn" href={api.invoicesPdfUrl([...selected])}>
            Descargar en un PDF
          </a>
          <button onClick={exportExcel}>Descargar en Excel</button>
          <button onClick={() => setSelected(new Set())}>Quitar selección</button>
        </div>
      )}

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
            <Field label="Clienta" help={HELP.client}>
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
            <Field label="Fecha" help={HELP.date}>
              <input type="date" value={form.date} onChange={set('date')} />
              {preview && (
                <small className="muted">
                  Se numerará {preview.number} al emitirla
                  {preview.isFirstOfYear ? ` (la primera de ${preview.year}: la numeración empieza de cero)` : ''}.
                </small>
              )}
            </Field>
            <Field label="Vencimiento" help={HELP.due}>
              <input type="date" value={form.dueDate} onChange={set('dueDate')} />
            </Field>
            <Field label="Forma de pago" help={HELP.payment}>
              <select value={form.paymentMethod} onChange={set('paymentMethod')}>
                <option value="">—</option>
                {options(config.catalogs.paymentMethod, form.paymentMethod).map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Fecha de la operación" help={HELP.operation}>
              <input type="date" value={form.operationDate} onChange={set('operationDate')} />
            </Field>
            <Field label="Retención IRPF %" help={HELP.irpf}>
              <input type="number" step="0.01" min="0" max="100" value={form.irpfRate} onChange={set('irpfRate')} />
            </Field>
          </div>

          <div className="items">
            <div className="items-head items-head-6">
              <span>
                Concepto
                <HelpMark help={HELP.concept} label="Ayuda: concepto" />
              </span>
              <span className="num">
                Cant.
                <HelpMark help={HELP.qty} label="Ayuda: cantidad" />
              </span>
              <span className="num">
                Precio
                <HelpMark help={HELP.price} label="Ayuda: precio" />
              </span>
              <span className="num">
                Dto %
                <HelpMark help={HELP.discount} label="Ayuda: descuento" />
              </span>
              <span className="num">
                IVA %
                <HelpMark help={HELP.vat} label="Ayuda: IVA" />
              </span>
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

          <label className="check">
            <input type="checkbox" checked={!!form.reverseCharge} onChange={set('reverseCharge')} />
            <span>
              Inversión del sujeto pasivo
              <HelpMark help={HELP.reverse} label="Ayuda: inversión del sujeto pasivo" />
            </span>
          </label>

          {t.vat === 0 && (
            <Field label="Nota de exención de IVA (sale en la factura)" help={HELP.exemption}>
              <textarea
                rows={2}
                value={form.exemptionNote}
                onChange={set('exemptionNote')}
                placeholder={settings?.invoicing.exemptionNote || ''}
              />
            </Field>
          )}

          <Field label="Notas" help={HELP.notes}>
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
