import { useState } from 'react';
import { api } from '../api.js';
import { Field, Skeleton, HelpTitle, HelpTip } from '../components/ui.jsx';
import { useConfig } from '../config.jsx';
import Users from './Users.jsx';

const TABS = [
  { id: 'issuer', label: 'Datos fiscales' },
  { id: 'invoicing', label: 'Facturación', help: 'Valores por defecto al crear una factura. Cada factura puede luego llevar los suyos.' },
  { id: 'brand', label: 'Marca', help: 'Lo que se ve en la barra lateral de la aplicación.' },
  { id: 'agenda', label: 'Agenda' },
  {
    id: 'reminders',
    label: 'Recordatorios',
    help: 'Nada se envía solo: el inicio avisa de lo que hay pendiente y tú decides. Aquí se define cuándo algo cuenta como pendiente y qué dice el correo.',
  },
  {
    id: 'emailTemplate',
    label: 'Email',
    help: (
      <>
        Texto del correo con el que se envía una factura. Puedes usar los marcadores <code>{'{{clienta}}'}</code>,
        <code>{'{{numero}}'}</code>, <code>{'{{fecha}}'}</code>, <code>{'{{total}}'}</code> y <code>{'{{negocio}}'}</code>.
      </>
    ),
  },
  {
    id: 'privacy',
    label: 'Privacidad',
    help: 'Los datos de embarazo, lactancia y las notas son datos de salud (categoría especial del Art. 9 del RGPD). El texto de consentimiento se guarda con su versión, para que puedas demostrar qué aceptó cada clienta y cuándo.',
  },
  {
    id: 'catalogs',
    label: 'Listas',
    help: (
      <>
        Las opciones que aparecen en los desplegables. <strong>Desactivar</strong> una la quita de los
        formularios nuevos pero no toca las fichas que ya la usaban; <strong>borrar</strong> solo tiene
        sentido para una opción recién creada por error.
      </>
    ),
  },
  {
    id: 'users',
    label: 'Usuarios',
    help: 'Quien puede entrar al CRM. Mientras trabajes sola basta con tu cuenta; esto es lo que usarás el día que entren más profesionales, y es lo que hace que el registro de accesos signifique algo.',
  },
];

