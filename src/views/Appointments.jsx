import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { searchItems } from '../search.js';
import { Toolbar, Badge, Modal, Field, EmptyRow } from '../components/ui.jsx';
import { useConfig, options } from '../config.jsx';

const EMPTY = { clientId: '', serviceId: '', date: '', mode: '', status: 'Programada', notes: '' };

const text = (a) => `${a.clientName} ${a.serviceName} ${a.mode} ${a.status} ${a.notes}`;

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm"; the API stores "YYYY-MM-DD HH:mm".
const toInput = (d) => (d ? d.replace(' ', 'T').slice(0, 16) : '');
const toStore = (d) => (d ? d.replace('T', ' ') : '');

export default function Appointments() {
  const config = useConfig();
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  const load = () => api.list('appointments').then(setRows);
  useEffect(() => {
    load();
    api.list('clients').then(setClients);
    api.list('services').then(setServices);
  }, []);

  const visible = searchItems(rows, query, text);
  const set = (f) => (e) => setForm({ ...form, [f]: e.target.value });

  // Los desplegables salen de los catalogos, no de constantes del codigo.
  const MODES = options(config.catalogs.mode, form.mode);
  const STATUSES = options(config.catalogs.appointmentStatus, form.status);

  function newRow() {
    setForm({ ...EMPTY, status: options(config.catalogs.appointmentStatus)[0] ?? '' });
    setEditingId(null);
    setError('');
    setOpen(true);
  }
  function edit(a) {
    setForm({ clientId: a.clientId || '', serviceId: a.serviceId || '', date: toInput(a.date), mode: a.mode, status: a.status, notes: a.notes });
    setEditingId(a.id);
    setError('');
    setOpen(true);
  }
  async function save() {
    try {
      const payload = { ...form, date: toStore(form.date) };
      if (editingId) await api.update('appointments', editingId, payload);
      else await api.create('appointments', payload);
      setOpen(false);
      load();
    } catch (e) {
      setError(e.message);
    }
  }
  async function remove(id) {
    if (!confirm('¿Borrar esta cita?')) return;
    await api.remove('appointments', id);
    load();
  }

  return (
    <section>
      <Toolbar title="Citas" query={query} setQuery={setQuery} onNew={newRow} newLabel="Nueva cita" />

      <table className="grid-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Clienta</th>
            <th>Servicio</th>
            <th>Modalidad</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((a) => (
            <tr key={a.id}>
              <td>
                <strong>{fmtDate(a.date)}</strong>
              </td>
              <td>{a.clientName || <span className="muted">—</span>}</td>
              <td className="muted">{a.serviceName || '—'}</td>
              <td className="muted">{a.mode}</td>
              <td>
                <Badge value={a.status} />
              </td>
              <td className="row-actions">
                <button onClick={() => edit(a)}>Editar</button>
                <button className="danger" onClick={() => remove(a.id)}>
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
          title={editingId ? 'Editar cita' : 'Nueva cita'}
          onClose={() => setOpen(false)}
          onSubmit={save}
          error={error}
        >
          <div className="form-grid">
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
            <Field label="Servicio">
              <select value={form.serviceId} onChange={set('serviceId')}>
                <option value="">—</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Fecha y hora">
              <input type="datetime-local" value={form.date} onChange={set('date')} />
            </Field>
            <Field label="Modalidad">
              <select value={form.mode} onChange={set('mode')}>
                <option value="">—</option>
                {MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Estado">
              <select value={form.status} onChange={set('status')}>
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Notas">
            <textarea rows={2} value={form.notes} onChange={set('notes')} />
          </Field>
        </Modal>
      )}
    </section>
  );
}
