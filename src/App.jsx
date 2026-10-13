import { useState } from 'react';
import Dashboard from './views/Dashboard.jsx';
import Clients from './views/Clients.jsx';
import Services from './views/Services.jsx';
import Appointments from './views/Appointments.jsx';
import Invoices from './views/Invoices.jsx';
import Calendar from './views/Calendar.jsx';

const NAV = [
  { id: 'dashboard', label: 'Inicio', icon: '◈' },
  { id: 'clients', label: 'Clientas', icon: '❤' },
  { id: 'calendar', label: 'Calendario', icon: '▦' },
  { id: 'appointments', label: 'Citas', icon: '◷' },
  { id: 'services', label: 'Servicios', icon: '✦' },
  { id: 'invoices', label: 'Facturas', icon: '€' },
];

export default function App() {
  // route = { view, filter } — filter lets the dashboard deep-link into a view.
  const [route, setRoute] = useState({ view: 'dashboard', filter: null });
  const go = (view, filter = null) => setRoute({ view, filter });

  return (
    <div className="shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => go('dashboard')} title="Ir al inicio">
          <img src="/logo.webp" alt="Wita Maternidad" className="brand-logo" />
          <span className="brand-text">
            <span className="brand-name">Witamaternidad</span>
            <span className="brand-sub">Hipnoparto · Lactancia</span>
          </span>
        </button>

        <nav>
          {NAV.map((n) => (
            <button
              key={n.id}
              className={'nav-item' + (route.view === n.id ? ' active' : '')}
              onClick={() => go(n.id)}
            >
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">Granada · online</div>
      </aside>

      <main className="content">
        {route.view === 'dashboard' && <Dashboard go={go} />}
        {route.view === 'clients' && <Clients initialFilter={route.filter} />}
        {route.view === 'calendar' && <Calendar />}
        {route.view === 'appointments' && <Appointments />}
        {route.view === 'services' && <Services />}
        {route.view === 'invoices' && <Invoices initialFilter={route.filter} />}
      </main>
    </div>
  );
}
