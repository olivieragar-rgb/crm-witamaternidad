import { useEffect, useState } from 'react';
import { api, eur, fmtDate, gestWeeks } from '../api.js';
import ReminderModal from '../components/ReminderModal.jsx';
import DashboardCustomizer from '../components/DashboardCustomizer.jsx';
import { Skeleton, HelpTitle } from '../components/ui.jsx';
import { DEFAULT_DASHBOARD, blocksOf, sanitizeDashboard } from '../lib/dashboard-layout.js';

export default function Dashboard({ go }) {
  const [data, setData] = useState(null);
  const [pending, setPending] = useState(null);
  const [reminder, setReminder] = useState(null); // { kind, id }

  // Cómo prefiere ver Inicio esta usuaria. Mientras se personaliza, la pantalla
  // pinta el borrador (`draft`), así cada cambio se ve al momento.
  const [layout, setLayout] = useState(DEFAULT_DASHBOARD);
  const [draft, setDraft] = useState(null);
  const [prefError, setPrefError] = useState('');
  const view = draft ?? layout;

  useEffect(() => {
    // Si no se puede leer, se queda lo de fábrica: Inicio nunca se queda sin pintar.
    api.prefs('dashboard').then((l) => setLayout(sanitizeDashboard(l))).catch(() => {});
  }, []);

  const load = () => {
    api.dashboard(view.listSize).then(setData);
    api.reminders().then(setPending);
  };
  useEffect(() => {
    load();
  }, [view.listSize]);

  async function save() {
    setPrefError('');
    try {
      setLayout(sanitizeDashboard(await api.savePrefs('dashboard', draft)));
      setDraft(null);
    } catch (e) {
      setPrefError(e.message);
    }
  }
  const cancel = () => {
    setDraft(null);
    setPrefError('');
  };

  const toolbar = (
    <div className="toolbar">
      <h1>Inicio</h1>
      <div className="toolbar-actions">
        <button type="button" onClick={() => setDraft(layout)}>
          Personalizar
        </button>
      </div>
    </div>
  );

  if (!data) {
    return (
      <section>
        {toolbar}
        <Skeleton rows={4} className="skeleton-stats" />
        <Skeleton rows={3} />
      </section>
    );
  }

  const hasPending = pending && (pending.overdue.length > 0 || pending.appointments.length > 0);

  // Cada bloque devuelve su pieza, o nada si no toca enseñarlo (por ejemplo,
  // las facturas vencidas cuando no hay ninguna).
  const stat = {
    'stat-clients': (i) => (
      <button key="stat-clients" className="stat" style={{ '--i': i }} onClick={() => go('clients', { q: 'Activa' })}>
        <span className="stat-num">{data.activeClients}</span>
        <span className="stat-label">Clientas activas</span>
      </button>
    ),
    'stat-pending': (i) => (
      <button key="stat-pending" className="stat" style={{ '--i': i }} onClick={() => go('invoices', { status: 'pendientes' })}>
        <span className="stat-num">{data.pendingInvoices}</span>
        <span className="stat-label">Facturas pendientes</span>
      </button>
    ),
    'stat-overdue': (i) =>
      data.overdueInvoices > 0 && (
        <button key="stat-overdue" className="stat warn" style={{ '--i': i }} onClick={() => go('invoices', { status: 'pendientes' })}>
          <span className="stat-num">{data.overdueInvoices}</span>
          <span className="stat-label">Facturas vencidas</span>
        </button>
      ),
    'stat-revenue': (i) => (
      <button key="stat-revenue" className="stat accent" style={{ '--i': i }} onClick={() => go('invoices', { status: 'Pagada' })}>
        <span className="stat-num">{eur(data.monthRevenue)}</span>
        <span className="stat-label">Ingresos del mes</span>
      </button>
    ),
  };

  const panel = {
    pending: () =>
      hasPending && (
        <div key="pending" className="panel pending-panel">
          <div className="panel-head">
            <HelpTitle help="Nada se envía solo. Aquí decides tú, y antes de mandarlo puedes leer el texto.">
              Pendiente de avisar
            </HelpTitle>
          </div>

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
      ),
    births: () => (
      <div key="births" className="panel">
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
    ),
    appointments: () => (
      <div key="appointments" className="panel">
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
    ),
  };

  const stats = blocksOf(view, 'stats')
    .filter((b) => b.visible)
    .map((b, i) => stat[b.id]?.(i))
    .filter(Boolean);
  const panels = blocksOf(view, 'panels')
    .filter((b) => b.visible)
    .map((b) => panel[b.id]?.())
    .filter(Boolean);

  return (
    <section>
      {toolbar}

      {stats.length > 0 && <div className={'stats' + (view.compact ? ' compact' : '')}>{stats}</div>}

      {panels.length > 0 && <div className={'panels' + (view.columns === 1 ? ' one-col' : '')}>{panels}</div>}

      {stats.length === 0 && panels.length === 0 && (
        <p className="muted home-empty">
          Ahora mismo no hay nada que enseñar aquí. Pulsa <strong>Personalizar</strong> para elegir qué quieres
          ver en Inicio.
        </p>
      )}

      {draft && (
        <DashboardCustomizer layout={draft} onChange={setDraft} onSave={save} onCancel={cancel} error={prefError} />
      )}

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
