import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal } from './ui.jsx';

const hoy = () => new Date().toISOString().slice(0, 10);
const CLAVE = 'crm-briefing-visto';

/**
 * Lo que hay hoy y mañana, nada más entrar.
 *
 * Se enseña una vez al día: si saltara en cada recarga sería un peaje, y lo
 * que se repite sin aportar se acaba cerrando sin leer. La marca de "visto"
 * va en el navegador, no en el servidor, porque es una preferencia de esta
 * pantalla y no un dato del negocio.
 */
export default function DayBriefing() {
  const [datos, setDatos] = useState(null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        if (leerVisto() === hoy()) return;
        const r = await api.reminders();
        if (!vivo) return;
        const dia = agrupar(r);
        // Sin nada que contar no se interrumpe a nadie.
        if (dia.hoy.length + dia.maniana.length + dia.vencidas.length === 0) return;
        setDatos(dia);
        setAbierto(true);
      } catch {
        // Un aviso que no carga no puede estorbar la entrada.
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  function cerrar() {
    try {
      localStorage.setItem(CLAVE, hoy());
    } catch {
      // En navegación privada no se puede guardar; se volverá a enseñar.
    }
    setAbierto(false);
  }

  if (!abierto || !datos) return null;

  const { hoy: deHoy, maniana, vencidas } = datos;
  return (
    <Modal title="Lo que tienes por delante" onClose={cerrar} onSubmit={cerrar} submitLabel="Entendido" hideCancel>
      {deHoy.length > 0 && (
        <Bloque titulo="Hoy" citas={deHoy} />
      )}
      {maniana.length > 0 && <Bloque titulo="Mañana" citas={maniana} />}

      {vencidas.length > 0 && (
        <>
          <h3 className="pending-title">Facturas vencidas</h3>
          <ul className="pending-list">
            {vencidas.map((v) => (
              <li key={v.id}>
                <span>
                  <strong>{v.number}</strong> · {v.clientName || '—'}
                  <span className="muted"> vencida hace {v.daysLate} {v.daysLate === 1 ? 'día' : 'días'}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {deHoy.length === 0 && maniana.length === 0 && (
        <p className="muted">No tienes citas hoy ni mañana.</p>
      )}
    </Modal>
  );
}

function Bloque({ titulo, citas }) {
  return (
    <>
      <h3 className="pending-title">{titulo}</h3>
      <ul className="pending-list">
        {citas.map((c) => (
          <li key={c.id}>
            <span>
              <strong>{(c.date || '').slice(11, 16)}</strong> · {c.clientName || '—'}
              {c.serviceName ? ` · ${c.serviceName}` : ''}
              {c.mode ? <span className="muted"> · {c.mode}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function leerVisto() {
  try {
    return localStorage.getItem(CLAVE);
  } catch {
    return null;
  }
}

/** Separa las citas en hoy y mañana a partir de lo que devuelve la API. */
function agrupar(r) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  const maniana = d.toISOString().slice(0, 10);
  const deHoy = [];
  const deManiana = [];
  for (const c of r.appointments || []) {
    const dia = (c.date || '').slice(0, 10);
    if (dia === hoy()) deHoy.push(c);
    else if (dia === maniana) deManiana.push(c);
  }
  return { hoy: deHoy, maniana: deManiana, vencidas: r.overdue || [] };
}
