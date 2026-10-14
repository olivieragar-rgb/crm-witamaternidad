import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Modal, Field } from '../components/ui.jsx';

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/** Suma días a 'YYYY-MM-DD' en UTC, igual que en el servidor. */
const addDaysIso = (iso, days) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const ymd = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export default function Calendar() {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [notes, setNotes] = useState([]);
  const [appts, setAppts] = useState([]);
  const [oncall, setOncall] = useState({ config: null, windows: [] });
  const [selected, setSelected] = useState(null); // 'YYYY-MM-DD'
  const [draft, setDraft] = useState('');

  const load = () => {
    api.list('notes').then(setNotes);
    api.list('appointments').then(setAppts);
    api.oncall().then(setOncall);
  };
  useEffect(() => {
    load();
  }, []);

  // Group notes and appointments by day.
  const byDay = useMemo(() => {
    const map = {};
    const push = (key, type, item) => {
      (map[key] = map[key] || { notes: [], appts: [] })[type].push(item);
    };
    for (const n of notes) push(n.date, 'notes', n);
    for (const a of appts) {
      const key = (a.date || '').slice(0, 10);
      if (key) push(key, 'appts', a);
    }
    return map;
  }, [notes, appts]);

  // Qué guardias cubren cada día. Un día con dos o más es un solapamiento:
  // dos partos que pueden caer a la vez.
  const guardByDay = useMemo(() => {
    const map = {};
    for (const w of oncall.windows) {
      for (let d = w.start; d <= w.end; d = addDaysIso(d, 1)) {
        (map[d] = map[d] || []).push(w);
      }
    }
    return map;
  }, [oncall]);

  // Build the weeks grid (Monday first).
  const weeks = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const startOffset = (first.getDay() + 6) % 7; // 0 = Monday
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(cursor.year, cursor.month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    const out = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [cursor]);

  const prev = () => setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { ...c, month: c.month - 1 }));
  const next = () => setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { ...c, month: c.month + 1 }));
  const today = ymd(new Date());

  // Una pareja solapada se nombra una sola vez: si A choca con B, no hace
  // falta repetir que B choca con A.
  const clashes = oncall.windows.filter(
    (w) => w.overlapsWith.length > 0 && w.overlapsWith.every((o) => o.id > w.id),
  );

  const dayNotes = selected ? byDay[selected]?.notes || [] : [];
  const dayAppts = selected ? byDay[selected]?.appts || [] : [];

  async function addNote() {
    if (!draft.trim()) return;
    await api.create('notes', { date: selected, text: draft.trim() });
    setDraft('');
    const fresh = await api.list('notes');
    setNotes(fresh);
  }
  async function delNote(id) {
    await api.remove('notes', id);
    setNotes(await api.list('notes'));
  }

  return (
    <section>
      <div className="toolbar">
        <h1>Calendario</h1>
        <div className="toolbar-actions">
          <button onClick={prev}>‹</button>
          <strong className="cal-title">
            {MONTHS[cursor.month]} {cursor.year}
          </strong>
          <button onClick={next}>›</button>
        </div>
      </div>

      <div className="calendar">
        <div className="cal-head">
          {WEEKDAYS.map((w) => (
            <div key={w} className="cal-weekday">
              {w}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="cal-week">
            {week.map((day, di) => {
              if (!day) return <div key={di} className="cal-cell empty" />;
              const key = ymd(day);
              const info = byDay[key];
              const guards = guardByDay[key] || [];
              const clash = guards.length > 1;
              return (
                <button
                  key={di}
                  className={
                    'cal-cell' +
                    (key === today ? ' is-today' : '') +
                    (guards.length ? ' on-call' : '') +
                    (clash ? ' on-call-clash' : '')
                  }
                  onClick={() => {
                    setSelected(key);
                    setDraft('');
                  }}
                >
                  {guards.length > 0 && (
                    <span
                      className="guard-bar"
                      title={
                        (clash ? '⚠ Dos partos posibles a la vez: ' : 'Guardia: ') +
                        guards.map((g) => g.name).join(', ')
                      }
                    >
                      {guards.map((g) => (
                        <span key={g.id} className="guard-dot" />
                      ))}
                    </span>
                  )}
                  <span className="cal-num">{day.getDate()}</span>
                  <span className="cal-events">
                    {(info?.appts || []).slice(0, 3).map((a) => (
                      <span
                        key={'a' + a.id}
                        className={'event event-' + (a.status || '').toLowerCase()}
                        title={`${(a.date || '').slice(11, 16)} · ${a.clientName || 'Cita'}${a.serviceName ? ' · ' + a.serviceName : ''}`}
                      >
                        <span className="event-time">{(a.date || '').slice(11, 16)}</span>
                        {a.clientName || 'Cita'}
                      </span>
                    ))}
                    {info?.appts?.length > 3 && <span className="event-more">+{info.appts.length - 3} más</span>}
                    {info?.notes?.length > 0 && (
                      <span className="event event-note" title={info.notes.map((n) => n.text).join(' · ')}>
                        {info.notes.length === 1 ? '1 nota' : `${info.notes.length} notas`}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <p className="cal-legend">
        <span className="dot dot-appt" /> Citas &nbsp; <span className="dot dot-note" /> Notas &nbsp;
        <span className="dot dot-guard" /> Guardia &nbsp; <span className="dot dot-clash" /> Dos a la vez
        {oncall.config && (
          <span className="muted">
            {' '}· ventana de {oncall.config.weeksBefore} semanas antes y {oncall.config.weeksAfter} después
            de la FPP (se cambia en Ajustes)
          </span>
        )}
      </p>

      {clashes.length > 0 && (
        <p className="notice">
          <strong>Guardias que se solapan.</strong> Estas clientas pueden ponerse de parto a la vez, así que
          harían falta dos personas:{' '}
          {clashes.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ' · '}
              {c.name} y {c.overlapsWith.map((o) => o.name).join(', ')}
            </span>
          ))}
        </p>
      )}

      {selected && (
        <Modal
          title={`Día ${selected.split('-').reverse().join('/')}`}
          onClose={() => setSelected(null)}
          onSubmit={addNote}
          submitLabel="Añadir nota"
        >
          {(guardByDay[selected] || []).length > 0 && (
            <div className="day-appts">
              <strong>De guardia</strong>
              <ul className="mini-list">
                {(guardByDay[selected] || []).map((g) => (
                  <li key={g.id}>
                    <span>{g.name}</span>
                    <span className="muted">FPP {g.dueDate.split('-').reverse().join('/')}</span>
                  </li>
                ))}
              </ul>
              {(guardByDay[selected] || []).length > 1 && (
                <p className="error">Dos partos posibles este día.</p>
              )}
            </div>
          )}

          {dayAppts.length > 0 && (
            <div className="day-appts">
              <strong>Citas</strong>
              <ul className="mini-list">
                {dayAppts.map((a) => (
                  <li key={a.id}>
                    <span>
                      {a.clientName || '—'}
                      {a.serviceName ? ` · ${a.serviceName}` : ''}
                    </span>
                    <span className="muted">{(a.date || '').slice(11, 16)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="day-notes">
            <strong>Notas</strong>
            {dayNotes.length === 0 && <p className="muted">Sin notas este día.</p>}
            <ul className="note-list">
              {dayNotes.map((n) => (
                <li key={n.id}>
                  <span>{n.text}</span>
                  <button type="button" className="icon" onClick={() => delNote(n.id)} aria-label="Borrar nota">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <Field label="Nueva nota">
            <textarea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Recordatorio, seguimiento…" />
          </Field>
        </Modal>
      )}
    </section>
  );
}
