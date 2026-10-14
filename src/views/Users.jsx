import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { Toolbar, Modal, Field, EmptyRow } from '../components/ui.jsx';

const ROLES = [
  { value: 'admin', label: 'Administradora', hint: 'Todo, incluidos usuarios y ajustes' },
  { value: 'pro', label: 'Profesional', hint: 'El trabajo diario, sin usuarios ni ajustes' },
];
const EMPTY = { email: '', name: '', role: 'pro', password: '', active: true };

/** Gestión de usuarios. Solo la ve una administradora. */
export default function Users({ me }) {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  const load = () => api.list('users').then(setRows);
  useEffect(() => {
    load();
  }, []);

  const set = (f) => (e) =>
    setForm({ ...form, [f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  function newRow() {
    setForm(EMPTY);
    setEditingId(null);
    setError('');
    setOpen(true);
  }
  function edit(u) {
    // La contraseña se deja en blanco: solo se envía si se escribe una nueva.
    setForm({ email: u.email, name: u.name, role: u.role, password: '', active: u.active });
    setEditingId(u.id);
    setError('');
    setOpen(true);
  }
  async function save() {
    try {
      if (editingId) {
        const body = { name: form.name, role: form.role, active: form.active };
        if (form.password) body.password = form.password;
        await api.update('users', editingId, body);
      } else {
        await api.create('users', form);
      }
      setOpen(false);
      load();
    } catch (e) {
      setError(e.message);
    }
  }
  async function remove(u) {
    if (!confirm(`¿Borrar la cuenta de ${u.name}? Perderá el acceso al momento.`)) return;
    try {
      await api.remove('users', u.id);
      load();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <section>
      <Toolbar title="Usuarios" onNew={newRow} newLabel="Nuevo usuario" />

      <table className="grid-table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Email</th>
            <th>Rol</th>
            <th>Última entrada</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id} className={u.active ? '' : 'inactive-row'}>
              <td>
                <strong>{u.name}</strong>
                {u.id === me.id && <span className="muted"> · tú</span>}
                {!u.active && <span className="muted"> · desactivada</span>}
              </td>
              <td className="muted">{u.email}</td>
              <td>{ROLES.find((r) => r.value === u.role)?.label || u.role}</td>
              <td className="muted">{u.lastLoginAt ? fmtDate(u.lastLoginAt) : 'Nunca'}</td>
              <td className="row-actions">
                <button onClick={() => edit(u)}>Editar</button>
                <button className="danger" onClick={() => remove(u)} disabled={u.id === me.id}>
                  Borrar
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <EmptyRow colSpan={5} />}
        </tbody>
      </table>

      {open && (
        <Modal
          title={editingId ? `Editar ${form.name}` : 'Nuevo usuario'}
          onClose={() => setOpen(false)}
          onSubmit={save}
          error={error}
          submitLabel={editingId ? 'Guardar' : 'Crear usuario'}
        >
          <div className="form-grid">
            <Field label="Nombre">
              <input value={form.name} onChange={set('name')} required />
            </Field>
            <Field label="Email">
              {/* El email identifica la cuenta: cambiarlo seria otra cuenta. */}
              <input type="email" value={form.email} onChange={set('email')} required disabled={!!editingId} />
            </Field>
            <Field label="Rol">
              <select value={form.role} onChange={set('role')}>
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={editingId ? 'Nueva contraseña (opcional)' : 'Contraseña'}>
              <input
                type="password"
                value={form.password}
                onChange={set('password')}
                required={!editingId}
                minLength={10}
                autoComplete="new-password"
              />
            </Field>
          </div>

          <p className="muted small">{ROLES.find((r) => r.value === form.role)?.hint}</p>

          {editingId && (
            <label className="check">
              <input type="checkbox" checked={form.active} onChange={set('active')} />
              <span>Cuenta activa</span>
            </label>
          )}
        </Modal>
      )}
    </section>
  );
}
