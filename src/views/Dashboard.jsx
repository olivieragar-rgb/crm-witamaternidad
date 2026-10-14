import { useEffect, useState } from 'react';
import { api, eur, fmtDate, gestWeeks } from '../api.js';
import ReminderModal from '../components/ReminderModal.jsx';
import { Skeleton } from '../components/ui.jsx';

export default function Dashboard({ go }) {
  const [data, setData] = useState(null);
  const [pending, setPending] = useState(null);
  const [reminder, setReminder] = useState(null); // { kind, id }

  const load = () => {
    api.dashboard().then(setData);
    api.reminders().then(setPending);
  };
  useEffect(() => {
    load();
  }, []);

  if (!data) {
    return (
      <section>
        <div className="toolbar">
          <h1>Inicio</h1>
        </div>
        <Skeleton rows={4} className="skeleton-stats" />
        <Skeleton rows={3} />
      </section>
    );
  }

  return (
    <section>
      <div className="toolbar">
        <h1>Inicio</h1>
      </div>

      <div className="stats">
        <button className="stat" style={{ '--i': 0 }} onClick={() => go('clients', { q: 'Activa' })}>
          <span className="stat-num">{data.activeClients}</span>
          <span className="stat-label">Clientas activas</span>
        </button>
        <button className="stat" style={{ '--i': 1 }} onClick={() => go('clients', { q: 'Nuevo contacto' })}>
          <span className="stat-num">{data.newClients}</span>
          <span className="stat-label">Nuevos contactos</span>
        </button>
        <button className="stat" style={{ '--i': 2 }} onClick={() => go('invoices', { status: 'pendientes' })}>
          <span className="stat-num">{data.pendingInvoices}</span>
          <span className="stat-label">Facturas pendientes</span>
        </button>
        {data.overdueInvoices > 0 && (
          <button className="stat warn" style={{ '--i': 3 }} onClick={() => go('invoices', { status: 'pendientes' })}>
            <span className="stat-num">{data.overdueInvoices}</span>
            <span className="stat-label">Facturas vencidas</span>
          </button>
        )}
        <button className="stat accent" style={{ '--i': 4 }} onClick={() => go('invoices', { status: 'Pagada' })}>
          <span className="stat-num">{eur(data.monthRevenue)}</span>
          <span className="stat-label">Ingresos del mes</span>
        </button>
      </div>

      {pending && (pending.overdue.length > 0 || pending.appointments.length > 0) && (
        <div className="panel pending-panel">
          <div className="panel-head">
            <h2>Pendiente de avisar</h2>
          </div>
          <p className="muted small">
            Nada se envía solo. Aquí decides tú, y antes de mandarlo puedes leer el texto.
          </p>

          {pending.overdue.length > 0 && (
            <>
              <h3 className="pending-title">Facturas vencidas</h3>
              <ul className="pending-list">
                {pending.overdue.map((o) => (
                  <li key={'i' + o.id}>
                    <span>
                      <strong>{o.number}</strong> · {o.clientName || '—'} · {eur(o.total)}
                      <span className="muted">
                        {' '}
                        vencida hace {o.daysLate} {o.daysLate === 1 ? 'día' : 'días'}
                        {o.remindedAt && ` · recordada el ${fmtDate(o.remindedAt)}`}
                      </span>
                    </span>
                    <button
                      disabled={!o.clientEmail}
                      title={o.clientEmail ? '' : 'La clienta no tiene email en su ficha'}
                      onClick={() => setReminder({ kind: 'invoice', id: o.id })}
                    >
                      Recordar
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {pending.appointments.length > 0 && (
            <>
              <h3 className="pending-title">Citas próximas</h3>
              <ul className="pending-list">
                {pending.appointments.map((c) => (
                  <li key={'a' + c.id}>
                    <span>
                      <strong>{c.clientName || '—'}</strong>
                      {c.serviceName ? ` · ${c.serviceName}` : ''}
                      <span className="muted">
                        {' '}
                        {fmtDate(c.date)}
                        {c.remindedAt && ` · recordada el ${fmtDate(c.remindedAt)}`}
                      </span>
                    </span>
                    <button
                      disabled={!c.clientEmail}
                      title={c.clientEmail ? '' : 'La clienta no tiene email en su ficha'}
                      onClick={() => setReminder({ kind: 'appointment', id: c.id })}
                    >
                      Recordar
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="panels">

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
      {reminder && (
        <ReminderModal
          kind={reminder.kind}
          id={reminder.id}
          onClose={() => setReminder(null)}
          onSent={(to) => {
            setReminder(null);
            load();
            alert(`Recordatorio enviado a ${to}`);
          }}
        />
      )}
    </section>
  );
}
