import { useCallback, useEffect, useState } from 'react';
import { api, onUnauthorized } from './api.js';
import Dashboard from './views/Dashboard.jsx';
import Clients from './views/Clients.jsx';
import Services from './views/Services.jsx';
import Appointments from './views/Appointments.jsx';
import Invoices from './views/Invoices.jsx';
import Expenses from './views/Expenses.jsx';
import Tools from './views/Tools.jsx';
import Calendar from './views/Calendar.jsx';
import Login from './views/Login.jsx';
import Settings from './views/Settings.jsx';
import Privacy from './views/Privacy.jsx';
import PasswordModal from './components/PasswordModal.jsx';
import { ConfigProvider, useConfig } from './config.jsx';

const NAV = [
  { id: 'dashboard', label: 'Inicio', icon: '◈' },
  { id: 'clients', label: 'Clientas', icon: '❤' },
  { id: 'calendar', label: 'Calendario', icon: '▦' },
  { id: 'appointments', label: 'Citas', icon: '◷' },
  { id: 'services', label: 'Servicios', icon: '✦' },
  { id: 'invoices', label: 'Facturas', icon: '€' },
  { id: 'expenses', label: 'Gastos', icon: '▼' },
  { id: 'tools', label: 'Herramientas', icon: '⚒' },
  { id: 'privacy', label: 'Privacidad', icon: '⛉', adminOnly: true },
  { id: 'settings', label: 'Ajustes', icon: '⚙', adminOnly: true },
];

export default function App() {
  // session: undefined mientras se comprueba, null si hay que entrar.
  const [session, setSession] = useState(undefined);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [route, setRoute] = useState({ view: 'dashboard', filter: null });
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const go = (view, filter = null) => {
    setRoute({ view, filter });
    setMenuOpen(false);
  };

  // Al arrancar: ¿hay sesión? ¿o hay que crear la primera cuenta?
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const user = await api.me();
        if (alive) setSession(user);
      } catch {
        try {
          const { needsSetup: s } = await api.setupStatus();
          if (alive) {
            setNeedsSetup(s);
            setSession(null);
          }
        } catch {
          if (alive) setSession(null);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Si el servidor responde 401 en cualquier momento, vuelta al login.
  const expire = useCallback(() => {
    setSession(null);
    setMenuOpen(false);
    setPwOpen(false);
  }, []);
  useEffect(() => onUnauthorized(expire), [expire]);

  // El menu de usuario se cierra al pulsar Escape o al tocar fuera de el.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      if (e.type === 'pointerdown' && e.target.closest('.sidebar-foot')) return;
      setMenuOpen(false);
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [menuOpen]);

  async function logout() {
    try {
      await api.logout();
    } catch {
      // Da igual por qué falle: localmente la sesión se cierra igual.
    }
    setSession(null);
    setRoute({ view: 'dashboard', filter: null });
  }

  if (session === undefined) return <div className="boot">Cargando…</div>;

  if (!session) {
    return (
      <Login
        needsSetup={needsSetup}
        onReady={(user) => {
          setNeedsSetup(false);
          setSession(user);
        }}
      />
    );
  }

  return (
    <ConfigProvider>
      <Shell
        session={session}
        route={route}
        go={go}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        pwOpen={pwOpen}
        setPwOpen={setPwOpen}
        logout={logout}
      />
    </ConfigProvider>
  );
}

function Shell({ session, route, go, menuOpen, setMenuOpen, pwOpen, setPwOpen, logout }) {
  const { brand } = useConfig();
  const nav = NAV.filter((n) => !n.adminOnly || session.role === 'admin');

  return (
    <div className="shell">
      {/* Con teclado hay diez elementos de menu antes del contenido. */}
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <aside className="sidebar">
        <button className="brand" onClick={() => go('dashboard')} title="Ir al inicio">
          <img src="/logo.webp" alt="" className="brand-logo" />
          <span className="brand-name">{brand.name}</span>
        </button>

        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={'nav-item' + (route.view === n.id ? ' active' : '')}
              onClick={() => go(n.id)}
              aria-current={route.view === n.id ? 'page' : undefined}
            >
              <span className="nav-icon" aria-hidden="true">
                {n.icon}
              </span>
              {n.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          {brand.sidebarFooter && <div className="sidebar-credit">{brand.sidebarFooter}</div>}
          <button className="user-button" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
            <span className="user-avatar">{(session.name || session.email).charAt(0).toUpperCase()}</span>
            <span className="user-text">
              <span className="user-name">{session.name}</span>
              <span className="user-role">{session.role === 'admin' ? 'Administradora' : 'Profesional'}</span>
            </span>
          </button>
          {menuOpen && (
            <div className="user-menu">
              <button
                onClick={() => {
                  setPwOpen(true);
                  setMenuOpen(false);
                }}
              >
                Cambiar contraseña
              </button>
              <button onClick={logout}>Cerrar sesión</button>
            </div>
          )}
        </div>
      </aside>

      {/* key por vista: React remonta al cambiar de seccion y con eso se
          dispara sola la animacion de entrada definida en CSS. */}
      <main className="content" id="contenido" tabIndex={-1} key={route.view}>
        {route.view === 'dashboard' && <Dashboard go={go} />}
        {route.view === 'clients' && <Clients initialFilter={route.filter} />}
        {route.view === 'calendar' && <Calendar />}
        {route.view === 'appointments' && <Appointments />}
        {route.view === 'services' && <Services />}
        {route.view === 'invoices' && <Invoices initialFilter={route.filter} />}
        {route.view === 'expenses' && <Expenses />}
        {route.view === 'tools' && <Tools />}
        {route.view === 'privacy' && session.role === 'admin' && <Privacy />}
        {route.view === 'settings' && session.role === 'admin' && <Settings me={session} />}
      </main>

      {pwOpen && <PasswordModal onClose={() => setPwOpen(false)} />}
    </div>
  );
}
