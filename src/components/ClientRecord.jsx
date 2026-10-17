import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, fmtDate, gestWeeks } from '../api.js';
import { Badge, Field } from './ui.jsx';
import GrowthChart from './GrowthChart.jsx';
import { useConfig, options } from '../config.jsx';
import { RECORD_SECTIONS, sectionFilled } from '../data/record-sections.js';
import { percentileForWeight, readPercentile, daysBetween, formatAge, MAX_DAY } from '../lib/growth.js';

const SEXES = [
  { value: '', label: '—' },
  { value: 'girl', label: 'Niña' },
  { value: 'boy', label: 'Niño' },
];
const DATA_FIELDS = [
  'name', 'phone', 'email', 'service', 'mode', 'dueDate', 'status', 'notes',
  'taxId', 'address', 'postalCode', 'city', 'province', 'country', 'babySex', 'babyBirthDate',
];
const pick = (c) => Object.fromEntries(DATA_FIELDS.map((k) => [k, c[k] ?? '']));
const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const kg = (n) => String(n).replace('.', ',');

/** Percentil de un peso en una fecha, o null si faltan el sexo o el nacimiento del bebé. */
function percentileAt(client, date, weight) {
  if (!(weight > 0) || !client.babySex || !client.babyBirthDate || !date) return null;
  const day = daysBetween(client.babyBirthDate, date);
  if (day === null || day < 0 || day > MAX_DAY) return null;
  const p = percentileForWeight(client.babySex, day, weight);
  return p ? { day, percentile: p.percentile, ...readPercentile(p.percentile) } : null;
}

/**
 * La ficha de una clienta: todos sus datos, el historial de visitas con el peso
 * del bebé y su percentil, y las notas.
 *
 * Está bloqueada al abrirse (el candado) para que no se cambie ni se borre nada
 * por error. Con el candado cerrado solo se pueden añadir notas nuevas; para
 * editar datos, visitas o notas hay que abrirlo. Al cerrar la ficha vuelve a
 * bloquearse sola, porque el estado vive solo mientras está abierta.
 *
 * @param {{
 *   clientId: number,
 *   refreshKey: number, // al cambiar, la ficha vuelve a leer sus datos sin cerrarse ni bloquearse
 *   formState: { kind: string, status: 'completo'|'pendiente'|null }|undefined, // cuestionario que le toca; undefined si el servicio no pide ninguno
 *   onClose: () => void,
 *   onChanged: () => void,
 *   onQuestionnaire: (client: object, kind: string) => void,
 *   onSign: (client: object) => void,
 * }} props
 */
