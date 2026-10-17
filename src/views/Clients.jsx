import { useEffect, useState } from 'react';
import { api, fmtDate, gestWeeks } from '../api.js';
import { searchItems } from '../search.js';
import { Toolbar, Badge, Modal, Field, EmptyRow, SortTh } from '../components/ui.jsx';
import { sortRows, nextSort } from '../lib/sort.js';
import QuestionnaireModal from '../components/QuestionnaireModal.jsx';
import ConsentTools from '../components/ConsentTools.jsx';
import ConsentSignModal from '../components/ConsentSignModal.jsx';
import ClientRecord from '../components/ClientRecord.jsx';
import { kindForService } from '../data/questionnaires.js';
import { useConfig, options } from '../config.jsx';

const EMPTY = {
  name: '', email: '', phone: '', service: '', mode: '', dueDate: '',
  status: 'Activa', notes: '',
  taxId: '', address: '', postalCode: '', city: '', province: '', country: 'España',
  consentAt: '', consentChannel: '', consentVersion: '',
};
const FISCAL = ['taxId', 'address', 'postalCode', 'city', 'province', 'country'];

const text = (c) => `${c.name} ${c.email} ${c.phone} ${c.service} ${c.mode} ${c.status} ${c.notes} ${c.taxId}`;

export default function Clients({ initialFilter }) {
  const config = useConfig();
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState(initialFilter?.q || '');
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [consentOpen, setConsentOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  // La ficha abierta (id) y, si se firma desde el listado o la ficha, de quién es la firma.
  const [recordId, setRecordId] = useState(null);
  const [recordKey, setRecordKey] = useState(0);
  const [signClient, setSignClient] = useState(null);
  // Firma hecha antes de que exista la ficha: se guarda al crearla.
  const [pendingSignature, setPendingSignature] = useState('');
  // { client, kind, fromCreate }: el cuestionario abierto, y si venimos de
  // crear la ficha (entonces cerrar no cancela nada, es "mas tarde").
  const [formFor, setFormFor] = useState(null);
  // { [clientId]: Array<{ kind, status }> }, para marcar los pendientes.
  const [formStatus, setFormStatus] = useState({});

  const load = () => {
    // El resumen de cuestionarios es una peticion para toda la tabla, no una
    // por fila. Si falla, el listado se pinta igual y sin marcas.
    api.clientForms().then(setFormStatus).catch(() => setFormStatus({}));
    return api.list('clients').then(setRows);
  };
  useEffect(() => {
    load();
  }, []);

  // Estado del cuestionario de una clienta: lo que se pinta y lo que se ordena.
  function questionnaire(c) {
    if (c.anonymizedAt) return null;
    const saved = formStatus[c.id] || [];
    // El del servicio; si el servicio no pide ninguno pero hay uno guardado
    // (le cambiaron el servicio despues), ese.
    const kind = kindForService(c.service) || saved[0]?.kind;
    if (!kind) return null;
    return { kind, row: saved.find((f) => f.kind === kind) };
  }
  const SORT_BY = {
    name: (c) => c.name,
    service: (c) => c.service,
    mode: (c) => c.mode,
    dueDate: (c) => c.dueDate,
    status: (c) => c.status,
    consent: (c) => (c.anonymizedAt ? '' : c.consentAt ? 'Firmado' : 'Sin firmar'),
    form: (c) => {
      const q = questionnaire(c);
      if (!q) return '';
      return q.row ? (q.row.status === 'completo' ? 'Completo' : 'Pendiente') : 'Sin rellenar';
    },
  };
  const onSort = (key) => setSort((s0) => nextSort(s0, key));
  const visible = sortRows(searchItems(rows, query, text), sort, SORT_BY);
  // Escape suelta la fila: los datos vuelven a quedar borrosos.
  const soltar = (e) => e.key === 'Escape' && e.currentTarget.blur();
  const set = (f) => (e) => setForm({ ...form, [f]: e.target.value });

  // Los desplegables salen de los catalogos, no de constantes del codigo.
  const SERVICES = options(config.catalogs.clientService, form.service);
  const MODES = options(config.catalogs.mode, form.mode);
  const STATUSES = options(config.catalogs.clientStatus, form.status);

  function newRow() {
    setForm({ ...EMPTY, status: options(config.catalogs.clientStatus)[0] ?? '' });
    setEditingId(null);
    setError('');
    setPendingSignature('');
    setConsentOpen(false);
    setOpen(true);
  }
  function edit(c) {
    // Las claves que falten (fichas antiguas) caen a los valores por defecto.
    setForm({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, c[k] ?? EMPTY[k]])) });
    setEditingId(c.id);
    setError('');
    setConsentOpen(false);
    setOpen(true);
  }
  // Firmó en el popup. Si la ficha ya existe, se guarda en el acto; si es
  // nueva, la firma espera a que se cree y viaja justo después.
  async function onSigned(signature) {
    if (editingId) {
      const c = await api.consent(editingId, { action: 'grant', signature });
      setForm((f) => ({ ...f, consentAt: c.consentAt, consentChannel: c.consentChannel, consentVersion: c.consentVersion }));
      setConsentOpen(true);
      load();
    } else {
      setPendingSignature(signature);
    }
    setSignOpen(false);
  }
  async function save() {
    try {
      // Se guarda la version del texto vigente al aceptarlo: si el texto
      // cambia despues, hay que poder saber cual acepto cada clienta.
      const body = form.consentAt
        ? { ...form, consentVersion: form.consentVersion || config.privacy.consentVersion }
        : form;
      const saved = editingId
        ? await api.update('clients', editingId, body)
        : await api.create('clients', body);
      setOpen(false);
      if (!editingId && pendingSignature) {
        try {
          await api.consent(saved.id, { action: 'grant', signature: pendingSignature });
        } catch (e) {
          alert(`La ficha se ha creado, pero no se pudo guardar la firma: ${e.message}\nAbre la ficha y vuelve a firmar.`);
        }
      }
      load();
      // Al crear, el cuestionario del servicio es el paso siguiente. Al
      // editar no: para eso esta el boton del listado.
      const kind = editingId ? null : kindForService(saved.service);
      if (kind) setFormFor({ client: saved, kind, fromCreate: true });
    } catch (e) {
      setError(e.message);
    }
  }
  async function remove(id) {
    if (!confirm('¿Borrar esta ficha?')) return;
    try {
      await api.remove('clients', id);
      load();
    } catch (e) {
      // El servidor se niega si tiene facturas: hay que conservarlas.
      alert(e.message);
    }
  }

  return (
    <section>
      <Toolbar title="Clientas" query={query} setQuery={setQuery} onNew={newRow} newLabel="Nueva clienta" />

      <table className="grid-table">
        <thead>
          <tr>
            <SortTh label="Nombre" k="name" sort={sort} onSort={onSort} />
            <SortTh label="Servicio" k="service" sort={sort} onSort={onSort} />
            <SortTh label="Modalidad" k="mode" sort={sort} onSort={onSort} />
            <SortTh label="FPP" k="dueDate" sort={sort} onSort={onSort} />
            <SortTh label="Estado" k="status" sort={sort} onSort={onSort} />
            <SortTh label="Cuestionario" k="form" sort={sort} onSort={onSort} />
            <SortTh label="RGPD" k="consent" sort={sort} onSort={onSort} />
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((c) => (
            <tr
              key={c.id}
              className={'private-row' + (c.anonymizedAt ? ' inactive-row' : '')}
              tabIndex={0}
              onKeyDown={(e) => {
                soltar(e);
                if (e.key === 'Enter' && e.target === e.currentTarget) setRecordId(c.id);
              }}
              onClick={(e) => {
                // Los botones y enlaces de la fila hacen lo suyo; el resto abre la ficha.
                if (!e.target.closest('button, a')) setRecordId(c.id);
              }}
              title="Pulsa para abrir su ficha"
            >
              <td>
                <strong>{c.name}</strong>
                <div className="muted sensitive">
                  {c.anonymizedAt ? `Anonimizada el ${fmtDate(c.anonymizedAt)}` : c.email || c.phone}
                </div>
              </td>
              <td>
                <span className="sensitive">{c.service}</span>
              </td>
              <td className="muted">
                <span className="sensitive">{c.mode}</span>
              </td>
              <td className="muted">
                <div className="sensitive">
                  {c.dueDate ? (
                    <>
                      {fmtDate(c.dueDate)}
                      {(() => {
                        const g = gestWeeks(c.dueDate);
                        if (!g) return null;
                        return <div className={'gest' + (g.past ? ' gest-past' : '')}>{g.past ? 'FPP pasada' : `${g.label} sem`}</div>;
                      })()}
                    </>
                  ) : (
                    '—'
                  )}
                </div>
              </td>
              <td>
                <span className="sensitive">
                  <Badge value={c.status} />
                </span>
              </td>
              <td>
                <span className="sensitive">
                  {(() => {
                    const q = questionnaire(c);
                    if (!q) return <span className="muted">—</span>;
                    const done = q.row?.status === 'completo';
                    return (
                      <button
                        type="button"
                        className={'status-chip ' + (done ? 'is-done' : 'is-todo')}
                        onClick={() => setFormFor({ client: c, kind: q.kind, startLocked: done })}
                      >
                        {done ? '✓ Completo' : q.row ? 'Pendiente' : 'Rellenar'}
                      </button>
                    );
                  })()}
                </span>
              </td>
              <td>
                {c.anonymizedAt ? (
                  <span className="muted">—</span>
                ) : (
                  <span className="sensitive">
                    <button
                      type="button"
                      className={'status-chip ' + (c.consentAt ? 'is-done' : 'is-todo')}
                      onClick={() => (c.consentAt ? setRecordId(c.id) : setSignClient(c))}
                      title={c.consentAt ? `Firmado el ${fmtDate(c.consentAt)}` : 'Leer y firmar el consentimiento'}
                    >
                      {c.consentAt ? '✓ Firmado' : 'Sin firmar'}
                    </button>
                  </span>
                )}
              </td>
              <td className="row-actions">
                <a className="btn" href={api.exportClientUrl(c.id)} target="_blank" rel="noreferrer"
                   title="Descargar todo lo que guardamos de ella (derecho de acceso)">
                  Datos
                </a>
                <button onClick={() => edit(c)}>Editar</button>
                {c.anonymizedAt ? (
                  <button className="danger" disabled>
                    Anonimizada
                  </button>
                ) : (
                  <button className="danger" onClick={() => remove(c.id)} title="Solo si no tiene facturas">
                    Borrar
                  </button>
                )}
              </td>
            </tr>
          ))}
          {visible.length === 0 && <EmptyRow colSpan={8} />}
        </tbody>
      </table>

      {open && (
        <Modal
          title={editingId ? 'Editar clienta' : 'Nueva clienta'}
          onClose={() => setOpen(false)}
          onSubmit={save}
          error={error}
        >
          <div className="form-grid">
            <Field label="Nombre*">
              <input value={form.name} onChange={set('name')} placeholder="Nombre y apellidos" />
            </Field>
            <Field label="Teléfono">
              <input value={form.phone} onChange={set('phone')} placeholder="600 000 000" />
            </Field>
            <Field label="Email">
              <input value={form.email} onChange={set('email')} placeholder="email@ejemplo.com" />
            </Field>
            <Field label="Servicio">
              <select value={form.service} onChange={set('service')}>
                <option value="">—</option>
                {SERVICES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Modalidad">
              <select value={form.mode} onChange={set('mode')}>
                <option value="">—</option>
                {MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Fecha probable de parto">
              <input type="date" value={form.dueDate} onChange={set('dueDate')} />
            </Field>
            <Field label="Estado">
              <select value={form.status} onChange={set('status')}>
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>
          {!editingId ? (
            <div className="fiscal consent consent-sign">
              <strong>Consentimiento (RGPD)</strong>
              <p className="muted small">
                Aquí guardas datos de salud, así que antes necesitas su permiso. Se abre el documento para que ella
                lo lea y lo firme, y la firma se guarda con la ficha.
              </p>
              {pendingSignature ? (
                <p>
                  <span className="saved-note">Firmado. Se guardará al crear la ficha.</span>{' '}
                  <button type="button" onClick={() => setSignOpen(true)}>Volver a firmar</button>
                </p>
              ) : (
                <button type="button" className="primary" onClick={() => setSignOpen(true)}>
                  Leer y firmar el consentimiento
                </button>
              )}
            </div>
          ) : (
          <details className="fiscal consent" open={!form.consentAt || consentOpen}>
            <summary>Consentimiento (RGPD)</summary>
            <p className="muted small">
              Aquí guardas datos de salud, así que antes necesitas su permiso y poder demostrar cuándo y
              cómo te lo dio. El texto que acepta está en Ajustes · Privacidad.
            </p>
            {!form.consentAt && (
              <p>
                <button type="button" className="primary" onClick={() => setSignOpen(true)}>
                  Leer y firmar el consentimiento
                </button>
              </p>
            )}
            <div className="form-grid">
              <Field label="Fecha del consentimiento">
                <input type="date" value={form.consentAt} onChange={set('consentAt')} />
              </Field>
              <Field label="Cómo lo dio">
                <select value={form.consentChannel} onChange={set('consentChannel')}>
                  <option value="">—</option>
                  {options(config.catalogs.consentChannel, form.consentChannel).map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </Field>
            </div>
            <ConsentTools
              clientId={editingId}
              consentAt={form.consentAt}
              consentChannel={form.consentChannel}
              consentVersion={form.consentVersion}
              channels={options(config.catalogs.consentChannel, '')}
              currentVersion={config.privacy.consentVersion}
              onChange={(fields) => {
                setForm((f) => ({ ...f, ...fields }));
                setConsentOpen(true);
                load();
              }}
            />
          </details>
          )}

          <details className="fiscal" open={FISCAL.some((f) => form[f] && form[f] !== 'España')}>
            <summary>Datos fiscales (para poder facturarle)</summary>
            <div className="form-grid">
              <Field label="NIF / DNI">
                <input value={form.taxId} onChange={set('taxId')} placeholder="12345678Z" />
              </Field>
              <Field label="Dirección">
                <input value={form.address} onChange={set('address')} />
              </Field>
              <Field label="Código postal">
                <input value={form.postalCode} onChange={set('postalCode')} />
              </Field>
              <Field label="Población">
                <input value={form.city} onChange={set('city')} />
              </Field>
              <Field label="Provincia">
                <input value={form.province} onChange={set('province')} />
              </Field>
              <Field label="País">
                <input value={form.country} onChange={set('country')} />
              </Field>
            </div>
          </details>

          <Field label="Notas">
            <textarea rows={3} value={form.notes} onChange={set('notes')} placeholder="Semana de embarazo, preferencias, seguimiento…" />
          </Field>
        </Modal>
      )}

      {signOpen && (
        <ConsentSignModal
          clientName={form.name}
          consentText={config.privacy.consentText}
          consentVersion={config.privacy.consentVersion}
          onClose={() => setSignOpen(false)}
          onSigned={onSigned}
        />
      )}

      {recordId !== null && (
        <ClientRecord
          refreshKey={recordKey}
          clientId={recordId}
          formState={(() => {
            const c = rows.find((r) => r.id === recordId);
            const q = c && questionnaire(c);
            return q ? { kind: q.kind, status: q.row ? q.row.status : null } : undefined;
          })()}
          onClose={() => setRecordId(null)}
          onChanged={load}
          onQuestionnaire={(client, kind) => {
            const done = formStatus[client.id]?.find((f) => f.kind === kind)?.status === 'completo';
            setFormFor({ client, kind, startLocked: done });
          }}
          onSign={setSignClient}
        />
      )}

      {signClient && (
        <ConsentSignModal
          clientName={signClient.name}
          consentText={config.privacy.consentText}
          consentVersion={config.privacy.consentVersion}
          onClose={() => setSignClient(null)}
          onSigned={async (signature) => {
            await api.consent(signClient.id, { action: 'grant', signature });
            setSignClient(null);
            await load();
            setRecordKey((k) => k + 1); // la ficha abierta recoge el consentimiento nuevo
          }}
        />
      )}

      {formFor && (
        <QuestionnaireModal
          client={formFor.client}
          kind={formFor.kind}
          startLocked={formFor.startLocked}
          cancelLabel={formFor.fromCreate ? 'Lo relleno más tarde' : 'Cancelar'}
          onClose={() => setFormFor(null)}
          onSaved={() => {
            load();
            setRecordKey((k) => k + 1);
          }}
        />
      )}
    </section>
  );
}
