import { useEffect, useMemo, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { Field, HelpTitle } from '../components/ui.jsx';
import FppCalculator from '../components/FppCalculator.jsx';
import GrowthChart from '../components/GrowthChart.jsx';
import { percentileForWeight, readPercentile, daysBetween, formatAge, MAX_DAY } from '../lib/growth.js';

const TABS = [
  { id: 'fpp', label: 'Fecha probable de parto' },
  { id: 'growth', label: 'Percentil de peso' },
];

export default function Tools() {
  const [tab, setTab] = useState('fpp');
  return (
    <section>
      <div className="toolbar">
        <h1>Herramientas</h1>
      </div>
      <div className="filters">
        {TABS.map((t) => (
          <button key={t.id} className={'chip' + (tab === t.id ? ' active' : '')} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'fpp' ? <FppPanel /> : <GrowthPanel />}
    </section>
  );
}

function FppPanel() {
  return (
    <div className="tool-grid">
      <FppCalculator />
      <div className="panel">
        <h2>Cómo se calcula</h2>
        <p className="muted">
          Regla de Naegele: la fecha probable de parto son 280 días (40 semanas) desde el primer día de la
          última regla. Da por supuesto un ciclo de 28 días, así que en ciclos más largos o más cortos la
          fecha real se desplaza.
        </p>
        <p className="muted">
          Es una estimación, no una cita: solo una minoría de bebés nace exactamente ese día.
        </p>
      </div>
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

/** Percentil de peso según los patrones de crecimiento de la OMS. */
function GrowthPanel() {
  const [clients, setClients] = useState([]);
  const [sex, setSex] = useState('girl');
  const [birth, setBirth] = useState('');
  const [name, setName] = useState('');
  const [rows, setRows] = useState([]); // { date, weight }
  const [date, setDate] = useState(today());
  const [weight, setWeight] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.list('clients').then(setClients);
  }, []);

  const points = useMemo(
    () =>
      rows
        .map((r) => ({ ...r, day: daysBetween(birth, r.date) }))
        .filter((r) => r.day !== null && r.day >= 0 && r.day <= MAX_DAY)
        .map((r) => ({ ...r, ...(percentileForWeight(sex, r.day, r.weight) || {}) }))
        .sort((a, b) => a.day - b.day),
    [rows, birth, sex],
  );

  function add() {
    setError('');
    const kg = Number(String(weight).replace(',', '.'));
    if (!birth) return setError('Pon primero la fecha de nacimiento.');
    if (!(kg > 0)) return setError('El peso tiene que ser un número mayor que cero.');
    const day = daysBetween(birth, date);
    if (day === null || day < 0) return setError('La fecha de la medida es anterior al nacimiento.');
    if (day > MAX_DAY) {
      return setError('Las tablas de la OMS que usa esta herramienta llegan hasta los 24 meses.');
    }
    if (rows.some((r) => r.date === date)) return setError('Ya hay una medida en esa fecha.');
    setRows([...rows, { date, weight: kg }]);
    setWeight('');
  }

  const last = points[points.length - 1];
  const lectura = last ? readPercentile(last.percentile) : null;

  return (
    <div className="tool-growth">
      <div className="panel">
        <h2>Datos del bebé</h2>
        <div className="form-grid">
          <Field label="Nombre (opcional)">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              list="clientas-bebe"
              placeholder="Para identificarlo en la hoja"
            />
            <datalist id="clientas-bebe">
              {clients.map((c) => (
                <option key={c.id} value={`Bebé de ${c.name}`} />
              ))}
            </datalist>
          </Field>
          <Field label="Fecha de nacimiento">
            <input type="date" value={birth} max={today()} onChange={(e) => setBirth(e.target.value)} />
          </Field>
          <Field label="Sexo">
            <select value={sex} onChange={(e) => setSex(e.target.value)}>
              <option value="girl">Niña</option>
              <option value="boy">Niño</option>
            </select>
          </Field>
        </div>
        <p className="muted small">
          La OMS publica tablas distintas para niñas y niños, así que el percentil cambia según cuál elijas.
        </p>
      </div>

      <div className="panel">
        <h2>Añadir una pesada</h2>
        <div className="form-grid">
          <Field label="Fecha">
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Peso (kg)">
            <input
              type="number"
              step="0.001"
              min="0"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="3,450"
            />
          </Field>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="save-row">
          <button className="primary" onClick={add} disabled={!birth}>
            Añadir
          </button>
          {rows.length > 0 && (
            <button onClick={() => setRows([])} className="danger">
              Vaciar
            </button>
          )}
        </div>
      </div>

      {last && (
        <div className={`panel percentile-result tone-${lectura.tone}`}>
          <span className="muted">
            {name || 'El bebé'} con {formatAge(last.day)}, {String(last.weight).replace('.', ',')} kg
          </span>
          <strong className="percentile-num">Percentil {Math.round(last.percentile)}</strong>
          <span className="percentile-read">{lectura.label}</span>
          <span className="muted small">
            Significa que de cada 100 bebés de su edad y sexo, alrededor de {Math.round(last.percentile)}{' '}
            pesan menos que {name || 'él'}.
          </span>
        </div>
      )}

      {points.length > 0 && (
        <div className="panel">
          <HelpTitle
            help="Las curvas grises son los patrones de crecimiento de la OMS; la línea oscura, este bebé. Lo que importa no es en qué percentil está, sino que siga su propia curva."
          >
            Peso para la edad
          </HelpTitle>
          <GrowthChart sex={sex} points={points} />

          {/* La tabla no es un extra: es la forma accesible de leer lo mismo. */}
          <table className="grid-table compact growth-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Edad</th>
                <th className="num">Peso</th>
                <th className="num">Percentil</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date}>
                  <td className="muted">{fmtDate(p.date)}</td>
                  <td>{formatAge(p.day)}</td>
                  <td className="num">{String(p.weight).replace('.', ',')} kg</td>
                  <td className="num">P{Math.round(p.percentile)}</td>
                  <td className="row-actions">
                    <button onClick={() => setRows(rows.filter((r) => r.date !== p.date))}>Quitar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted small tool-note">
        Fuente: patrones de crecimiento infantil de la Organización Mundial de la Salud, peso para la edad,
        del nacimiento a los 24 meses. Es una <strong>ayuda visual para la consulta, no un diagnóstico</strong>:
        un percentil bajo o alto por sí solo no dice nada, y quien valora el crecimiento de un bebé es su
        pediatra. Los datos de esta pantalla no se guardan en el CRM.
      </p>
    </div>
  );
}
