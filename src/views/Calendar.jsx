import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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

/**
 * Símbolo del día de la fecha probable de parto. El nombre sale al pasar el
 * ratón en un tooltip propio: la celda recorta lo que se sale de ella y el
 * `title` nativo tarda en aparecer. Se pinta en el `body` (portal) porque un
 * ancestro con transform cambia el origen del `position: fixed`.
 */
function DueMarker({ name }) {
  const [tip, setTip] = useState(null);
  const show = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top });
  };
  return (
    <span
      className="due-marker"
      role="img"
      aria-label={`Fecha probable de parto: ${name}`}
      onMouseEnter={show}
      onMouseLeave={() => setTip(null)}
    >
      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
        <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.2 3 4.5 6.6 4.5c2.1 0 3.9 1.2 5.4 3.2 1.5-2 3.3-3.2 5.4-3.2 3.6 0 5.7 3.7 4.2 7.3C19.5 16.4 12 21 12 21z" fill="currentColor" />
      </svg>
      {tip &&
        createPortal(
          <span className="due-tip" style={{ left: tip.x, top: tip.y }}>
            <strong>{name}</strong>
            <span>Fecha probable de parto</span>
          </span>,
          document.body,
        )}
    </span>
  );
}

export default function Calendar({ go }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [notes, setNotes] = useState([]);
  const [appts, setAppts] = useState([]);
  const [clients, setClients] = useState([]);
  const [selected, setSelected] = useState(null); // 'YYYY-MM-DD'
  const [draft, setDraft] = useState('');

  const load = () => {
    api.list('notes').then(setNotes);
    api.list('appointments').then(setAppts);
    api.list('clients').then(setClients);
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

  // Qué clientas tienen la fecha probable de parto cada día. Una ficha
  // anonimizada ya no tiene fecha, así que no sale.
  const dueByDay = useMemo(() => {
    const map = {};
    for (const c of clients) {
      const key = (c.dueDate || '').slice(0, 10);
      if (key) (map[key] = map[key] || []).push(c);
    }
    return map;
  }, [clients]);

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
  // Es la misma cita que se ve en Citas: al borrarla aquí desaparece de las dos.
  async function delAppt(a) {
    const quien = a.clientName || 'esta clienta';
    if (!confirm(`¿Borrar la cita de ${quien} a las ${(a.date || '').slice(11, 16)}?\nTambién desaparece de Citas.`)) return;
    try {
      await api.remove('appointments', a.id);
      setAppts(await api.list('appointments'));
    } catch (e) {
      alert(e.message);
    }
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
              const due = dueByDay[key] || [];
              return (
                <button
                  key={di}
                  className={
                    'cal-cell' +
                    (key === today ? ' is-today' : '') +
                    (due.length ? ' has-due' : '')
                  }
                  onClick={() => {
                    setSelected(key);
                    setDraft('');
                  }}
                >
                  {due.length > 0 && (
                    <span className="due-markers">
                      {due.map((c) => (
                        <DueMarker key={c.id} name={c.name} />
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
        <span className="due-legend">
          <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
            <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.2 3 4.5 6.6 4.5c2.1 0 3.9 1.2 5.4 3.2 1.5-2 3.3-3.2 5.4-3.2 3.6 0 5.7 3.7 4.2 7.3C19.5 16.4 12 21 12 21z" fill="currentColor" />
          </svg>
        </span>{' '}
        Fecha probable de parto
      </p>

      {selected && (
        <Modal
          title={`Día ${selected.split('-').reverse().join('/')}`}
          onClose={() => setSelected(null)}
          onSubmit={addNote}
          submitLabel="Añadir nota"
        >
          {(dueByDay[selected] || []).length > 0 && (
            <div className="day-appts">
              <strong>Fecha probable de parto</strong>
              <ul className="mini-list">
                {(dueByDay[selected] || []).map((c) => (
                  <li key={c.id}>
                    <span>{c.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="day-appts">
            <div className="day-head">
              <strong>Citas</strong>
              {/* Lleva a Citas con este día ya puesto: solo falta lo demás. */}
              <button type="button" className="primary" onClick={() => go('appointments', { newDate: selected })}>
                Gestionar cita
              </button>
            </div>
            {dayAppts.length === 0 && <p className="muted">Sin citas este día.</p>}
            <ul className="mini-list">
              {dayAppts.map((a) => (
                <li key={a.id}>
                  <span>
                    {a.clientName || '—'}
                    {a.serviceName ? ` · ${a.serviceName}` : ''}
                  </span>
                  <span className="muted">
                    {(a.date || '').slice(11, 16)}{' '}
                    <button type="button" onClick={() => go('appointments', { editId: a.id })}>
                      Editar
                    </button>{' '}
                    <button type="button" className="danger" onClick={() => delAppt(a)}>
                      Eliminar
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>

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
