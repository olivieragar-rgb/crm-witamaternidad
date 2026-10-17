// Small shared UI building blocks used across the module views.
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * El pop-up de ayuda: sale al dejar el ratón encima (o el foco, o un toque en
 * pantalla táctil) y se va al quitarlo.
 *
 * Se pinta en el `body` (portal): un contenedor con transform u `overflow` lo
 * recortaría o lo descolocaría. Una vez pintado se sabe cuánto mide, y se
 * coloca debajo del elemento, sin salirse por los lados y encima si por
 * abajo no cabe.
 */
function useHelpPop(help) {
  const id = useId();
  const anchorRef = useRef(null);
  const popRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !popRef.current) return;
    const a = anchorRef.current.getBoundingClientRect();
    const w = popRef.current.offsetWidth;
    const h = popRef.current.offsetHeight;
    const left = Math.max(12, Math.min(a.left, window.innerWidth - w - 12));
    const debajo = a.bottom + 8;
    const top = debajo + h + 12 > window.innerHeight ? Math.max(12, a.top - h - 8) : debajo;
    setPos({ left, top });
  }, [open]);

  const show = () => setOpen(true);
  const hide = () => {
    setOpen(false);
    setPos(null);
  };

  return {
    anchorRef,
    bind: {
      'aria-describedby': open ? id : undefined,
      onMouseEnter: show,
      onMouseLeave: hide,
      onFocus: show,
      onBlur: hide,
      onClick: show,
      onKeyDown: (e) => e.key === 'Escape' && hide(),
    },
    popup:
      open &&
      createPortal(
        <span
          ref={popRef}
          id={id}
          role="tooltip"
          className="help-pop"
          style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
        >
          {help}
        </span>,
        document.body,
      ),
  };
}

/**
 * Título con su texto de ayuda escondido: sustituye a los párrafos que
 * ocupaban sitio debajo del título todo el rato. La "i" avisa de que hay algo
 * más sin quitarle protagonismo.
 *
 * @param {{ as?: string, help: import('react').ReactNode, className?: string, children: import('react').ReactNode }} props
 */
export function HelpTitle({ as: Tag = 'h2', help, className, children }) {
  const { anchorRef, bind, popup } = useHelpPop(help);
  return (
    <Tag className={className}>
      <span ref={anchorRef} className="help-title" tabIndex={0} {...bind}>
        {children}
        <i className="help-dot" aria-hidden="true">
          i
        </i>
      </span>
      {popup}
    </Tag>
  );
}

/**
 * El círculo con «?» que explica qué poner en un campo y dónde. Sale al dejar
 * el ratón encima (o el foco, o un toque). Pensado para ir pegado a una
 * etiqueta, por eso no deja que el clic llegue al campo de al lado.
 *
 * @param {{ help: import('react').ReactNode, label?: string }} props
 */
export function HelpMark({ help, label = 'Ayuda' }) {
  const { anchorRef, bind, popup } = useHelpPop(help);
  return (
    <span
      ref={anchorRef}
      className="help-mark"
      role="button"
      tabIndex={0}
      aria-label={label}
      {...bind}
      onClick={(e) => {
        // Dentro de un <label>, un clic aquí enfocaría el campo.
        e.preventDefault();
        e.stopPropagation();
        bind.onClick();
      }}
    >
      ?{popup}
    </span>
  );
}

/**
 * Lo mismo para un control que ya es interactivo (una pestaña): le saca el
 * pop-up sin cambiarle el aspecto ni el comportamiento. El foco del botón de
 * dentro sube hasta aquí, así que también sale con el teclado.
 *
 * @param {{ help: import('react').ReactNode, children: import('react').ReactNode }} props
 */
export function HelpTip({ help, children }) {
  const { anchorRef, bind, popup } = useHelpPop(help);
  return (
    <span ref={anchorRef} className="help-tip" {...bind}>
      {children}
      {popup}
    </span>
  );
}

export function Toolbar({ title, query, setQuery, onNew, newLabel = 'Nueva', help }) {
  return (
    <div className="toolbar">
      <h1>
        {title}
        {help && <HelpMark help={help} label={`Cómo funciona: ${title}`} />}
      </h1>
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

/**
 * Cabecera de columna que ordena la tabla al pulsarla: ▲ ascendente, ▼
 * descendente y, a la tercera, vuelve al orden de origen.
 */
export function SortTh({ label, k, sort, onSort }) {
  const activa = sort.key === k;
  const aria = activa ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th aria-sort={aria}>
      <button
        type="button"
        className={'th-sort' + (activa ? ' is-active' : '')}
        onClick={() => onSort(k)}
        title={`Ordenar por ${label.toLowerCase()}`}
      >
        {label}
        <span className="sort-ind" aria-hidden="true">
          {activa ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}

export function Badge({ value }) {
  const key = (value || '').split(' ')[0].toLowerCase();
  return <span className={'badge badge-' + key}>{value}</span>;
}

export function Modal({
  title,
  onClose,
  children,
  onSubmit,
  submitLabel = 'Guardar',
  // Hay modales donde cerrar no es cancelar: en el cuestionario que sale tras
  // crear la ficha, la ficha ya esta guardada y lo que dice es "mas tarde".
  cancelLabel = 'Cancelar',
  error,
  hideCancel,
}) {
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
                {cancelLabel}
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

export function Field({ label, help, children }) {
  return (
    <label className="field">
      <span>
        {label}
        {help && <HelpMark help={help} label={`Ayuda: ${label}`} />}
      </span>
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
