import { useRef, useState } from 'react';
import { Modal } from './ui.jsx';
import { api } from '../api.js';

/**
 * Cuadro para firmar con el dedo, el ratón o un lápiz táctil.
 * `onChange(hasInk)` avisa de si hay algo dibujado; `padRef.current` expone
 * `clear()` y `toDataURL()`.
 */
function SignaturePad({ padRef, onChange }) {
  const canvas = useRef(null);
  const drawing = useRef(false);

  const pos = (e) => {
    const r = canvas.current.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.current.width,
      y: ((e.clientY - r.top) / r.height) * canvas.current.height,
    };
  };
  const down = (e) => {
    e.preventDefault();
    canvas.current.setPointerCapture(e.pointerId);
    const ctx = canvas.current.getContext('2d');
    const { x, y } = pos(e);
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#2e2a25';
    ctx.beginPath();
    ctx.moveTo(x, y);
    // Un toque sin arrastrar también deja un punto.
    ctx.lineTo(x + 0.01, y);
    ctx.stroke();
    drawing.current = true;
    onChange(true);
  };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = canvas.current.getContext('2d');
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const up = () => {
    drawing.current = false;
  };

  padRef.current = {
    clear() {
      canvas.current.getContext('2d').clearRect(0, 0, canvas.current.width, canvas.current.height);
      onChange(false);
    },
    toDataURL: () => canvas.current.toDataURL('image/png'),
  };

  return (
    <canvas
      ref={canvas}
      className="signature-pad"
      width={500}
      height={170}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      aria-label="Espacio para firmar"
    />
  );
}

/**
 * El documento de consentimiento, en una ventana aparte para que la clienta lo
 * lea y lo firme ahí mismo. `onSigned(signature)` recibe la firma (PNG en data
 * URL) y decide qué hacer: guardarla ya, si la ficha existe, o esperar a que
 * se guarde.
 *
 * @param {{
 *   clientName: string, consentText: string, consentVersion: string,
 *   onSigned: (signature: string) => Promise<void>, onClose: () => void,
 * }} props
 */
export default function ConsentSignModal({ clientName, consentText, consentVersion, onSigned, onClose }) {
  const padRef = useRef(null);
  const [accepted, setAccepted] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    if (!accepted) return setError('Marca la casilla para confirmar que lo has leído.');
    if (!hasInk) return setError('Falta la firma.');
    setError('');
    setBusy(true);
    try {
      await onSigned(padRef.current.toDataURL());
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Consentimiento para el tratamiento de datos" onClose={onClose} onSubmit={submit} submitLabel="Firmar y guardar" error={error}>
      <div className="consent-doc">
        <p>
          <strong>{clientName || 'La clienta'}</strong>, para atenderte necesitamos guardar tus datos de contacto, de
          tu embarazo, parto o lactancia (datos de salud) y, si te facturamos, tus datos fiscales. Los usamos solo para
          prestarte el servicio y cumplir la ley, no los vendemos ni los usamos para publicidad, y puedes pedirnos
          verlos, corregirlos, borrarlos o retirar este permiso cuando quieras.
        </p>
        <p className="consent-text">{consentText}</p>
        <p className="muted small">
          Información completa y tus derechos:{' '}
          <a href={api.consentFormUrl('consentimiento')} target="_blank" rel="noreferrer">
            ver el documento entero (PDF)
          </a>
          {consentVersion ? ` · versión ${consentVersion} del texto` : ''}
        </p>

        <label className="consent-accept">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <span>He leído la información y doy mi consentimiento.</span>
        </label>

        <div className="signature-box">
          <span className="muted small">Firma aquí</span>
          <SignaturePad padRef={padRef} onChange={setHasInk} />
          <button type="button" className="signature-clear" onClick={() => padRef.current.clear()}>
            Borrar firma
          </button>
        </div>
      </div>
    </Modal>
  );
}
