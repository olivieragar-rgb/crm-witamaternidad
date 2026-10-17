import { useState } from 'react';
import { api, fmtDate } from '../api.js';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Lo que se hace con el consentimiento de una clienta desde su ficha: preparar
 * los formularios para que los firme, dejar constancia de que los firmó, y
 * retirarlo si lo pide.
 *
 * Los PDF salen con los datos de la clienta y de Ajustes, y preparar uno queda
 * en el registro de accesos. Registrar y retirar van por su propia ruta, para
 * que cada cosa quede anotada con su nombre.
 *
 * @param {{
 *   clientId: number|null, consentAt: string, consentChannel: string, consentVersion: string,
 *   channels: string[], currentVersion: string, onChange: (fields: object) => void,
 * }} props
 */
export default function ConsentTools({ clientId, consentAt, consentChannel, consentVersion, channels, currentVersion, onChange }) {
  const [error, setError] = useState('');
  const [note, setNote] = useState(null); // { text, warn }
  const [busy, setBusy] = useState(false);

  if (!clientId) {
    return (
      <p className="muted small">
        Guarda la ficha y podrás preparar con sus datos el formulario para que lo firme.
      </p>
    );
  }

  async function run(body, ok, warn = false) {
    setError('');
    setNote(null);
    setBusy(true);
    try {
      const c = await api.consent(clientId, body);
      onChange({ consentAt: c.consentAt, consentChannel: c.consentChannel, consentVersion: c.consentVersion });
      setNote({ text: ok, warn });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Lo que ya esté escrito en los campos de arriba; si no, hoy y en papel.
  const register = () =>
    run(
      {
        action: 'grant',
        date: consentAt || today(),
        channel: consentChannel || (channels.includes('Papel firmado') ? 'Papel firmado' : channels[0] || 'Papel firmado'),
      },
      'Consentimiento registrado.',
    );

  const revoke = () => {
    if (
      !confirm(
        'Vas a retirar el consentimiento de esta clienta.\n\n' +
          'Se quita la constancia de su ficha y queda anotado en el registro de accesos. No se borra nada.\n\n' +
          '¿Seguimos?',
      )
    ) {
      return;
    }
    // Lleva una indicación que no hay que pasar por alto, así que va con el estilo de aviso.
    return run({ action: 'revoke' }, 'Consentimiento retirado. Desde ahora no anotes datos de salud suyos.', true);
  };

  const stale = consentAt && consentVersion && String(consentVersion) !== String(currentVersion);

  return (
    <div className="consent-tools">
      <div className="form-links">
        <a className="btn" href={api.consentFormUrl('consentimiento', clientId)} target="_blank" rel="noreferrer">
          Formulario de consentimiento
        </a>
        <a className="btn" href={api.consentFormUrl('revocacion', clientId)} target="_blank" rel="noreferrer">
          Retirada del consentimiento
        </a>
        <a className="btn" href={api.consentFormUrl('derechos', clientId)} target="_blank" rel="noreferrer">
          Solicitud de derechos
        </a>
      </div>

      {consentAt ? (
        <p className="muted small">
          Consentimiento dado el {fmtDate(consentAt)}
          {consentChannel ? ` · ${consentChannel}` : ''}
          {consentVersion ? ` · versión ${consentVersion} del texto` : ''}.
          {stale && ` El texto ha cambiado desde entonces (ahora es la versión ${currentVersion}).`}
        </p>
      ) : (
        <p className="muted small">
          Sin consentimiento registrado. Cuando lo firme, rellena arriba la fecha y cómo lo dio si no es hoy en
          papel, y pulsa el botón.
        </p>
      )}

      <div className="form-links">
        {consentAt ? (
          <button type="button" className="danger" disabled={busy} onClick={revoke}>
            Retirar consentimiento
          </button>
        ) : (
          <button type="button" className="primary" disabled={busy} onClick={register}>
            Registrar que lo ha firmado
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {note && (note.warn ? <p className="notice">{note.text}</p> : <p><span className="saved-note">{note.text}</span></p>)}
    </div>
  );
}
