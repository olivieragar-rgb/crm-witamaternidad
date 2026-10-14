import { useState } from 'react';
import { api } from '../api.js';

const MIN = 10;

/**
 * Pantalla de acceso. Hace dos papeles: en la primera instalación crea la
 * cuenta de administradora, y a partir de ahí pide email y contraseña.
 *
 * @param {{ needsSetup: boolean, onReady: (user: object) => void }} props
 */
export default function Login({ needsSetup, onReady }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (needsSetup && password !== repeat) {
      setError('Las dos contraseñas no coinciden.');
      return;
    }
    if (needsSetup && password.length < MIN) {
      setError(`La contraseña debe tener al menos ${MIN} caracteres.`);
      return;
    }
    setBusy(true);
    try {
      const user = needsSetup
        ? await api.setup({ email, name, password })
        : await api.login({ email, password });
      onReady(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <img src="/logo.webp" alt="" className="login-logo" />
        <h1>{needsSetup ? 'Crear tu cuenta' : 'Witamaternidad'}</h1>
        <p className="muted">
          {needsSetup
            ? 'Es la primera vez que se abre el CRM. Crea la cuenta de administradora.'
            : 'Entra para acceder al CRM.'}
        </p>

        {needsSetup && (
          <label className="field">
            <span>Nombre</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </label>
        )}

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            autoFocus
          />
        </label>

        <label className="field">
          <span>Contraseña</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={needsSetup ? MIN : undefined}
            autoComplete={needsSetup ? 'new-password' : 'current-password'}
          />
        </label>

        {needsSetup && (
          <label className="field">
            <span>Repite la contraseña</span>
            <input
              type="password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              required
              autoComplete="new-password"
            />
          </label>
        )}

        {error && <p className="error">{error}</p>}

        <button type="submit" className="primary login-submit" disabled={busy}>
          {busy ? 'Un momento…' : needsSetup ? 'Crear cuenta y entrar' : 'Entrar'}
        </button>

        {needsSetup && (
          <p className="login-note">
            Mínimo {MIN} caracteres. Guárdala en un gestor de contraseñas: aquí hay datos de salud de tus
            clientas.
          </p>
        )}
      </form>
    </div>
  );
}