// Lo marcado como obligatorio lo exige el artículo 6.1 del RD 1619/2012
// (Reglamento de facturación). Sin esos datos la factura no es válida.
const ISSUER_FIELDS = [
  { key: 'name', label: 'Nombre y apellidos o razón social', required: true },
  { key: 'taxId', label: 'NIF / CIF', required: true },
  { key: 'address', label: 'Domicilio fiscal', required: true },
  { key: 'postalCode', label: 'Código postal', required: true },
  { key: 'city', label: 'Población', required: true },
  { key: 'province', label: 'Provincia' },
  { key: 'country', label: 'País' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Teléfono' },
  {
    key: 'registryData',
    label: 'Datos registrales',
    hint: 'Solo si eres sociedad: Registro Mercantil, tomo, folio y hoja. Si eres autónoma, déjalo vacío.',
    wide: true,
  },
];

/** Ajustes del negocio. Solo para administradoras. */
export default function Settings({ me }) {
  const config = useConfig();
  const [tab, setTab] = useState('issuer');
  const [draft, setDraft] = useState({
    issuer: config.issuer,
    invoicing: config.invoicing,
    brand: config.brand,
    emailTemplate: config.emailTemplate,
    privacy: config.privacy,
    reminders: config.reminders,
    calendar: config.calendar,
  });
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  const set = (key, field) => (e) =>
    setDraft({ ...draft, [key]: { ...draft[key], [field]: e.target.value } });

  async function save(key) {
    setError('');
    try {
      const value = await api.saveSettings(key, draft[key]);
      setDraft({ ...draft, [key]: value });
      // Recargar la configuración global: la marca y las listas se usan en
      // toda la aplicación, no solo aquí.
      await config.reload();
      setSaved(key);
      setTimeout(() => setSaved(''), 2500);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <section>
      <div className="toolbar">
        <h1>Ajustes</h1>
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

      {error && <p className="error">{error}</p>}

      {tab === 'issuer' && (
        <div className="panel">
          <p className="muted">
            Estos datos salen en todas tus facturas. Los marcados con * son obligatorios según el artículo
            6.1 del Reglamento de facturación (RD 1619/2012): sin ellos la factura no es válida, así que no
            podrás emitir hasta completarlos.
          </p>
          <div className="form-grid">
            {ISSUER_FIELDS.filter((f) => !f.wide).map((f) => (
              <Field key={f.key} label={f.label + (f.required ? ' *' : '')}>
                <input value={draft.issuer[f.key]} onChange={set('issuer', f.key)} />
              </Field>
            ))}
          </div>
          {ISSUER_FIELDS.filter((f) => f.wide).map((f) => (
            <div key={f.key}>
              <Field label={f.label}>
                <input value={draft.issuer[f.key]} onChange={set('issuer', f.key)} />
              </Field>
              {f.hint && <p className="muted small">{f.hint}</p>}
            </div>
          ))}
          <SaveRow onSave={() => save('issuer')} saved={saved === 'issuer'} />
        </div>
      )}

      {tab === 'invoicing' && (
        <div className="panel">
          <div className="form-grid">
            <Field label="Serie de las facturas">
              <input
                value={draft.invoicing.series}
                onChange={set('invoicing', 'series')}
                placeholder={`(vacío: ${new Date().getFullYear()}-0001)`}
              />
            </Field>
            <Field label="Serie de las rectificativas">
              <input value={draft.invoicing.rectifySeries} onChange={set('invoicing', 'rectifySeries')} />
            </Field>
            <Field label="IVA por defecto %">
              <input
                type="number"
                step="1"
                min="0"
                value={draft.invoicing.vatRate}
                onChange={set('invoicing', 'vatRate')}
              />
            </Field>
            <Field label="Retención de IRPF por defecto %">
              <input
                type="number"
                step="0.01"
                min="0"
                value={draft.invoicing.irpfRate}
                onChange={set('invoicing', 'irpfRate')}
              />
            </Field>
          </div>

          <Field label="Nota de exención de IVA">
            <textarea rows={3} value={draft.invoicing.exemptionNote} onChange={set('invoicing', 'exemptionNote')} />
          </Field>
          <p className="muted small">
            Sale en la factura cuando el IVA es cero. Si facturas servicios sanitarios exentos, tienes que
            ponerlo.
          </p>

          <Field label="Datos de pago (salen en la factura)">
            <textarea
              rows={2}
              value={draft.invoicing.paymentDetails}
              onChange={set('invoicing', 'paymentDetails')}
              placeholder="IBAN, Bizum…"
            />
          </Field>

          <Field label="Pie de la factura">
            <input value={draft.invoicing.footer} onChange={set('invoicing', 'footer')} />
          </Field>

          <SaveRow onSave={() => save('invoicing')} saved={saved === 'invoicing'} />
        </div>
      )}

      {tab === 'brand' && (
        <div className="panel">
          <div className="form-grid">
            <Field label="Nombre">
              <input value={draft.brand.name} onChange={set('brand', 'name')} />
            </Field>
            <Field label="Pie de la barra lateral">
              <input value={draft.brand.sidebarFooter} onChange={set('brand', 'sidebarFooter')} />
            </Field>
          </div>
          <SaveRow onSave={() => save('brand')} saved={saved === 'brand'} />
        </div>
      )}

      {tab === 'agenda' && (
        <div className="panel">
          <h3 className="pending-title">Ver las citas en Google Calendar</h3>
          <CalendarFeed />
        </div>
      )}

      {tab === 'reminders' && (
        <div className="panel">
          <div className="form-grid">
            <Field label="Días de cortesía sin vencimiento">
              <input
                type="number"
                min="0"
                max="180"
                value={draft.reminders.graceDays}
                onChange={set('reminders', 'graceDays')}
              />
            </Field>
            <Field label="Avisar de las citas con tantos días">
              <input
                type="number"
                min="0"
                max="30"
                value={draft.reminders.appointmentDaysAhead}
                onChange={set('reminders', 'appointmentDaysAhead')}
              />
            </Field>
          </div>
          <p className="muted small">
            Si una factura no tiene vencimiento, cuenta como vencida pasados esos días desde su fecha. Sin
            esto no vencería nunca y no saldría en ningún aviso.
          </p>

          <HelpTitle
            as="h3"
            className="pending-title"
            help={
              <>
                Marcadores: <code>{'{{clienta}}'}</code> <code>{'{{numero}}'}</code> <code>{'{{total}}'}</code>{' '}
                <code>{'{{vencimiento}}'}</code> <code>{'{{negocio}}'}</code>
              </>
            }
          >
            Recordatorio de pago
          </HelpTitle>
          <Field label="Asunto">
            <input value={draft.reminders.invoiceSubject} onChange={set('reminders', 'invoiceSubject')} />
          </Field>
          <Field label="Mensaje">
            <textarea rows={5} value={draft.reminders.invoiceBody} onChange={set('reminders', 'invoiceBody')} />
          </Field>

          <HelpTitle
            as="h3"
            className="pending-title"
            help={
              <>
                Marcadores: <code>{'{{clienta}}'}</code> <code>{'{{fecha}}'}</code> <code>{'{{hora}}'}</code>{' '}
                <code>{'{{servicio}}'}</code> <code>{'{{modalidad}}'}</code> <code>{'{{negocio}}'}</code>
              </>
            }
          >
            Recordatorio de cita
          </HelpTitle>
          <Field label="Asunto">
            <input
              value={draft.reminders.appointmentSubject}
              onChange={set('reminders', 'appointmentSubject')}
            />
          </Field>
          <Field label="Mensaje">
            <textarea
              rows={5}
              value={draft.reminders.appointmentBody}
              onChange={set('reminders', 'appointmentBody')}
            />
          </Field>

          <SaveRow onSave={() => save('reminders')} saved={saved === 'reminders'} />
        </div>
      )}

      {tab === 'emailTemplate' && (
        <div className="panel">
          <Field label="Asunto">
            <input value={draft.emailTemplate.subject} onChange={set('emailTemplate', 'subject')} />
          </Field>
          <Field label="Saludo">
            <textarea rows={2} value={draft.emailTemplate.greeting} onChange={set('emailTemplate', 'greeting')} />
          </Field>
          <Field label="Despedida">
            <textarea
              rows={2}
              value={draft.emailTemplate.signature}
              onChange={set('emailTemplate', 'signature')}
            />
          </Field>
          <p className="muted small">
            Las líneas y el total se añaden solos; aquí solo escribes el texto de alrededor.
          </p>
          <SaveRow onSave={() => save('emailTemplate')} saved={saved === 'emailTemplate'} />
        </div>
      )}

      {tab === 'privacy' && (
        <div className="panel">
          <div className="form-grid">
            <Field label="Años de conservación">
              <input
                type="number"
                min="1"
                max="30"
                value={draft.privacy.retentionYears}
                onChange={set('privacy', 'retentionYears')}
              />
            </Field>
            <Field label="Versión del texto de consentimiento">
              <input value={draft.privacy.consentVersion} onChange={set('privacy', 'consentVersion')} />
            </Field>
          </div>
          <Field label="Texto de consentimiento">
            <textarea rows={6} value={draft.privacy.consentText} onChange={set('privacy', 'consentText')} />
          </Field>
          <p className="muted small">
            Si cambias el texto, sube también la versión: cada ficha guarda la versión que aceptó, y si no la
            subes no habrá forma de saber quién aceptó qué.
          </p>
          <SaveRow onSave={() => save('privacy')} saved={saved === 'privacy'} />

          <h3 className="pending-title">Formularios para imprimir</h3>
          <p className="muted small">
            En blanco, con tus datos fiscales de Ajustes como responsable. En la ficha de cada clienta salen ya
            con sus datos. Guarda antes los cambios de arriba: el consentimiento lleva el texto y la versión
            guardados.
          </p>
          <div className="form-links">
            <a className="btn" href={api.consentFormUrl('consentimiento')} target="_blank" rel="noreferrer">
              Consentimiento
            </a>
            <a className="btn" href={api.consentFormUrl('revocacion')} target="_blank" rel="noreferrer">
              Retirada del consentimiento
            </a>
            <a className="btn" href={api.consentFormUrl('derechos')} target="_blank" rel="noreferrer">
              Solicitud de derechos
            </a>
          </div>
        </div>
      )}

      {tab === 'catalogs' && <Catalogs />}

      {tab === 'users' && (
        <div className="panel">
          <Users me={me} embedded />
        </div>
      )}
    </section>
  );
}

/** Las listas desplegables de los formularios. */
function Catalogs() {
  const config = useConfig();
  const [adding, setAdding] = useState({});
  const [error, setError] = useState('');

  const refresh = () => config.reload();
  const run = async (fn) => {
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="panel">
      {error && <p className="error">{error}</p>}

      {Object.entries(config.catalogTypes).map(([type, label]) => (
        <div className="catalog" key={type}>
          <h3>{label}</h3>
          <ul className="catalog-list">
            {(config.catalogs[type] || []).map((opt) => (
              <li key={opt.id} className={opt.active ? '' : 'inactive-row'}>
                <input
                  defaultValue={opt.value}
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value !== opt.value) {
                      run(() => api.updateCatalog(opt.id, { value: e.target.value }));
                    }
                  }}
                />
                <button onClick={() => run(() => api.updateCatalog(opt.id, { active: !opt.active }))}>
                  {opt.active ? 'Desactivar' : 'Activar'}
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    if (confirm(`¿Borrar "${opt.value}" de la lista?`)) {
                      run(() => api.removeCatalog(opt.id));
                    }
                  }}
                >
                  Borrar
                </button>
              </li>
            ))}
          </ul>
          <div className="catalog-add">
            <input
              value={adding[type] || ''}
              placeholder="Añadir opción…"
              onChange={(e) => setAdding({ ...adding, [type]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const value = (adding[type] || '').trim();
                if (!value) return;
                run(() => api.addCatalog({ type, value })).then(() => setAdding({ ...adding, [type]: '' }));
              }}
            />
            <button
              onClick={() => {
                const value = (adding[type] || '').trim();
                if (!value) return;
                run(() => api.addCatalog({ type, value })).then(() => setAdding({ ...adding, [type]: '' }));
              }}
            >
              Añadir
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Publicación del calendario como suscripción .ics. */
function CalendarFeed() {
  const config = useConfig();
  const [cfg, setCfg] = useState(config.calendar);
  const [error, setError] = useState('');
  const [copiado, setCopiado] = useState(false);

  const url = cfg.feedToken ? `${window.location.origin}/api/calendar/${cfg.feedToken}.ics` : '';

  async function token(revoke) {
    if (revoke && !confirm('Al revocar el enlace, el calendario dejará de actualizarse en Google. ¿Seguimos?')) {
      return;
    }
    setError('');
    try {
      setCfg(await api.calendarToken(revoke));
      await config.reload();
    } catch (e) {
      setError(e.message);
    }
  }

  async function guardar(campo, valor) {
    setError('');
    try {
      setCfg(await api.saveSettings('calendar', { ...cfg, [campo]: valor ? 1 : 0 }));
      await config.reload();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="feed-box">
      <p className="muted">
        Google Calendar puede suscribirse a un enlace y refrescarlo solo, así que tus citas aparecen también
        ahí. Va en un sentido: del CRM a Google. Lo que apuntes en Google no vuelve aquí.
      </p>

      {error && <p className="error">{error}</p>}

      {!cfg.feedToken ? (
        <>
          <p className="notice">
            Este enlace publica <strong>a qué hora ves a cada clienta</strong>. Quien lo tenga lo ve todo,
            sin contraseña. Genéralo solo si vas a usarlo, no lo pegues en ningún sitio público, y revócalo
            si dudas.
          </p>
          <button className="primary" onClick={() => token(false)}>
            Generar el enlace
          </button>
        </>
      ) : (
        <>
          <Field label="Enlace de suscripción">
            <input value={url} readOnly onFocus={(e) => e.target.select()} />
          </Field>
          <div className="save-row">
            <button
              onClick={() => {
                navigator.clipboard?.writeText(url);
                setCopiado(true);
                setTimeout(() => setCopiado(false), 2500);
              }}
            >
              Copiar
            </button>
            <button className="danger" onClick={() => token(true)}>
              Revocar
            </button>
            {copiado && <span className="saved-note">Copiado</span>}
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={!!cfg.includeClientNames}
              onChange={(e) => guardar('includeClientNames', e.target.checked)}
            />
            <span>Incluir el nombre de la clienta</span>
          </label>
          <p className="muted small">
            Sin marcar, los eventos dicen qué hay y a qué hora, pero no con quién. Útil si compartes el
            calendario del móvil con alguien.
          </p>

          <label className="check">
            <input
              type="checkbox"
              checked={!!cfg.includeOnCall}
              onChange={(e) => guardar('includeOnCall', e.target.checked)}
            />
            <span>Incluir las fechas probables de parto</span>
          </label>

          <details className="fiscal">
            <summary>Cómo añadirlo a Google Calendar</summary>
            <ol className="muted small steps">
              <li>Copia el enlace de arriba.</li>
              <li>
                En el ordenador, abre Google Calendar y, en «Otros calendarios», pulsa <strong>+</strong> y
                luego <strong>Con URL</strong>.
              </li>
              <li>Pega el enlace y añade el calendario.</li>
            </ol>
            <p className="muted small">
              Google refresca estos calendarios cuando quiere, y a veces tarda horas. No es un fallo del
              CRM: es cómo funcionan las suscripciones por URL.
            </p>
          </details>
        </>
      )}
    </div>
  );
}

function SaveRow({ onSave, saved }) {
  return (
    <div className="save-row">
      <button className="primary" onClick={onSave}>
        Guardar
      </button>
      {saved && <span className="saved-note">Guardado</span>}
    </div>
  );
}
