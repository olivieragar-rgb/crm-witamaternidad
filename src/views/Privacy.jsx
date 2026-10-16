import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { EmptyRow, Skeleton, HelpTip } from '../components/ui.jsx';
import { useConfig } from '../config.jsx';

const TABS = [
  { id: 'retention', label: 'Conservación' },
  {
    id: 'audit',
    label: 'Registro de accesos',
    help: 'Quién ha entrado, qué ha consultado y qué ha cambiado. Con datos de salud hay que poder demostrarlo, así que este registro es de solo lectura: no se puede editar ni borrar desde la aplicación.',
  },
];

const ACTION_LABELS = {
  login: 'Entrada',
  login_fail: 'Intento fallido',
  login_locked: 'Cuenta bloqueada',
  logout: 'Salida',
  setup: 'Alta inicial',
  password_change: 'Cambio de contraseña',
  user_create: 'Alta de usuario',
  user_update: 'Cambio de usuario',
  user_delete: 'Baja de usuario',
  client_view: 'Consulta de ficha',
  client_list: 'Listado de clientas',
  client_export: 'Exportación de datos',
  client_anonymize: 'Anonimización',
  create: 'Alta',
  update: 'Cambio',
  delete: 'Borrado',
  issue: 'Emisión de factura',
  rectify: 'Rectificativa',
  void: 'Anulación',
  status: 'Cambio de estado',
  email: 'Envío por email',
  settings_update: 'Cambio de ajustes',
  catalog_create: 'Alta en lista',
  catalog_update: 'Cambio en lista',
  catalog_delete: 'Baja en lista',
};

/** Conservación de datos y registro de accesos. Solo para administradoras. */
export default function Privacy() {
  const [tab, setTab] = useState('retention');
  return (
    <section>
      <div className="toolbar">
        <h1>Privacidad</h1>
      </div>
      <div className="filters">
        {TABS.map((t) => {
          const chip = (
            <button key={t.id} className={'chip' + (tab === t.id ? ' active' : '')} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          );
          return t.help ? (
            <HelpTip key={t.id} help={t.help}>
              {chip}
            </HelpTip>
          ) : (
            chip
          );
        })}
      </div>
      {tab === 'retention' ? <Retention /> : <AuditLog />}
    </section>
  );
}

function Retention() {
  const config = useConfig();
  const [data, setData] = useState(null);
  const load = () => api.retention().then(setData);
  useEffect(() => {
    load();
  }, []);

  async function anonymize(row) {
    if (
      !confirm(
        `Anonimizar la ficha de ${row.name}.\n\n` +
          'Se borran nombre, contacto, FPP y notas, y también las notas de sus citas.\n' +
          'Sus facturas se conservan intactas: la ley obliga a guardarlas.\n\n' +
          'Esto no se puede deshacer. ¿Seguir?',
      )
    ) {
      return;
    }
    const reason = prompt('Motivo (queda en el registro):', 'Plazo de conservación cumplido');
    if (reason === null) return;
    try {
      await api.anonymize(row.id, { reason });
      load();
    } catch (e) {
      alert(e.message);
    }
  }

  if (!data) return <Skeleton rows={4} />;

  return (
    <div className="panel">
      <p className="muted">
        Fichas sin actividad desde hace más de <strong>{data.retentionYears} años</strong> (antes del{' '}
        {fmtDate(data.cutoff)}). Aquí no se borra nada solo: el listado propone y la decisión es tuya. El
        plazo se cambia en Ajustes.
      </p>
      <p className="muted small">
        Plazo actual configurado: {config.privacy.retentionYears} años.
      </p>

      <table className="grid-table">
        <thead>
          <tr>
            <th>Clienta</th>
            <th>Última actividad</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>{r.name}</strong>
              </td>
              <td className="muted">{fmtDate(r.lastActivity)}</td>
              <td className="row-actions">
                <a className="btn" href={api.exportClientUrl(r.id)} target="_blank" rel="noreferrer">
                  Descargar sus datos
                </a>
                <button className="danger" onClick={() => anonymize(r)}>
                  Anonimizar
                </button>
              </td>
            </tr>
          ))}
          {data.rows.length === 0 && <EmptyRow colSpan={3} text="Nada pendiente de revisar" />}
        </tbody>
      </table>
    </div>
  );
}

function AuditLog() {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');

  useEffect(() => {
    api.audit({ page, action }).then(setData);
  }, [page, action]);

  if (!data) return <Skeleton rows={4} />;
  const pages = Math.ceil(data.total / data.pageSize) || 1;

  return (
    <div className="panel">
      <div className="filters">
        <span className="muted">Filtrar:</span>
        {['', 'client_view', 'client_export', 'client_anonymize', 'login', 'login_fail'].map((act) => (
          <button
            key={act || 'todo'}
            className={'chip' + (action === act ? ' active' : '')}
            onClick={() => {
              setAction(act);
              setPage(1);
            }}
          >
            {act === '' ? 'Todo' : ACTION_LABELS[act] || act}
          </button>
        ))}
      </div>

      <table className="grid-table compact">
        <thead>
          <tr>
            <th>Cuándo</th>
            <th>Quién</th>
            <th>Qué</th>
            <th>Sobre</th>
            <th>Detalle</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.id}>
              <td className="muted">{fmtDate(r.at)}</td>
              <td>{r.userEmail || <span className="muted">—</span>}</td>
              <td>{ACTION_LABELS[r.action] || r.action}</td>
              <td className="muted">
                {r.entity}
                {r.entityId ? ` #${r.entityId}` : ''}
              </td>
              <td className="muted">{r.detail}</td>
            </tr>
          ))}
          {data.rows.length === 0 && <EmptyRow colSpan={5} />}
        </tbody>
      </table>

      {pages > 1 && (
        <div className="pager">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            ← Anterior
          </button>
          <span className="muted">
            Página {page} de {pages} · {data.total} entradas
          </span>
          <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}>
            Siguiente →
          </button>
        </div>
      )}
    </div>
  );
}