export default function ClientRecord({ clientId, formState, refreshKey = 0, onClose, onChanged, onQuestionnaire, onSign }) {
  const config = useConfig();
  const [client, setClient] = useState(null);
  const [draft, setDraft] = useState(null);
  const [locked, setLocked] = useState(true);
  const [visits, setVisits] = useState([]);
  const [services, setServices] = useState([]);
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const loadClient = useCallback(async () => {
    const c = await api.get('clients', clientId);
    setClient(c);
    setDraft(pick(c));
    return c;
  }, [clientId]);
  const loadVisits = useCallback(
    () => api.list('appointments').then((all) => setVisits(all.filter((a) => a.clientId === clientId))),
    [clientId],
  );
  const loadNotes = useCallback(() => api.clientNotes(clientId).then(setNotes), [clientId]);

  useEffect(() => {
    Promise.all([loadClient(), loadVisits(), loadNotes(), api.list('services').then(setServices)]).catch((e) =>
      setError(e.message),
    );
  }, [loadClient, loadVisits, loadNotes, refreshKey]);

  const dirty = client && draft && DATA_FIELDS.some((k) => (draft[k] ?? '') !== (client[k] ?? ''));

  const close = useCallback(() => {
    if ((dirty || dirtySections.current.size > 0) && !confirm('Tienes cambios sin guardar en la ficha. ¿Salir sin guardarlos?')) return;
    onClose();
  }, [dirty, onClose]);

  // Secciones con cambios sin guardar: se avisa antes de cerrar la ventana.
  const dirtySections = useRef(new Set());
  const markDirty = useCallback((id, isDirty) => {
    if (isDirty) dirtySections.current.add(id);
    else dirtySections.current.delete(id);
  }, []);
  const [sections, setSections] = useState({});
  const loadSections = useCallback(() => api.clientSections(clientId).then(setSections), [clientId]);
  useEffect(() => {
    loadSections().catch((e) => setError(e.message));
  }, [loadSections, refreshKey]);
  useEffect(() => {
    const warn = (e) => {
      if (dirtySections.current.size > 0 || dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const flash = (msg) => {
    setSaved(msg);
    setTimeout(() => setSaved(''), 2500);
  };
  const guard = async (fn) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    }
  };

  const set = (f) => (e) => setDraft((d) => ({ ...d, [f]: e.target.value }));

  const saveData = () =>
    guard(async () => {
      if (!draft.name.trim()) throw new Error('El nombre no puede quedar vacío');
      const c = await api.update('clients', clientId, draft);
      setClient(c);
      setDraft(pick(c));
      onChanged();
      flash('Datos guardados.');
    });

  // ---- visitas ----
  const [newVisit, setNewVisit] = useState(null); // { date, serviceId, weight, notes }
  const doneStatus = useMemo(() => {
    const all = options(config.catalogs.appointmentStatus);
    return all.find((s) => /realizada/i.test(s)) ?? all[0] ?? '';
  }, [config]);

  const addVisit = () =>
    guard(async () => {
      if (!newVisit.date) throw new Error('Pon la fecha de la visita');
      await api.create('appointments', {
        clientId,
        serviceId: newVisit.serviceId,
        date: newVisit.date.replace('T', ' '),
        status: doneStatus,
        mode: '',
        notes: newVisit.notes,
        babyWeightKg: newVisit.weight === '' ? 0 : Number(String(newVisit.weight).replace(',', '.')) || 0,
      });
      setNewVisit(null);
      await loadVisits();
      flash('Visita añadida.');
    });

  const saveWeight = (visit, value) =>
    guard(async () => {
      const w = value === '' ? 0 : Number(String(value).replace(',', '.'));
      if (!Number.isFinite(w) || w < 0 || w > 30) throw new Error('Ese peso no es válido (en kilos, por ejemplo 3,45)');
      if (w === (Number(visit.babyWeightKg) || 0)) return;
      await api.update('appointments', visit.id, { babyWeightKg: w });
      await loadVisits();
      flash('Peso guardado.');
    });

  const saveVisitNotes = (visit, value) =>
    guard(async () => {
      if (value.trim() === (visit.notes || '').trim()) return;
      await api.update('appointments', visit.id, { notes: value.trim() });
      await loadVisits();
      flash('Anotación guardada.');
    });

  const removeVisit = (visit) =>
    guard(async () => {
      if (!confirm(`¿Borrar la visita del ${fmtDate(visit.date)}?`)) return;
      await api.remove('appointments', visit.id);
      await loadVisits();
    });

  // ---- notas ----
  const [noteText, setNoteText] = useState('');
  const [editing, setEditing] = useState(null); // { id, text }
  const addNote = () =>
    guard(async () => {
      if (!noteText.trim()) return;
      await api.addClientNote(clientId, noteText);
      setNoteText('');
      await loadNotes();
    });
  const saveNote = () =>
    guard(async () => {
      await api.editClientNote(clientId, editing.id, editing.text);
      setEditing(null);
      await loadNotes();
    });
  const removeNote = (n) =>
    guard(async () => {
      if (!confirm('¿Borrar esta nota? No se puede deshacer.')) return;
      await api.removeClientNote(clientId, n.id);
      await loadNotes();
    });

  if (!client || !draft) {
    return (
      <div className="record-page">
        <div className="record-main">{error ? <p className="error">{error}</p> : <p className="muted">Cargando…</p>}</div>
      </div>
    );
  }

  const chronological = [...visits].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const readings = chronological
    .map((v) => ({ v, p: percentileAt(client, v.date, Number(v.babyWeightKg)) }))
    .filter((r) => r.p);
  // Visita a visita: cuánto ha cambiado el peso y el percentil respecto a la
  // última vez que se pesó (el seguimiento).
  let prev = null;
  const followup = chronological.map((v) => {
    const w = Number(v.babyWeightKg) || 0;
    const p = percentileAt(client, v.date, w);
    const row = { v, w, p, dW: null, dDays: null, dP: null };
    if (w > 0) {
      if (prev) {
        row.dW = Math.round((w - prev.w) * 1000);
        row.dDays = daysBetween(prev.v.date, v.date);
        if (p && prev.p) row.dP = Math.round(p.percentile) - Math.round(prev.p.percentile);
      }
      prev = row;
    }
    return row;
  });
  const trend = followup.filter((r) => r.p).map((r) => ({ id: r.v.id, p: r.p }));
  const points = readings.map((r) => ({ day: r.p.day, weight: Number(r.v.babyWeightKg) }));
  const lastReading = readings[readings.length - 1];
  const g = gestWeeks(client.dueDate);
  const signed = !!client.consentAt;

  const SERVICES = options(config.catalogs.clientService, draft.service);
  const MODES = options(config.catalogs.mode, draft.mode);
  const STATUSES = options(config.catalogs.clientStatus, draft.status);
  const ro = locked; // los campos se ven pero no se tocan

  return (
    <div className="record-page">
      <header className="record-bar">
        <div>
          <h1>{client.name}</h1>
          <div className="record-sub">
            <Badge value={client.status} />
            {client.service && <span className="muted">{client.service}</span>}
            {g && !g.past && <span className="muted">· {g.label} sem</span>}
          </div>
        </div>
        <div className="record-head-actions">
          {saved && <span className="saved-note">{saved}</span>}
          <button
            type="button"
            className={'lock-btn' + (locked ? '' : ' is-open')}
            onClick={() => setLocked((l) => !l)}
            aria-pressed={!locked}
            title={locked ? 'Ficha bloqueada. Pulsa para poder editarla' : 'Ficha desbloqueada. Pulsa para bloquearla'}
          >
            <span aria-hidden="true">{locked ? '🔒' : '🔓'}</span> {locked ? 'Bloqueada: pulsa para editar' : 'Editando'}
          </button>
          <button type="button" onClick={close}>
            Cerrar ficha
          </button>
        </div>
      </header>

      <div className="record-layout">
        <nav className="record-nav" aria-label="Secciones de la ficha">
          {[
            ['sec-datos', 'Datos', true],
            ['sec-seguimiento', 'Seguimiento', visits.length > 0],
            ...RECORD_SECTIONS.map((sec) => [`sec-${sec.id}`, sec.label, sectionFilled(sections[sec.id]?.data)]),
            ['sec-notas', 'Notas', notes.length > 0],
          ].map(([id, label, filled]) => (
            <a key={id} href={`#${id}`} className={filled ? 'is-filled' : ''}>
              <span className="nav-dot" aria-hidden="true">{filled ? '●' : '○'}</span> {label}
            </a>
          ))}
        </nav>

        <div className="record-main">
          {/* Estado de un vistazo: lo hecho en verde, lo que falta, visible. */}
          <div className="status-chips">
            {formState && (
              <button
                type="button"
                className={'status-chip ' + (formState.status === 'completo' ? 'is-done' : 'is-todo')}
                onClick={() => onQuestionnaire(client, formState.kind)}
                title="Cuestionario de alta"
              >
                {formState.status === 'completo'
                  ? '✓ Cuestionario completo'
                  : formState.status
                    ? 'Cuestionario pendiente'
                    : 'Cuestionario sin rellenar'}
              </button>
            )}
            <button
              type="button"
              className={'status-chip ' + (signed ? 'is-done' : 'is-todo')}
              onClick={() => {
                if (!signed) return onSign(client);
                // Ya firmado: volver a firmar sustituye la firma, así que pide desbloquear.
                if (locked) return flash('Ya está firmado. Desbloquea la ficha si necesitas volver a firmar.');
                if (confirm('Esto sustituirá la firma actual por una nueva. ¿Seguimos?')) onSign(client);
              }}
              title={signed ? `Consentimiento dado el ${fmtDate(client.consentAt)}` : 'Leer y firmar el consentimiento'}
            >
              {signed ? '✓ RGPD firmado' : 'RGPD sin firmar'}
            </button>
            {client.email && <a className="status-chip" href={`mailto:${client.email}`}>{client.email}</a>}
            {client.phone && <a className="status-chip" href={`tel:${client.phone.replace(/\s/g, '')}`}>{client.phone}</a>}
          </div>

          {error && <p className="error">{error}</p>}
          {locked && (
            <p className="locked-note">
              La ficha está bloqueada para que no se cambie nada por error. Puedes añadir notas; para rellenar o
              editar datos y secciones, pulsa el candado de arriba.
            </p>
          )}

          {/* ---- datos ---- */}
          <section className="record-section" id="sec-datos">
            <h3>Datos</h3>
            <div className="form-grid">
              <Field label="Nombre">
                <input value={draft.name} onChange={set('name')} readOnly={ro} />
              </Field>
              <Field label="Teléfono">
                <input value={draft.phone} onChange={set('phone')} readOnly={ro} />
              </Field>
              <Field label="Email">
                <input value={draft.email} onChange={set('email')} readOnly={ro} />
              </Field>
              <Field label="Servicio">
                <select value={draft.service} onChange={set('service')} disabled={ro}>
                  <option value="">—</option>
                  {SERVICES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Modalidad">
                <select value={draft.mode} onChange={set('mode')} disabled={ro}>
                  <option value="">—</option>
                  {MODES.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </Field>
              <Field label="Fecha probable de parto">
                <input type="date" value={draft.dueDate} onChange={set('dueDate')} readOnly={ro} />
              </Field>
              <Field label="Estado">
                <select value={draft.status} onChange={set('status')} disabled={ro}>
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="NIF / DNI">
                <input value={draft.taxId} onChange={set('taxId')} readOnly={ro} />
              </Field>
              <Field label="Dirección">
                <input value={draft.address} onChange={set('address')} readOnly={ro} />
              </Field>
              <Field label="Código postal">
                <input value={draft.postalCode} onChange={set('postalCode')} readOnly={ro} />
              </Field>
              <Field label="Población">
                <input value={draft.city} onChange={set('city')} readOnly={ro} />
              </Field>
              <Field label="Provincia">
                <input value={draft.province} onChange={set('province')} readOnly={ro} />
              </Field>
            </div>
            <Field label="Notas generales">
              <textarea rows={2} value={draft.notes} onChange={set('notes')} readOnly={ro} />
            </Field>
            {!ro && (
              <div className="record-actions">
                <button type="button" className="primary" onClick={saveData} disabled={!dirty}>
                  Guardar cambios
                </button>
                {dirty && (
                  <button type="button" onClick={() => setDraft(pick(client))}>
                    Descartar
                  </button>
                )}
              </div>
            )}
          </section>

          {/* ---- bebé y visitas ---- */}
          <section className="record-section" id="sec-percentil">
            <h3>Bebé y percentil de peso</h3>
            <div className="form-grid">
              <Field label="Sexo del bebé" help="La OMS publica tablas distintas para niñas y niños, así que el percentil cambia según el sexo.">
                <select value={draft.babySex} onChange={set('babySex')} disabled={ro}>
                  {SEXES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Fecha de nacimiento">
                <input type="date" value={draft.babyBirthDate} onChange={set('babyBirthDate')} readOnly={ro} />
              </Field>
            </div>
            {!ro && dirty && <p className="muted small">Guarda los cambios de arriba para que se calculen los percentiles.</p>}
            {!client.babySex || !client.babyBirthDate ? (
              <p className="muted small">
                Para calcular el percentil hacen falta el sexo y la fecha de nacimiento del bebé
                {ro ? ' (desbloquea la ficha para ponerlos)' : ''}.
              </p>
            ) : lastReading ? (
              <p className={`percentile-line tone-${lastReading.p.tone}`}>
                Última medida: <strong>{kg(lastReading.v.babyWeightKg)} kg</strong> el {fmtDate(lastReading.v.date)} ·{' '}
                <strong>percentil {Math.round(lastReading.p.percentile)}</strong> · {lastReading.p.label}
              </p>
            ) : (
              <p className="muted small">Anota el peso en una visita y saldrá aquí su percentil.</p>
            )}
            {points.length > 0 && <GrowthChart sex={client.babySex} points={points} />}
            <p className="muted small">Es una ayuda visual para la consulta, no un diagnóstico.</p>
          </section>

          <section className="record-section" id="sec-seguimiento">
            <div className="record-section-head">
              <h3>Seguimiento: visitas, peso y percentil</h3>
              {!ro && !newVisit && (
                <button type="button" onClick={() => setNewVisit({ date: nowLocal(), serviceId: '', weight: '', notes: '' })}>
                  + Añadir visita
                </button>
              )}
            </div>

            {newVisit && !ro && (
              <div className="new-visit">
                <div className="form-grid">
                  <Field label="Fecha y hora">
                    <input type="datetime-local" value={newVisit.date} onChange={(e) => setNewVisit({ ...newVisit, date: e.target.value })} />
                  </Field>
                  <Field label="Servicio">
                    <select value={newVisit.serviceId} onChange={(e) => setNewVisit({ ...newVisit, serviceId: e.target.value })}>
                      <option value="">—</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Peso del bebé (kg)">
                    <input
                      inputMode="decimal"
                      placeholder="3,45"
                      value={newVisit.weight}
                      onChange={(e) => setNewVisit({ ...newVisit, weight: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="Notas de la visita">
                  <textarea rows={2} value={newVisit.notes} onChange={(e) => setNewVisit({ ...newVisit, notes: e.target.value })} />
                </Field>
                <div className="record-actions">
                  <button type="button" className="primary" onClick={addVisit}>
                    Guardar visita
                  </button>
                  <button type="button" onClick={() => setNewVisit(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {visits.length === 0 ? (
              <p className="muted">Todavía no hay visitas. Aparecerán aquí las citas de esta clienta.</p>
            ) : (
              <>
                {trend.length > 1 && (
                  <p className="trend-line">
                    <span className="muted small">Evolución del percentil:</span>{' '}
                    {trend.map((t, i) => (
                      <span key={t.id}>
                        {i > 0 && ' → '}
                        <span className={`pct-badge tone-${t.p.tone}`}>P{Math.round(t.p.percentile)}</span>
                      </span>
                    ))}
                  </p>
                )}
                <table className="grid-table compact followup-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Peso bebé</th>
                      <th>Cambio</th>
                      <th>Percentil</th>
                      <th>Anotaciones de la sesión</th>
                      {!ro && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {[...followup].reverse().map(({ v, w, p, dW, dDays, dP }) => (
                      <tr key={v.id}>
                        <td>
                          <strong>{fmtDate(v.date)}</strong>
                          <div className="muted small">
                            {v.serviceName || v.status}
                            {p ? ` · ${formatAge(p.day)}` : ''}
                          </div>
                        </td>
                        <td>
                          {ro ? (
                            w > 0 ? `${kg(w)} kg` : <span className="muted">—</span>
                          ) : (
                            <input
                              className="weight-input"
                              inputMode="decimal"
                              defaultValue={w > 0 ? kg(w) : ''}
                              placeholder="kg"
                              onBlur={(e) => saveWeight(v, e.target.value)}
                              aria-label={`Peso del ${fmtDate(v.date)}`}
                            />
                          )}
                        </td>
                        <td className="muted">
                          {dW === null ? (
                            '—'
                          ) : (
                            <>
                              <strong className={dW < 0 ? 'delta-down' : 'delta-up'}>
                                {dW > 0 ? '+' : ''}
                                {dW} g
                              </strong>
                              <div className="small">en {dDays} {dDays === 1 ? 'día' : 'días'}</div>
                            </>
                          )}
                        </td>
                        <td>
                          {p ? (
                            <>
                              <span className={`pct-badge tone-${p.tone}`} title={p.label}>
                                P{Math.round(p.percentile)}
                              </span>
                              {dP !== null && dP !== 0 && (
                                <span className={'small ' + (dP < 0 ? 'delta-down' : 'delta-up')}>
                                  {' '}
                                  {dP > 0 ? '▲' : '▼'} {Math.abs(dP)}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="session-notes">
                          {ro ? (
                            v.notes ? <p className="note-text">{v.notes}</p> : <span className="muted">—</span>
                          ) : (
                            <textarea
                              rows={2}
                              defaultValue={v.notes}
                              placeholder="Qué se trabajó en la sesión…"
                              onBlur={(e) => saveVisitNotes(v, e.target.value)}
                              aria-label={`Anotaciones del ${fmtDate(v.date)}`}
                            />
                          )}
                        </td>
                        {!ro && (
                          <td className="row-actions">
                            <button type="button" className="danger" onClick={() => removeVisit(v)}>
                              Borrar
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>

          {RECORD_SECTIONS.map((def) => (
            <SectionCard
              key={def.id}
              def={def}
              saved={sections[def.id]}
              locked={ro}
              onDirty={markDirty}
              onSave={async (id, data) => {
                const r = await api.saveClientSection(clientId, id, data);
                setSections((all) => ({ ...all, [id]: r }));
                flash('Sección guardada.');
              }}
            />
          ))}

          {/* ---- notas ---- */}
          <section className="record-section" id="sec-notas">
            <h3>Notas</h3>
            <div className="note-add">
              <textarea
                rows={2}
                placeholder="Escribe una nota sobre esta clienta…"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && addNote()}
              />
              <button type="button" className="primary" onClick={addNote} disabled={!noteText.trim()}>
                Añadir nota
              </button>
            </div>
            {notes.length === 0 ? (
              <p className="muted">Sin notas todavía.</p>
            ) : (
              <ul className="note-list">
                {notes.map((n) => (
                  <li key={n.id}>
                    <div className="note-meta muted small">
                      {fmtDate(n.createdAt)}
                      {n.author ? ` · ${n.author}` : ''}
                      {n.updatedAt ? ' · editada' : ''}
                    </div>
                    {editing?.id === n.id ? (
                      <>
                        <textarea rows={3} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
                        <div className="record-actions">
                          <button type="button" className="primary" onClick={saveNote}>
                            Guardar
                          </button>
                          <button type="button" onClick={() => setEditing(null)}>
                            Cancelar
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="note-text">{n.text}</p>
                        {!ro && (
                          <div className="record-actions">
                            <button type="button" onClick={() => setEditing({ id: n.id, text: n.text })}>
                              Editar
                            </button>
                            <button type="button" className="danger" onClick={() => removeNote(n)}>
                              Borrar
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * Una sección de la ficha: sus campos, su propio "Guardar" y cuándo se tocó
 * por última vez. Se puede rellenar hoy una y dentro de un mes otra.
 */
function SectionCard({ def, saved, locked, onSave, onDirty }) {
  const initial = saved?.data ?? {};
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Si llega una versión guardada nueva, el borrador la sigue.
  const savedKey = JSON.stringify(initial);
  const isDirty = def.fields.some((f) => (draft[f.id] ?? '') !== (initial[f.id] ?? ''));
  useEffect(() => {
    setDraft(JSON.parse(savedKey));
  }, [savedKey]);
  useEffect(() => {
    onDirty(def.id, isDirty);
    return () => onDirty(def.id, false);
  }, [isDirty, def.id, onDirty]);

  async function save() {
    setErr('');
    setBusy(true);
    try {
      await onSave(def.id, draft);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const filled = sectionFilled(initial);
  return (
    <section className="record-section record-card" id={`sec-${def.id}`}>
      <div className="record-section-head">
        <h3>
          {def.label}
          {filled && <span className="pct-badge section-done">Rellenada</span>}
        </h3>
        {saved?.updatedAt && (
          <span className="muted small">
            Última edición {fmtDate(saved.updatedAt)}
            {saved.updatedBy ? ` · ${saved.updatedBy}` : ''}
          </span>
        )}
      </div>
      <p className="muted small">{def.hint}</p>
      <div className="section-fields">
        {def.fields.map((f) => (
          <label key={f.id} className={'field' + (f.type === 'text' ? '' : ' wide')}>
            <span>{f.label}</span>
            {f.type === 'text' ? (
              <input
                value={draft[f.id] ?? ''}
                placeholder={f.placeholder}
                readOnly={locked}
                onChange={(e) => setDraft({ ...draft, [f.id]: e.target.value })}
              />
            ) : (
              <textarea
                rows={locked ? 2 : 4}
                value={draft[f.id] ?? ''}
                placeholder={locked && !draft[f.id] ? 'Sin rellenar' : f.placeholder}
                readOnly={locked}
                onChange={(e) => setDraft({ ...draft, [f.id]: e.target.value })}
              />
            )}
          </label>
        ))}
      </div>
      {err && <p className="error">{err}</p>}
      {!locked && (
        <div className="record-actions">
          <button type="button" className="primary" onClick={save} disabled={!isDirty || busy}>
            {busy ? 'Guardando…' : isDirty ? 'Guardar sección' : 'Guardada'}
          </button>
          {isDirty && (
            <button type="button" onClick={() => setDraft(initial)}>
              Descartar
            </button>
          )}
        </div>
      )}
    </section>
  );
}
