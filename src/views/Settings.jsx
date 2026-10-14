import { useState } from 'react';
import { api } from '../api.js';
import { Field } from '../components/ui.jsx';
import { useConfig } from '../config.jsx';

const TABS = [
  { id: 'issuer', label: 'Datos fiscales' },
  { id: 'invoicing', label: 'Facturación' },
  { id: 'brand', label: 'Marca' },
  { id: 'oncall', label: 'Agenda' },
  { id: 'reminders', label: 'Recordatorios' },
  { id: 'emailTemplate', label: 'Email' },
  { id: 'privacy', label: 'Privacidad' },
  { id: 'catalogs', label: 'Listas' },
];

const ISSUER_FIELDS = [
  { key: 'name', label: 'Nombre o razón social', required: true },
  { key: 'taxId', label: 'NIF / CIF', required: true },
  { key: 'address', label: 'Dirección', required: true },
  { key: 'postalCode', label: 'Código postal' },
  { key: 'city', label: 'Población', required: true },
  { key: 'province', label: 'Provincia' },
  { key: 'country', label: 'País' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Teléfono' },
];

/** Ajustes del negocio. Solo para administradoras. */
export default function Settings() {
  const config = useConfig();
  const [tab, setTab] = useState('issuer');
  const [draft, setDraft] = useState({
    issuer: config.issuer,
    invoicing: config.invoicing,
    brand: config.brand,
    emailTemplate: config.emailTemplate,
    privacy: config.privacy,
    oncall: config.oncall,
    reminders: config.reminders,
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
        {TABS.map((t) => (
          <button key={t.id} className={'chip' + (tab === t.id ? ' active' : '')} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      {tab === 'issuer' && (
        <div className="panel">
          <p className="muted">
            Estos datos salen en todas tus facturas y son obligatorios para que sean válidas. Sin el nombre
            fiscal, el NIF, la dirección y la población no se puede emitir.
          </p>
          <div className="form-grid">
            {ISSUER_FIELDS.map((f) => (
              <Field key={f.key} label={f.label + (f.required ? ' *' : '')}>
                <input value={draft.issuer[f.key]} onChange={set('issuer', f.key)} />
              </Field>
            ))}
          </div>
          <SaveRow onSave={() => save('issuer')} saved={saved === 'issuer'} />
        </div>
      )}

      {tab === 'invoicing' && (
        <div className="panel">
          <p className="muted">
            Valores por defecto al crear una factura. Cada factura puede luego llevar los suyos.
          </p>
          <div className="form-grid">
            <Field label="Serie de las facturas">
              <input
                value={draft.invoicing.series}
                onChange={set('invoicing', 'series')}
                placeholder="(vacío: 2026-0001)"
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
            Sale en la factura cuando el IVA es cero. Si facturas servicios sanitarios exentos, este texto es
            obligatorio.
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
          <p className="muted">Lo que se ve en la barra lateral de la aplicación.</p>
          <div className="form-grid">
            <Field label="Nombre">
              <input value={draft.brand.name} onChange={set('brand', 'name')} />
            </Field>
            <Field label="Subtítulo">
              <input value={draft.brand.tagline} onChange={set('brand', 'tagline')} />
            </Field>
            <Field label="Pie de la barra lateral">
              <input value={draft.brand.sidebarFooter} onChange={set('brand', 'sidebarFooter')} />
            </Field>
          </div>
          <SaveRow onSave={() => save('brand')} saved={saved === 'brand'} />
        </div>
      )}

      {tab === 'oncall' && (
        <div className="panel">
          <p className="muted">
            Las semanas de disponibilidad permanente alrededor de la fecha probable de parto. El calendario
            pinta esa franja para cada clienta y avisa cuando dos se solapan, que es cuando harían falta dos
            personas.
          </p>
          <div className="form-grid">
            <Field label="Semanas antes de la FPP">
              <input
                type="number"
                min="0"
                max="12"
                step="0.5"
                value={draft.oncall.weeksBefore}
                onChange={set('oncall', 'weeksBefore')}
              />
            </Field>
            <Field label="Semanas después de la FPP">
              <input
                type="number"
                min="0"
                max="12"
                step="0.5"
                value={draft.oncall.weeksAfter}
                onChange={set('oncall', 'weeksAfter')}
              />
            </Field>
          </div>
          <p className="muted small">
            Por defecto, 3 semanas antes (desde la 37, que es cuando el embarazo es a término) y 2 después.
          </p>
          <SaveRow onSave={() => save('oncall')} saved={saved === 'oncall'} />
        </div>
      )}

      {tab === 'reminders' && (
        <div className="panel">
          <p className="muted">
            Nada se envía solo: el inicio avisa de lo que hay pendiente y tú decides. Aquí se define cuándo
            algo cuenta como pendiente y qué dice el correo.
          </p>
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
            Una factura sin fecha de vencimiento se considera vencida pasados esos días desde su fecha. Sin
            esto no vencería nunca y no aparecería en ningún aviso.
          </p>

          <h3 className="pending-title">Recordatorio de pago</h3>
          <p className="muted small">
            Marcadores: <code>{'{{clienta}}'}</code> <code>{'{{numero}}'}</code> <code>{'{{total}}'}</code>{' '}
            <code>{'{{vencimiento}}'}</code> <code>{'{{negocio}}'}</code>
          </p>
          <Field label="Asunto">
            <input value={draft.reminders.invoiceSubject} onChange={set('reminders', 'invoiceSubject')} />
          </Field>
          <Field label="Mensaje">
            <textarea rows={5} value={draft.reminders.invoiceBody} onChange={set('reminders', 'invoiceBody')} />
          </Field>

          <h3 className="pending-title">Recordatorio de cita</h3>
          <p className="muted small">
            Marcadores: <code>{'{{clienta}}'}</code> <code>{'{{fecha}}'}</code> <code>{'{{hora}}'}</code>{' '}
            <code>{'{{servicio}}'}</code> <code>{'{{modalidad}}'}</code> <code>{'{{negocio}}'}</code>
          </p>
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
          <p className="muted">
            Texto del correo con el que se envía una factura. Puedes usar los marcadores{' '}
            <code>{'{{clienta}}'}</code>, <code>{'{{numero}}'}</code>, <code>{'{{fecha}}'}</code>,{' '}
            <code>{'{{total}}'}</code> y <code>{'{{negocio}}'}</code>.
          </p>
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
            El detalle de las líneas y el total se añaden solos; aquí solo se escribe el texto que los rodea.
          </p>
          <SaveRow onSave={() => save('emailTemplate')} saved={saved === 'emailTemplate'} />
        </div>
      )}

      {tab === 'privacy' && (
        <div className="panel">
          <p className="muted">
            Los datos de embarazo, lactancia y las notas son datos de salud: categoría especial del Art. 9
            del RGPD. El texto de consentimiento se guarda con versión, para poder demostrar qué aceptó cada
            clienta y cuándo.
          </p>
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
            Si cambias el texto, sube también la versión: las fichas guardan la versión que aceptaron, y sin
            subirla no se podría distinguir quién aceptó qué.
          </p>
          <SaveRow onSave={() => save('privacy')} saved={saved === 'privacy'} />
        </div>
      )}

      {tab === 'catalogs' && <Catalogs />}
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
      <p className="muted">
        Las opciones que aparecen en los desplegables. <strong>Desactivar</strong> una la quita de los
        formularios nuevos pero no toca las fichas que ya la usaban; <strong>borrar</strong> solo tiene
        sentido para una opción recién creada por error.
      </p>
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
