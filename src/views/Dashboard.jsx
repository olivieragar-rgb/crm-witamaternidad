import { useEffect, useState } from 'react';
import { api, eur, fmtDate, gestWeeks } from '../api.js';
import FppCalculator from '../components/FppCalculator.jsx';

export default function Dashboard({ go }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.dashboard().then(setData);
  }, []);

  if (!data) return <p className="muted">Cargando…</p>;

  return (
    <section>
      <div className="toolbar">
        <h1>Inicio</h1>
      </div>

      <div className="stats">
        <button className="stat" onClick={() => go('clients', { q: 'Activa' })}>
          <span className="stat-num">{data.activeClients}</span>
          <span className="stat-label">Clientas activas</span>
        </button>
        <button className="stat" onClick={() => go('clients', { q: 'Nuevo contacto' })}>
          <span className="stat-num">{data.newClients}</span>
          <span className="stat-label">Nuevos contactos</span>
        </button>
        <button className="stat" onClick={() => go('invoices', { status: 'pendientes' })}>
          <span className="stat-num">{data.pendingInvoices}</span>
          <span className="stat-label">Facturas pendientes</span>
        </button>
        <button className="stat accent" onClick={() => go('invoices', { status: 'Pagada' })}>
          <span className="stat-num">{eur(data.monthRevenue)}</span>
          <span className="stat-label">Ingresos del mes</span>
        </button>
      </div>

      <div className="panels">
        <FppCalculator />

        <div className="panel">
          <div className="panel-head">
            <h2>Próximos partos</h2>
            <button className="link" onClick={() => go('clients')}>
              Ver clientas
            </button>
          </div>
          {data.upcomingBirths.length === 0 && <p className="muted">Sin fechas próximas.</p>}
          <ul className="mini-list">
            {data.upcomingBirths.map((b) => {
              const g = gestWeeks(b.dueDate);
              return (
                <li key={b.id}>
                  <span>
                    {b.name}
                    {g && <span className="gest"> · {g.label} sem</span>}
                  </span>
                  <span className="muted">{fmtDate(b.dueDate)}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Próximas citas</h2>
            <button className="link" onClick={() => go('calendar')}>
              Ver calendario
            </button>
          </div>
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
