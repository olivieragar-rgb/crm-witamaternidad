import { useEffect, useState } from 'react';
import { api, eur } from '../api.js';
import { searchItems } from '../search.js';
import { Toolbar, Modal, Field, EmptyRow } from '../components/ui.jsx';

const EMPTY = { name: '', description: '', price: '', durationMin: 60, active: 1 };
const text = (s) => `${s.name} ${s.description}`;

export default function Services() {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  const load = () => api.list('services').then(setRows);
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
  function edit(s) {
    setForm({ name: s.name, description: s.description, price: s.price, durationMin: s.durationMin, active: s.active });
    setEditingId(s.id);
    setError('');
    setOpen(true);
  }
  async function save() {
    try {
      if (editingId) await api.update('services', editingId, form);
      else await api.create('services', form);
      setOpen(false);
      load();
    } catch (e) {
      setError(e.message);
    }
  }
  async function remove(id) {
    if (!confirm('¿Borrar este servicio?')) return;
    await api.remove('services', id);
    load();
  }

  return (
    <section>
      <Toolbar title="Servicios" query={query} setQuery={setQuery} onNew={newRow} newLabel="Nuevo servicio" />

      <table className="grid-table">
        <thead>
          <tr>
            <th>Servicio</th>
            <th>Duración</th>
            <th>Precio</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((s) => (
            <tr key={s.id}>
              <td>
                <strong>{s.name}</strong>
                <div className="muted">{s.description}</div>
              </td>
              <td className="muted">{s.durationMin} min</td>
              <td>{eur(s.price)}</td>
              <td>
                <span className={'badge ' + (s.active ? 'badge-activa' : 'badge-finalizada')}>
                  {s.active ? 'Activo' : 'Inactivo'}
                </span>
              </td>
              <td className="row-actions">
                <button onClick={() => edit(s)}>Editar</button>
                <button className="danger" onClick={() => remove(s.id)}>
                  Borrar
                </button>
              </td>
            </tr>
          ))}
          {visible.length === 0 && <EmptyRow colSpan={5} />}
        </tbody>
      </table>

      {open && (
        <Modal
          title={editingId ? 'Editar servicio' : 'Nuevo servicio'}
          onClose={() => setOpen(false)}
          onSubmit={save}
          error={error}
        >
          <Field label="Nombre*">
            <input value={form.name} onChange={set('name')} placeholder="Nombre del servicio" />
          </Field>
          <Field label="Descripción">
            <textarea rows={2} value={form.description} onChange={set('description')} />
          </Field>
          <div className="form-grid">
            <Field label="Precio (€)">
              <input type="number" step="0.01" min="0" value={form.price} onChange={set('price')} />
            </Field>
            <Field label="Duración (min)">
              <input type="number" min="0" value={form.durationMin} onChange={set('durationMin')} />
            </Field>
            <Field label="Estado">
              <select value={form.active} onChange={(e) => setForm({ ...form, active: Number(e.target.value) })}>
                <option value={1}>Activo</option>
                <option value={0}>Inactivo</option>
              </select>
            </Field>
          </div>
        </Modal>
      )}
    </section>
  );
}
