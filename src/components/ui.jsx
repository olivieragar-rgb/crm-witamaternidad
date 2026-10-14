// Small shared UI building blocks used across the module views.

export function Toolbar({ title, query, setQuery, onNew, newLabel = 'Nueva' }) {
  return (
    <div className="toolbar">
      <h1>{title}</h1>
      <div className="toolbar-actions">
        {setQuery && (
          <input
            className="search"
            type="search"
            placeholder="Buscar…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {onNew && (
          <button type="button" className="primary" onClick={onNew}>
            + {newLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export function Badge({ value }) {
  const key = (value || '').split(' ')[0].toLowerCase();
  return <span className={'badge badge-' + key}>{value}</span>;
}

export function Modal({ title, onClose, children, onSubmit, submitLabel = 'Guardar', error, hideCancel }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <div className="modal-body">{children}</div>
          {error && <p className="error">{error}</p>}
          <div className="modal-foot">
            {/* En una vista de solo lectura no hay nada que cancelar. */}
            {!hideCancel && (
              <button type="button" onClick={onClose}>
                Cancelar
              </button>
            )}
            <button type="submit" className="primary">
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/**
 * Hueco gris con brillo mientras llegan los datos. Mejor que un "Cargando…"
 * porque reserva el sitio y la pagina no pega un salto al rellenarse.
 *
 * @param {{ rows?: number, className?: string }} props
 */
export function Skeleton({ rows = 3, className = '' }) {
  return (
    <div className={`skeleton-block ${className}`} aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando…</span>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton-line" style={{ '--i': i }} />
      ))}
    </div>
  );
}

export function EmptyRow({ colSpan, text = 'Sin resultados' }) {
  return (
    <tr>
      <td className="empty" colSpan={colSpan}>
        {text}
      </td>
    </tr>
  );
}
