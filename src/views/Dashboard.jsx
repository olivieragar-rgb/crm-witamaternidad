import { useEffect, useState } from 'react';
import { api, eur, fmtDate } from '../api.js';

export default function Dashboard({ go }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.dashboard().then(setData);
  }, []);

  if (!data) return <p className="muted">Cargando…</p>;

  return (
    <section>
      <div className="toolbar">
        <h1>Panel</h1>
      </div>

      <div className="stats">
        <button className="stat" onClick={() => go('clients')}>
          <span className="stat-num">{data.activeClients}</span>
          <span className="stat-label">Clientas activas</span>
        </button>
        <button className="stat" onClick={() => go('clients')}>
          <span className="stat-num">{data.newClients}</span>
          <span className="stat-label">Nuevos contactos</span>
        </button>
        <button className="stat" onClick={() => go('invoices')}>
          <span className="stat-num">{data.pendingInvoices}</span>
          <span className="stat-label">Facturas pendientes</span>
        </button>
        <button className="stat accent" onClick={() => go('invoices')}>
          <span className="stat-num">{eur(data.monthRevenue)}</span>
          <span className="stat-label">Ingresos del mes</span>
        </button>
      </div>

      <div className="panels">
        <div className="panel">
          <h2>Próximos partos</h2>
          {data.upcomingBirths.length === 0 && <p className="muted">Sin fechas próximas.</p>}
          <ul className="mini-list">
            {data.upcomingBirths.map((b) => (
              <li key={b.id}>
                <span>{b.name}</span>
                <span className="muted">{fmtDate(b.dueDate)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <h2>Próximas citas</h2>
          {data.upcomingAppointments.length === 0 && <p className="muted">Sin citas programadas.</p>}
          <ul className="mini-list">
            {data.upcomingAppointments.map((a) => (
              <li key={a.id}>
                <span>
                  {a.clientName || '—'}
                  {a.serviceName ? ` · ${a.serviceName}` : ''}
                </span>
                <span className="muted">{fmtDate(a.date)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
