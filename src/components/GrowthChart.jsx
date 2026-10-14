import { useMemo, useState } from 'react';
import { weightForPercentile, percentileForWeight, formatAge, MAX_DAY } from '../lib/growth.js';

// Curvas de referencia de la OMS. Son contexto, no series con identidad
// propia, asi que van en un verde recesivo que va a mas hacia la mediana y
// llevan su etiqueta al borde derecho en vez de una leyenda de colores.
const BANDS = [
  { p: 3, color: '#cddcce' },
  { p: 15, color: '#a3bda5' },
  { p: 50, color: '#5b7f5e' },
  { p: 85, color: '#a3bda5' },
  { p: 97, color: '#cddcce' },
];

// El unico dato propio del grafico. Verificado con el validador de paletas:
// frente al verde de la mediana da ΔE 10,5 en deuteranopia y 17,4 con vision
// normal, asi que se distingue tambien sin ver bien el rojo. El terracota de
// la marca no pasaba: ΔE 2,5, practicamente el mismo color.
const BABY = '#8a3f1d';
const SURFACE = '#fefcf9';
const INK = '#2e2a25';
const MUTED = '#9c9489';
const GRID = '#ede7df';

const W = 720;
const H = 400;
const PAD = { top: 16, right: 46, bottom: 44, left: 48 };

const DAYS_PER_MONTH = 30.4375;

/**
 * Peso para la edad sobre las curvas de la OMS.
 *
 * @param {{ sex: 'boy'|'girl', points: Array<{day:number, weight:number}> }} props
 */
