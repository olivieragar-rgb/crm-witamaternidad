import { useEffect, useState } from 'react';
import { api, gestWeeks } from '../api.js';
import { Modal, Field } from './ui.jsx';
import { QUESTIONNAIRES, KINDS, visibleFields, computeStatus } from '../data/questionnaires.js';

// Valor del desplegable que abre el campo libre. No se guarda: lo que se
// guarda es lo que ella escriba al lado.
const OTHER = 'Otro';

/**
 * El cuestionario de alta de una clienta, pintado desde su definicion. No hay
 * JSX por pregunta: anadir una pregunta al modulo de definiciones la hace
 * aparecer aqui.
 *
 * @param {{
 *   client: { id: number, name: string, dueDate?: string, consentAt?: string },
 *   kind: 'lactancia'|'parto',
 *   onClose: () => void,
 *   onSaved?: () => void,
 *   cancelLabel?: string,
 * }} props
 */
export default function QuestionnaireModal({ client, kind: initialKind, onClose, onSaved, cancelLabel, startLocked = false }) {
  const [kind, setKind] = useState(initialKind);
  // Un cuestionario ya completo se abre bloqueado, para no cambiar una
  // respuesta por error. El candado lo abre; al cerrar vuelve a bloquearse.
  const [locked, setLocked] = useState(startLocked);
  const [data, setData] = useState({});
  // Campos cuyo desplegable esta en "Otro". Es estado de pantalla y no dato:
  // en la base solo queda el texto que escribio.
  const [others, setOthers] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api
      .clientForm(client.id, kind)
      .then((r) => {
        if (!alive) return;
        const loaded = { ...r.data };
        // La semana de gestacion se propone desde la FPP de la ficha, que es
        // el mismo calculo que muestra el listado. Queda editable: la FPP
        // puede no estar puesta, o ella decir otra semana.
        if (kind === 'parto' && !loaded.gestWeeks && client.dueDate) {
          const g = gestWeeks(client.dueDate);
          if (g && !g.past && g.weeks > 0) loaded.gestWeeks = String(g.weeks);
        }
        setData(loaded);
        // Una respuesta guardada que no esta entre las opciones vino del
        // campo libre, asi que el desplegable tiene que abrir en "Otro".
        setOthers(
          new Set(
            QUESTIONNAIRES[kind].fields
              .filter((f) => f.other && loaded[f.id] && !f.options.includes(loaded[f.id]))
              .map((f) => f.id),
          ),
        );
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [client.id, client.dueDate, kind]);

  const set = (id) => (e) => setData((d) => ({ ...d, [id]: e.target.value }));

  function chooseOption(f, value) {
    setOthers((prev) => {
      const next = new Set(prev);
      if (value === OTHER) next.add(f.id);
      else next.delete(f.id);
      return next;
    });
    // Al pasar a "Otro" se vacia: lo que valia como opcion no vale como texto.
    setData((d) => ({ ...d, [f.id]: value === OTHER ? '' : value }));
  }

  function control(f) {
    const value = data[f.id] ?? '';
    if (f.type === 'textarea') return <textarea rows={3} value={value} onChange={set(f.id)} />;
    if (f.type === 'number') return <input type="number" min="0" value={value} onChange={set(f.id)} />;
    if (f.type === 'date') return <input type="date" value={value} onChange={set(f.id)} />;
    if (f.type === 'select') {
      const isOther = others.has(f.id);
      return (
        <>
          <select value={isOther ? OTHER : value} onChange={(e) => chooseOption(f, e.target.value)}>
            <option value="">—</option>
            {f.options.map((o) => (
              <option key={o}>{o}</option>
            ))}
            {f.other && <option value={OTHER}>{OTHER}</option>}
          </select>
          {isOther && (
            <input value={value} onChange={set(f.id)} placeholder="¿Cuál?" aria-label={`${f.label}: otro`} />
          )}
        </>
      );
    }
    return <input value={value} onChange={set(f.id)} />;
  }

  const fields = visibleFields(kind, data);
  const pendiente = computeStatus(kind, data) === 'pendiente';

  async function save() {
    try {
      await api.saveClientForm(client.id, { kind, data });
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <Modal
      title={`${QUESTIONNAIRES[kind].label} · ${client.name}`}
      onClose={onClose}
      onSubmit={locked ? onClose : save}
      submitLabel={locked ? 'Cerrar' : 'Guardar cuestionario'}
      cancelLabel={cancelLabel ?? 'Cancelar'}
      hideCancel={locked}
      error={error}
    >
      {startLocked && (
        <p className="locked-note">
          <button type="button" className={'lock-btn' + (locked ? '' : ' is-open')} onClick={() => setLocked((l) => !l)}>
            <span aria-hidden="true">{locked ? '🔒' : '🔓'}</span> {locked ? 'Bloqueado' : 'Editando'}
          </button>{' '}
          {locked ? 'Está completo y bloqueado para no cambiarlo por error. Pulsa el candado para editarlo.' : 'Se volverá a bloquear al cerrar.'}
        </p>
      )}
      {!client.consentAt && (
        <p className="notice">
          <strong>Sin consentimiento registrado.</strong> Vas a anotar datos de salud suyos y del bebé.
          Antes necesitas su permiso, y poder demostrar cuándo y cómo te lo dio: lo registras en el
          bloque «Consentimiento (RGPD)» de su ficha.
        </p>
      )}

      <Field label="Cuestionario">
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {QUESTIONNAIRES[k].label}
            </option>
          ))}
        </select>
      </Field>

      {loading ? (
        <p className="muted">Cargando…</p>
      ) : (
        <>
          <fieldset className="plain-fieldset" disabled={locked}>
            {fields.map((f) => (
              <Field key={f.id} label={f.required ? `${f.label}*` : f.label}>
                {control(f)}
                {f.hint && <span className="muted small">{f.hint}</span>}
              </Field>
            ))}
          </fieldset>
          <p className="muted small">
            {pendiente
              ? 'Puedes guardarlo a medias: queda marcado como pendiente hasta que estén las preguntas con asterisco.'
              : 'Están todas las obligatorias: al guardar queda completo.'}
          </p>
        </>
      )}
    </Modal>
  );
}
