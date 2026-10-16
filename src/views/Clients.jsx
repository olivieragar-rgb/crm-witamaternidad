import { useEffect, useState } from 'react';
import { api, fmtDate, gestWeeks } from '../api.js';
import { searchItems } from '../search.js';
import { Toolbar, Badge, Modal, Field, EmptyRow } from '../components/ui.jsx';
import QuestionnaireModal from '../components/QuestionnaireModal.jsx';
import { kindForService } from '../data/questionnaires.js';
import { useConfig, options } from '../config.jsx';

const EMPTY = {
  name: '', email: '', phone: '', service: '', mode: '', dueDate: '',
  status: 'Nuevo contacto', notes: '',
  taxId: '', address: '', postalCode: '', city: '', province: '', country: 'España',
  consentAt: '', consentChannel: '', consentVersion: '',
};
const FISCAL = ['taxId', 'address', 'postalCode', 'city', 'province', 'country'];

const text = (c) => `${c.name} ${c.email} ${c.phone} ${c.service} ${c.mode} ${c.status} ${c.notes} ${c.taxId}`;

export default function Clients({ initialFilter }) {
  const config = useConfig();
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState(initialFilter?.q || '');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
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

  const visible = searchItems(rows, query, text);
  const set = (f) => (e) => setForm({ ...form, [f]: e.target.value });

  // Los desplegables salen de los catalogos, no de constantes del codigo.
  const SERVICES = options(config.catalogs.clientService, form.service);
  const MODES = options(config.catalogs.mode, form.mode);
  const STATUSES = options(config.catalogs.clientStatus, form.status);

  function newRow() {
    setForm({ ...EMPTY, status: options(config.catalogs.clientStatus)[0] ?? '' });
    setEditingId(null);
    setError('');
    setOpen(true);
  }
  function edit(c) {
    // Las claves que falten (fichas antiguas) caen a los valores por defecto.
    setForm({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, c[k] ?? EMPTY[k]])) });
    setEditingId(c.id);
    setError('');
    setOpen(true);
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

  // Derecho de supresión. Se ejerce cuando la clienta lo pide, no solo cuando
  // vence el plazo de conservación, así que tiene que estar aquí y no solo en
  // la vista de Privacidad.
  async function anonymize(c) {
    if (
      !confirm(
        `Anonimizar la ficha de ${c.name}.\n\n` +
          'Se borran nombre, contacto, FPP y notas, y también las notas de sus citas.\n' +
          'Sus facturas se conservan intactas: la ley obliga a guardarlas.\n\n' +
          'Esto no se puede deshacer. ¿Seguir?',
      )
    ) {
      return;
    }
    const reason = prompt('Motivo (queda en el registro):', 'La clienta ejerce su derecho de supresión');
    if (reason === null) return;
    try {
      await api.anonymize(c.id, { reason });
      load();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <section>
      <Toolbar title="Clientas" query={query} setQuery={setQuery} onNew={newRow} newLabel="Nueva clienta" />

      <table className="grid-table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Servicio</th>
            <th>Modalidad</th>
            <th>FPP</th>
            <th>Estado</th>
            <th>Cuestionario</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((c) => (
            <tr key={c.id} className={c.anonymizedAt ? 'inactive-row' : ''}>
              <td>
                <strong>{c.name}</strong>
                <div className="muted">
                  {c.anonymizedAt ? `Anonimizada el ${fmtDate(c.anonymizedAt)}` : c.email || c.phone}
                </div>
              </td>
              <td>{c.service}</td>
              <td className="muted">{c.mode}</td>
              <td className="muted">
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
              </td>
              <td>
                <Badge value={c.status} />
              </td>
              <td>
                {(() => {
                  if (c.anonymizedAt) return <span className="muted">—</span>;
                  const saved = formStatus[c.id] || [];
                  // El del servicio; si el servicio no pide ninguno pero hay
                  // uno guardado (le cambiaron el servicio despues), ese.
                  const kind = kindForService(c.service) || saved[0]?.kind;
                  if (!kind) return <span className="muted">—</span>;
                  const row = saved.find((f) => f.kind === kind);
                  return (
                    <button onClick={() => setFormFor({ client: c, kind })}>
                      {row ? (
                        <Badge value={row.status === 'completo' ? 'Completo' : 'Pendiente'} />
                      ) : (
                        'Rellenar'
                      )}
                    </button>
                  );
                })()}
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
                  <>
                    {/* Anonimizar es el derecho de supresión: conserva las
                        facturas. Borrar solo funciona si no tiene ninguna, y
                        es para una ficha creada por error. */}
                    <button className="danger" onClick={() => anonymize(c)} title="Borrar sus datos personales conservando las facturas (derecho de supresión)">
                      Anonimizar
                    </button>
                    <button className="danger" onClick={() => remove(c.id)} title="Solo si no tiene facturas">
                      Borrar
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {visible.length === 0 && <EmptyRow colSpan={7} />}
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
          <details className="fiscal consent" open={!form.consentAt}>
            <summary>Consentimiento (RGPD)</summary>
            <p className="muted small">
              Aquí hay datos de salud. Antes de guardarlos hace falta que la clienta lo haya autorizado, y
              hay que poder demostrar cuándo y cómo. El texto que se acepta está en Ajustes · Privacidad.
            </p>
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
          </details>

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

      {formFor && (
        <QuestionnaireModal
          client={formFor.client}
          kind={formFor.kind}
          cancelLabel={formFor.fromCreate ? 'Lo relleno más tarde' : 'Cancelar'}
          onClose={() => setFormFor(null)}
          onSaved={load}
        />
      )}
    </section>
  );
}
