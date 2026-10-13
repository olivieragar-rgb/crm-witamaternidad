import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { searchItems } from '../search.js';
import { Toolbar, Badge, Modal, Field, EmptyRow } from '../components/ui.jsx';

const EMPTY = { name: '', email: '', phone: '', service: '', mode: '', dueDate: '', status: 'Nuevo contacto', notes: '' };
const SERVICES = ['Hipnoparto / Preparación al parto', 'Lactancia', 'Consulta online', 'Otro'];
const MODES = ['Presencial (Granada)', 'Online'];
const STATUSES = ['Nuevo contacto', 'Activa', 'Finalizada'];
const text = (c) => `${c.name} ${c.email} ${c.phone} ${c.service} ${c.mode} ${c.status} ${c.notes}`;

export default function Clients() {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
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

  function newRow() {
    setForm(EMPTY);
    setEditingId(null);
    setError('');
    setOpen(true);
  }
  function edit(c) {
    setForm({ name: c.name, email: c.email, phone: c.phone, service: c.service, mode: c.mode, dueDate: c.dueDate, status: c.status, notes: c.notes });
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
    await api.remove('clients', id);
    load();
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
              <td className="muted">{fmtDate(c.dueDate)}</td>
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
          <Field label="Notas">
            <textarea rows={3} value={form.notes} onChange={set('notes')} placeholder="Semana de embarazo, preferencias, seguimiento…" />
          </Field>
        </Modal>
      )}
    </section>
  );
}
