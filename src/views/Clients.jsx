import { useEffect, useState } from 'react';
import { api, fmtDate, gestWeeks } from '../api.js';
import { searchItems } from '../search.js';
import { Toolbar, Badge, Modal, Field, EmptyRow } from '../components/ui.jsx';
import { useConfig, options } from '../config.jsx';

const EMPTY = {
  name: '', email: '', phone: '', service: '', mode: '', dueDate: '',
  status: 'Nuevo contacto', notes: '',
  taxId: '', address: '', postalCode: '', city: '', province: '', country: 'España',
};
const FISCAL = ['taxId', 'address', 'postalCode', 'city', 'province', 'country'];

const text = (c) => `${c.name} ${c.email} ${c.phone} ${c.service} ${c.mode} ${c.status} ${c.notes} ${c.taxId}`;

export default function Clients({ initialFilter }) {
  const config = useConfig();
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState(initialFilter?.q || '');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  const load = () => api.list('clients').then(setRows);
  useEffect(() => {
    load();
  }, []);

  const visible = searchItems(rows, query, text);
  const set = (f) => (e) => setForm({ ...form, [f]: e.target.value });

  // Los desplegables salen de los catalogos, no de constantes del codigo.
  const SERVICES = options(config.catalogs.clientService, form.service);
  const MODES = options(config.catalogs.mode, form.mode);
  const STATUSES = options(config.catalogs.clientStatus, form.status);

  function newRow() {
    setForm({ ...EMPTY, status: options(config.catalogs.clientStatus)[0] ?? '' });
    setEditingId(null);
    setError('');
    setOpen(true);
  }
  function edit(c) {
    // Las claves que falten (fichas antiguas) caen a los valores por defecto.
    setForm({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, c[k] ?? EMPTY[k]])) });
    setEditingId(c.id);
    setError('');
    setOpen(true);
  }
  async function save() {
    try {
      if (editingId) await api.update('clients', editingId, form);
      else await api.create('clients', form);
      setOpen(false);
      load();
    } catch (e) {
      setError(e.message);
    }
  }
  async function remove(id) {
    if (!confirm('¿Borrar esta ficha?')) return;
    try {
      await api.remove('clients', id);
      load();
    } catch (e) {
      // El servidor se niega si tiene facturas: hay que conservarlas.
      alert(e.message);
    }
  }

  return (
    <section>
      <Toolbar title="Clientas" query={query} setQuery={setQuery} onNew={newRow} newLabel="Nueva clienta" />

      <table className="grid-table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Servicio</th>
            <th>Modalidad</th>
            <th>FPP</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((c) => (
            <tr key={c.id}>
              <td>
                <strong>{c.name}</strong>
                <div className="muted">{c.email || c.phone}</div>
              </td>
              <td>{c.service}</td>
              <td className="muted">{c.mode}</td>
              <td className="muted">
                {c.dueDate ? (
                  <>
                    {fmtDate(c.dueDate)}
                    {(() => {
                      const g = gestWeeks(c.dueDate);
                      if (!g) return null;
                      return <div className={'gest' + (g.past ? ' gest-past' : '')}>{g.past ? 'FPP pasada' : `${g.label} sem`}</div>;
                    })()}
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td>
                <Badge value={c.status} />
              </td>
              <td className="row-actions">
                <button onClick={() => edit(c)}>Editar</button>
                <button className="danger" onClick={() => remove(c.id)}>
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
          title={editingId ? 'Editar clienta' : 'Nueva clienta'}
          onClose={() => setOpen(false)}
          onSubmit={save}
          error={error}
        >
          <div className="form-grid">
            <Field label="Nombre*">
              <input value={form.name} onChange={set('name')} placeholder="Nombre y apellidos" />
            </Field>
            <Field label="Teléfono">
              <input value={form.phone} onChange={set('phone')} placeholder="600 000 000" />
            </Field>
            <Field label="Email">
              <input value={form.email} onChange={set('email')} placeholder="email@ejemplo.com" />
            </Field>
            <Field label="Servicio">
              <select value={form.service} onChange={set('service')}>
                <option value="">—</option>
                {SERVICES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Modalidad">
              <select value={form.mode} onChange={set('mode')}>
                <option value="">—</option>
                {MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Fecha probable de parto">
              <input type="date" value={form.dueDate} onChange={set('dueDate')} />
            </Field>
            <Field label="Estado">
              <select value={form.status} onChange={set('status')}>
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>
          <details className="fiscal" open={FISCAL.some((f) => form[f] && form[f] !== 'España')}>
            <summary>Datos fiscales (para poder facturarle)</summary>
            <div className="form-grid">
              <Field label="NIF / DNI">
                <input value={form.taxId} onChange={set('taxId')} placeholder="12345678Z" />
              </Field>
              <Field label="Dirección">
                <input value={form.address} onChange={set('address')} />
              </Field>
              <Field label="Código postal">
                <input value={form.postalCode} onChange={set('postalCode')} />
              </Field>
              <Field label="Población">
                <input value={form.city} onChange={set('city')} />
              </Field>
              <Field label="Provincia">
                <input value={form.province} onChange={set('province')} />
              </Field>
              <Field label="País">
                <input value={form.country} onChange={set('country')} />
              </Field>
            </div>
          </details>

          <Field label="Notas">
            <textarea rows={3} value={form.notes} onChange={set('notes')} placeholder="Semana de embarazo, preferencias, seguimiento…" />
          </Field>
        </Modal>
      )}
    </section>
  );
}
