import { useState } from 'react';
import Dashboard from './views/Dashboard.jsx';
import Clients from './views/Clients.jsx';
import Services from './views/Services.jsx';
import Appointments from './views/Appointments.jsx';
import Invoices from './views/Invoices.jsx';

const NAV = [
  { id: 'dashboard', label: 'Panel', icon: '◈' },
  { id: 'clients', label: 'Clientas', icon: '❤' },
  { id: 'appointments', label: 'Citas', icon: '◷' },
  { id: 'services', label: 'Servicios', icon: '✦' },
  { id: 'invoices', label: 'Facturas', icon: '▦' },
];

export default function App() {
  const [view, setView] = useState('dashboard');

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-name">Witamaternidad</span>
          <span className="brand-sub">Hipnoparto · Lactancia</span>
        </div>
        <nav>
          {NAV.map((n) => (
            <button
              key={n.id}
              className={'nav-item' + (view === n.id ? ' active' : '')}
              onClick={() => setView(n.id)}
            >
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">Granada · online</div>
      </aside>

      <main className="content">
        {view === 'dashboard' && <Dashboard go={setView} />}
        {view === 'clients' && <Clients />}
        {view === 'appointments' && <Appointments />}
        {view === 'services' && <Services />}
        {view === 'invoices' && <Invoices />}
      </main>
    </div>
  );
}
