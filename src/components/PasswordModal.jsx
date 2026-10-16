import { useState } from 'react';
import { api } from '../api.js';
import { Modal, Field } from './ui.jsx';

const MIN = 10;

/** Cambiar la propia contraseña. Cierra las demás sesiones abiertas. */
export default function PasswordModal({ onClose }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function save() {
    setError('');
    if (next !== repeat) return setError('Las dos contraseñas nuevas no coinciden.');
    if (next.length < MIN) return setError(`Tu contraseña necesita al menos ${MIN} caracteres.`);
    try {
      await api.changePassword({ current, next });
      setDone(true);
    } catch (e) {
      setError(e.message);
    }
  }

  if (done) {
    return (
      <Modal title="Contraseña cambiada" onClose={onClose} onSubmit={onClose} submitLabel="Entendido" hideCancel>
        <p>
          Hecho. Se han cerrado las demás sesiones abiertas con esta cuenta; en esta puedes seguir
          trabajando.
        </p>
      </Modal>
    );
  }

  return (
    <Modal title="Cambiar contraseña" onClose={onClose} onSubmit={save} error={error} submitLabel="Cambiar">
      <Field label="Contraseña actual">
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          autoComplete="current-password"
          autoFocus
        />
      </Field>
      <Field label="Contraseña nueva">
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
          minLength={MIN}
          autoComplete="new-password"
        />
      </Field>
      <Field label="Repite la nueva">
        <input
          type="password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          required
          autoComplete="new-password"
        />
      </Field>
      <p className="muted small">Mínimo {MIN} caracteres. Al cambiarla se cerrarán las demás sesiones.</p>
    </Modal>
  );
}
