import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal, Field } from './ui.jsx';

/**
 * Enseña el correo antes de mandarlo. Nada se envía solo: un recordatorio de
 * pago a una mujer recién parida pide leerlo antes.
 *
 * @param {{kind:'invoice'|'appointment', id:number, onClose:()=>void, onSent:()=>void}} props
 */
export default function ReminderModal({ kind, id, onClose, onSent }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .reminderPreview(kind, id)
      .then(setPreview)
      .catch((e) => setError(e.message));
  }, [kind, id]);

  async function send() {
    setBusy(true);
    setError('');
    try {
      const res = await api.sendReminder(kind, id);
      onSent(res.to);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  if (error && !preview) {
    return (
      <Modal title="Recordatorio" onClose={onClose} onSubmit={onClose} submitLabel="Cerrar" hideCancel>
        <p className="error">{error}</p>
      </Modal>
    );
  }
  if (!preview) {
    return (
      <Modal title="Recordatorio" onClose={onClose} onSubmit={onClose} submitLabel="Cerrar" hideCancel>
        <p className="muted">Cargando…</p>
      </Modal>
    );
  }

  return (
    <Modal
      title={kind === 'invoice' ? 'Recordar el pago' : 'Recordar la cita'}
      onClose={onClose}
      onSubmit={send}
      error={error}
      submitLabel={busy ? 'Enviando…' : 'Enviar'}
    >
      <p className="muted">
        Esto es lo que va a recibir. El texto se cambia en <strong>Ajustes · Recordatorios</strong>.
      </p>
      <Field label="Para">
        <input value={preview.to} readOnly />
      </Field>
      <Field label="Asunto">
        <input value={preview.subject} readOnly />
      </Field>
      <Field label="Mensaje">
        <textarea rows={7} value={preview.body} readOnly />
      </Field>
    </Modal>
  );
}
