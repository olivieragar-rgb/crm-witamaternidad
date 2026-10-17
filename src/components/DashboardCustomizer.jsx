import { Modal } from './ui.jsx';
import {
  GROUPS, LIST_SIZES, DEFAULT_DASHBOARD, blockInfo, blocksOf, moveBlock, setVisible,
} from '../lib/dashboard-layout.js';

/**
 * Cuadro para elegir cómo se ve Inicio: qué bloques salen, en qué orden y con
 * qué aspecto. Cada cambio se ve al momento detrás (la pantalla pinta el
 * borrador); solo se guarda al pulsar Guardar, y Cancelar lo deja como estaba.
 *
 * @param {{
 *   layout: ReturnType<import('../lib/dashboard-layout.js').sanitizeDashboard>,
 *   onChange: (next: object) => void, onSave: () => void, onCancel: () => void,
 *   error?: string,
 * }} props
 */
export default function DashboardCustomizer({ layout, onChange, onSave, onCancel, error }) {
  return (
    <Modal title="Personalizar Inicio" onClose={onCancel} onSubmit={onSave} submitLabel="Guardar" error={error}>
      <p className="muted small">
        Elige qué ves en Inicio y cómo. Los cambios se ven al momento, detrás de este cuadro; se guardan para ti
        cuando pulsas Guardar.
      </p>

      {Object.entries(GROUPS).map(([group, title]) => {
        const rows = blocksOf(layout, group);
        return (
          <fieldset className="cust-group" key={group}>
            <legend>{title}</legend>
            {rows.map((b, i) => {
              const info = blockInfo(b.id);
              return (
                <div className="cust-row" key={b.id}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={b.visible}
                      onChange={(e) => onChange(setVisible(layout, b.id, e.target.checked))}
                    />
                    <span>
                      {info.label}
                      {info.note && <small className="muted"> · {info.note}</small>}
                    </span>
                  </label>
                  <span className="cust-move">
                    <button
                      type="button"
                      className="icon"
                      disabled={i === 0}
                      aria-label={`Subir: ${info.label}`}
                      title="Subir"
                      onClick={() => onChange(moveBlock(layout, b.id, -1))}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="icon"
                      disabled={i === rows.length - 1}
                      aria-label={`Bajar: ${info.label}`}
                      title="Bajar"
                      onClick={() => onChange(moveBlock(layout, b.id, 1))}
                    >
                      ▼
                    </button>
                  </span>
                </div>
              );
            })}
          </fieldset>
        );
      })}

      <fieldset className="cust-group">
        <legend>Aspecto</legend>
        <div className="cust-options">
          <span className="cust-label">Paneles</span>
          <Choice
            value={layout.columns}
            options={[[2, 'En dos columnas'], [1, 'En una columna']]}
            onPick={(columns) => onChange({ ...layout, columns })}
          />
          <span className="cust-label">Cifras</span>
          <Choice
            value={layout.compact}
            options={[[false, 'Normales'], [true, 'Compactas']]}
            onPick={(compact) => onChange({ ...layout, compact })}
          />
          <span className="cust-label">Elementos en las listas</span>
          <Choice
            value={layout.listSize}
            options={LIST_SIZES.map((n) => [n, String(n)])}
            onPick={(listSize) => onChange({ ...layout, listSize })}
          />
        </div>
      </fieldset>

      <button type="button" className="link" onClick={() => onChange(DEFAULT_DASHBOARD)}>
        Volver a como venía
      </button>
    </Modal>
  );
}

/** Varias opciones, una elegida: botones en fila, que se leen mejor que un desplegable. */
function Choice({ value, options, onPick }) {
  return (
    <span className="cust-choice" role="radiogroup">
      {options.map(([v, label]) => (
        <button
          type="button"
          key={String(v)}
          role="radio"
          aria-checked={value === v}
          className={'chip' + (value === v ? ' active' : '')}
          onClick={() => onPick(v)}
        >
          {label}
        </button>
      ))}
    </span>
  );
}
