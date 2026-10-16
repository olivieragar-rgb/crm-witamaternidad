import { useState } from 'react';
import { fmtDate } from '../api.js';
import { HelpTitle } from './ui.jsx';

// Calculadora de fecha probable de parto (regla de Naegele):
// FPP = fecha de la última regla (FUM) + 280 días.
export default function FppCalculator() {
  const [lmp, setLmp] = useState('');

  let result = null;
  if (lmp) {
    const start = new Date(lmp + 'T00:00:00');
    if (!Number.isNaN(start.getTime())) {
      const due = new Date(start.getTime() + 280 * 86400000);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const elapsed = Math.floor((today - start) / 86400000);
      const weeks = elapsed >= 0 ? Math.floor(elapsed / 7) : null;
      const days = elapsed >= 0 ? elapsed % 7 : null;
      result = { due, weeks, days, elapsed };
    }
  }

  return (
    <div className="panel fpp-calc">
      <HelpTitle help="Introduce la fecha de la última regla (FUM).">Calculadora de FPP</HelpTitle>
      <label className="field">
        <span>Última regla (FUM)</span>
        <input type="date" value={lmp} onChange={(e) => setLmp(e.target.value)} />
      </label>

      {result && (
        <div className="fpp-result">
          <div className="fpp-main">
            <span className="muted">Fecha probable de parto</span>
            <strong>{fmtDate(result.due.toISOString().slice(0, 10))}</strong>
          </div>
          {result.weeks !== null && result.elapsed <= 300 && (
            <div className="fpp-sub">
              Gestación hoy: <strong>{result.weeks}+{result.days} semanas</strong>
            </div>
          )}
          {result.elapsed < 0 && <div className="fpp-sub muted">La fecha aún no ha llegado.</div>}
        </div>
      )}
    </div>
  );
}