export default function GrowthChart({ sex, points }) {
  const [hover, setHover] = useState(null); // { x, day }

  // Se enseña el tramo mas corto que contenga las medidas: con un bebe de
  // tres semanas no tiene sentido pintar dos años de eje.
  const maxDay = useMemo(() => {
    const last = points.length ? Math.max(...points.map((p) => p.day)) : 0;
    // Un mes y medio de margen por delante de la ultima pesada, redondeado al
    // mes, con tres meses de minimo. Asi se ve hacia donde va la curva sin
    // dejar media pantalla vacia.
    const meses = Math.ceil(last / DAYS_PER_MONTH) + 2;
    return Math.min(MAX_DAY, Math.max(3, meses) * DAYS_PER_MONTH);
  }, [points]);

  const curves = useMemo(() => {
    const step = Math.max(1, Math.round(maxDay / 120));
    return BANDS.map((b) => {
      const pts = [];
      for (let d = 0; d <= maxDay; d += step) pts.push([d, weightForPercentile(sex, d, b.p)]);
      if (pts[pts.length - 1][0] !== maxDay) pts.push([maxDay, weightForPercentile(sex, maxDay, b.p)]);
      return { ...b, pts };
    });
  }, [sex, maxDay]);

  const yMax = useMemo(() => {
    const top = Math.max(
      curves[curves.length - 1].pts[curves[curves.length - 1].pts.length - 1][1],
      ...points.map((p) => p.weight),
    );
    return Math.ceil((top + 0.5) * 2) / 2;
  }, [curves, points]);

  const x = (day) => PAD.left + (day / maxDay) * (W - PAD.left - PAD.right);
  const y = (kg) => H - PAD.bottom - (kg / yMax) * (H - PAD.top - PAD.bottom);
  const path = (pts) => pts.map(([d, kg], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)} ${y(kg).toFixed(1)}`).join(' ');

  // Marcas del eje: meses enteros, sin apelotonar.
  const monthStep = maxDay <= 91 ? 1 : maxDay <= 182 ? 1 : maxDay <= 365 ? 2 : 3;
  const xTicks = [];
  for (let m = 0; m * DAYS_PER_MONTH <= maxDay; m += monthStep) xTicks.push(m);

  const yStep = yMax <= 8 ? 1 : yMax <= 16 ? 2 : 4;
  const yTicks = [];
  for (let v = 0; v <= yMax; v += yStep) yTicks.push(v);

  const sorted = [...points].sort((a, b) => a.day - b.day);
  const last = sorted[sorted.length - 1];

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    if (px < PAD.left || px > W - PAD.right) return setHover(null);
    const day = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * maxDay);
    setHover({ day: Math.max(0, Math.min(maxDay, day)) });
  }

  const hoverPoint =
    hover && sorted.length
      ? sorted.reduce((best, p) =>
          Math.abs(p.day - hover.day) < Math.abs(best.day - hover.day) ? p : best,
        )
      : null;
  const hoverNear = hoverPoint && Math.abs(hoverPoint.day - hover.day) <= maxDay * 0.04 ? hoverPoint : null;

  return (
    <div className="growth-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Peso para la edad según los patrones de la OMS. ${sorted.length} medida${sorted.length === 1 ? '' : 's'} registrada${sorted.length === 1 ? '' : 's'}. Los valores exactos están en la tabla que hay debajo.`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* Rejilla: linea fina continua, un paso por encima del fondo. */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth="1" />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={MUTED}>
              {v}
            </text>
          </g>
        ))}
        {xTicks.map((m) => (
          <text
            key={m}
            x={x(m * DAYS_PER_MONTH)}
            y={H - PAD.bottom + 18}
            textAnchor="middle"
            fontSize="11"
            fill={MUTED}
          >
            {m}
          </text>
        ))}
        <text x={(PAD.left + W - PAD.right) / 2} y={H - 6} textAnchor="middle" fontSize="11" fill={MUTED}>
          Meses
        </text>
        <text x={PAD.left - 8} y={PAD.top - 4} textAnchor="end" fontSize="11" fill={MUTED}>
          kg
        </text>

        {/* Franja habitual: del percentil 3 al 97, un lavado muy suave. */}
        <path
          d={`${path(curves[0].pts)} L${x(maxDay).toFixed(1)} ${y(curves[4].pts[curves[4].pts.length - 1][1]).toFixed(1)} ${path([...curves[4].pts].reverse())
            .replace('M', 'L')
            .slice(1)} Z`}
          fill="#5b7f5e"
          fillOpacity="0.06"
          stroke="none"
        />

        {curves.map((c, i) => (
          <g key={c.p}>
            <path
              d={path(c.pts)}
              fill="none"
              stroke={c.color}
              strokeWidth={c.p === 50 ? 2 : 1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Etiqueta directa al borde: sustituye a una leyenda de colores. */}
            <text
              x={W - PAD.right + 5}
              y={y(c.pts[c.pts.length - 1][1]) + 3.5}
              fontSize="10"
              fill={MUTED}
              fontWeight={c.p === 50 ? 700 : 400}
            >
              P{c.p}
            </text>
          </g>
        ))}

        {/* Linea del bebé: lo único que puede ser fuerte. */}
        {sorted.length > 1 && (
          <path
            d={path(sorted.map((p) => [p.day, p.weight]))}
            fill="none"
            stroke={BABY}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {sorted.map((p) => (
          <circle
            key={p.day}
            cx={x(p.day)}
            cy={y(p.weight)}
            r="4.5"
            fill={BABY}
            stroke={SURFACE}
            strokeWidth="2"
          />
        ))}

        {/* Solo la ultima medida lleva etiqueta: una cifra en cada punto no se lee. */}
        {last && (
          <text
            x={x(last.day) + (x(last.day) > W - PAD.right - 60 ? -10 : 10)}
            y={y(last.weight) - 10}
            textAnchor={x(last.day) > W - PAD.right - 60 ? 'end' : 'start'}
            fontSize="12"
            fontWeight="700"
            fill={INK}
          >
            {last.weight.toFixed(3).replace(/\.?0+$/, '').replace('.', ',')} kg
          </text>
        )}

        {/* Cruceta y lectura al pasar por encima. */}
        {hover && (
          <g pointerEvents="none">
            <line
              x1={x(hover.day)}
              x2={x(hover.day)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke={MUTED}
              strokeWidth="1"
            />
            {hoverNear && (
              <circle cx={x(hoverNear.day)} cy={y(hoverNear.weight)} r="6.5" fill="none" stroke={BABY} strokeWidth="2" />
            )}
          </g>
        )}
      </svg>

      {hover && (
        <div className="chart-tip">
          <strong>{formatAge(hover.day)}</strong>
          {hoverNear && (
            <span className="tip-baby">
              {hoverNear.weight.toString().replace('.', ',')} kg · percentil{' '}
              {Math.round(percentileForWeight(sex, hoverNear.day, hoverNear.weight).percentile)}
            </span>
          )}
          <span className="muted">
            OMS: P3 {weightForPercentile(sex, hover.day, 3).toFixed(1).replace('.', ',')} · P50{' '}
            {weightForPercentile(sex, hover.day, 50).toFixed(1).replace('.', ',')} · P97{' '}
            {weightForPercentile(sex, hover.day, 97).toFixed(1).replace('.', ',')} kg
          </span>
        </div>
      )}
    </div>
  );
}
