import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Modal, Field } from '../components/ui.jsx';

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

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
  const [selected, setSelected] = useState(null); // 'YYYY-MM-DD'
  const [draft, setDraft] = useState('');

  const load = () => {
    api.list('notes').then(setNotes);
    api.list('appointments').then(setAppts);
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
              return (
                <button
                  key={di}
                  className={'cal-cell' + (key === today ? ' is-today' : '')}
                  onClick={() => {
                    setSelected(key);
                    setDraft('');
                  }}
                >
                  <span className="cal-num">{day.getDate()}</span>
                  <span className="cal-marks">
                    {info?.appts?.map((a) => (
                      <span key={'a' + a.id} className="dot dot-appt" title={a.clientName || 'Cita'} />
                    ))}
                    {info?.notes?.map((n) => (
                      <span key={'n' + n.id} className="dot dot-note" title={n.text} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <p className="cal-legend">
        <span className="dot dot-appt" /> Citas &nbsp; <span className="dot dot-note" /> Notas
      </p>

      {selected && (
        <Modal
          title={`Día ${selected.split('-').reverse().join('/')}`}
          onClose={() => setSelected(null)}
          onSubmit={addNote}
          submitLabel="Añadir nota"
        >
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
