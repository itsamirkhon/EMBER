export interface ScatterPoint {
  id: string;
  x: number;
  y: number;
  label: string;
  color?: string;
  group?: string;
}

export interface LineSeries {
  id: string;
  label: string;
  color: string;
  points: Array<{ x: number; y: number }>;
}

const CHART_WIDTH = 640;
const CHART_HEIGHT = 290;
const PAD = { top: 20, right: 24, bottom: 44, left: 56 };

function scaleValue(val: number, min: number, max: number, outMin: number, outMax: number): number {
  if (max <= min) return (outMin + outMax) / 2;
  return outMin + ((val - min) / (max - min)) * (outMax - outMin);
}

function makeTicks(min: number, max: number, count = 5): number[] {
  if (max <= min) return [min];
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(min + ((max - min) * i) / (count - 1));
  }
  return out;
}

export function ScatterPlotSvg({
  title,
  xLabel,
  yLabel,
  points,
  highlightPoint,
}: {
  title: string;
  xLabel: string;
  yLabel: string;
  points: ScatterPoint[];
  highlightPoint?: { x: number; y: number; label: string } | null;
}) {
  const allX = [...points.map((p) => p.x), ...(highlightPoint ? [highlightPoint.x] : [])];
  const allY = [...points.map((p) => p.y), ...(highlightPoint ? [highlightPoint.y] : [])];
  const xMin = allX.length > 0 ? Math.min(0, ...allX) : 0;
  const xMax = allX.length > 0 ? Math.max(...allX) * 1.08 || 10 : 10;
  const yMin = allY.length > 0 ? Math.min(0, ...allY) : 0;
  const yMax = allY.length > 0 ? Math.max(...allY) * 1.1 || 100 : 100;

  const plotW = CHART_WIDTH - PAD.left - PAD.right;
  const plotH = CHART_HEIGHT - PAD.top - PAD.bottom;
  const xTicks = makeTicks(xMin, xMax, 5);
  const yTicks = makeTicks(yMin, yMax, 5);

  return (
    <figure className="chart-figure">
      <figcaption>{title}</figcaption>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="chart-svg"
        role="img"
        aria-label={`${title}: ${points.length} data points plotting ${yLabel} vs ${xLabel}.`}
      >
        <title>{title}</title>
        {yTicks.map((t, idx) => {
          const py = scaleValue(t, yMin, yMax, PAD.top + plotH, PAD.top);
          return (
            <g key={`y-${idx}`}>
              <line x1={PAD.left} y1={py} x2={PAD.left + plotW} y2={py} stroke="var(--v3-grid)" strokeWidth="1" />
              <text x={PAD.left - 8} y={py + 4} textAnchor="end" fill="var(--v3-text-2)" fontSize="11">
                {t.toFixed(1)}
              </text>
            </g>
          );
        })}
        {xTicks.map((t, idx) => {
          const px = scaleValue(t, xMin, xMax, PAD.left, PAD.left + plotW);
          return (
            <g key={`x-${idx}`}>
              <line x1={px} y1={PAD.top} x2={px} y2={PAD.top + plotH} stroke="var(--v3-grid)" strokeWidth="1" />
              <text x={px} y={PAD.top + plotH + 18} textAnchor="middle" fill="var(--v3-text-2)" fontSize="11">
                {t.toFixed(1)}
              </text>
            </g>
          );
        })}

        <line x1={PAD.left} y1={PAD.top + plotH} x2={PAD.left + plotW} y2={PAD.top + plotH} stroke="var(--v3-muted)" strokeWidth="1.2" />
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + plotH} stroke="var(--v3-muted)" strokeWidth="1.2" />

        {points.slice(0, 240).map((p) => {
          const px = scaleValue(p.x, xMin, xMax, PAD.left, PAD.left + plotW);
          const py = scaleValue(p.y, yMin, yMax, PAD.top + plotH, PAD.top);
          return (
            <circle key={p.id} cx={px} cy={py} r="4.5" fill={p.color ?? 'var(--v3-liquid)'} fillOpacity="0.82" stroke="var(--v3-surface-2)" strokeWidth="1">
              <title>{p.label}</title>
            </circle>
          );
        })}

        {highlightPoint ? (
          <g>
            <circle
              cx={scaleValue(highlightPoint.x, xMin, xMax, PAD.left, PAD.left + plotW)}
              cy={scaleValue(highlightPoint.y, yMin, yMax, PAD.top + plotH, PAD.top)}
              r="7.5"
              fill="none"
              stroke="var(--v3-accent)"
              strokeWidth="2.5"
            />
            <circle
              cx={scaleValue(highlightPoint.x, xMin, xMax, PAD.left, PAD.left + plotW)}
              cy={scaleValue(highlightPoint.y, yMin, yMax, PAD.top + plotH, PAD.top)}
              r="3.5"
              fill="var(--v3-accent)"
            >
              <title>{highlightPoint.label}</title>
            </circle>
          </g>
        ) : null}

        <text x={PAD.left + plotW / 2} y={CHART_HEIGHT - 6} textAnchor="middle" fill="var(--v3-text)" fontSize="12">
          {xLabel}
        </text>
        <text
          x={14}
          y={PAD.top + plotH / 2}
          textAnchor="middle"
          fill="var(--v3-text)"
          fontSize="12"
          transform={`rotate(-90 14 ${PAD.top + plotH / 2})`}
        >
          {yLabel}
        </text>
      </svg>
    </figure>
  );
}

export function MultiLineSeriesSvg({
  title,
  xLabel,
  yLabel,
  series,
}: {
  title: string;
  xLabel: string;
  yLabel: string;
  series: LineSeries[];
}) {
  const allPoints = series.flatMap((s) => s.points);
  const xMin = allPoints.length > 0 ? Math.min(...allPoints.map((p) => p.x)) : 0;
  const xMax = allPoints.length > 0 ? Math.max(...allPoints.map((p) => p.x)) * 1.05 || 10 : 10;
  const yMin = allPoints.length > 0 ? Math.min(0, ...allPoints.map((p) => p.y)) : 0;
  const yMax = allPoints.length > 0 ? Math.max(...allPoints.map((p) => p.y)) * 1.1 || 10 : 10;

  const plotW = CHART_WIDTH - PAD.left - PAD.right;
  const plotH = CHART_HEIGHT - PAD.top - PAD.bottom;
  const xTicks = makeTicks(xMin, xMax, 5);
  const yTicks = makeTicks(yMin, yMax, 5);

  return (
    <figure className="chart-figure">
      <figcaption>{title}</figcaption>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="chart-svg"
        role="img"
        aria-label={`${title}: ${series.length} series plotting ${yLabel} vs ${xLabel}.`}
      >
        <title>{title}</title>
        {yTicks.map((t, idx) => {
          const py = scaleValue(t, yMin, yMax, PAD.top + plotH, PAD.top);
          return (
            <g key={`yl-${idx}`}>
              <line x1={PAD.left} y1={py} x2={PAD.left + plotW} y2={py} stroke="var(--v3-grid)" strokeWidth="1" />
              <text x={PAD.left - 8} y={py + 4} textAnchor="end" fill="var(--v3-text-2)" fontSize="11">
                {t.toFixed(2)}
              </text>
            </g>
          );
        })}
        {xTicks.map((t, idx) => {
          const px = scaleValue(t, xMin, xMax, PAD.left, PAD.left + plotW);
          return (
            <g key={`xl-${idx}`}>
              <line x1={px} y1={PAD.top} x2={px} y2={PAD.top + plotH} stroke="var(--v3-grid)" strokeWidth="1" />
              <text x={px} y={PAD.top + plotH + 18} textAnchor="middle" fill="var(--v3-text-2)" fontSize="11">
                {t.toFixed(1)}
              </text>
            </g>
          );
        })}

        <line x1={PAD.left} y1={PAD.top + plotH} x2={PAD.left + plotW} y2={PAD.top + plotH} stroke="var(--v3-muted)" strokeWidth="1.2" />
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + plotH} stroke="var(--v3-muted)" strokeWidth="1.2" />

        {series.map((s) => {
          const sorted = [...s.points].sort((a, b) => a.x - b.x);
          const d = sorted
            .map((pt, i) => {
              const px = scaleValue(pt.x, xMin, xMax, PAD.left, PAD.left + plotW);
              const py = scaleValue(pt.y, yMin, yMax, PAD.top + plotH, PAD.top);
              return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
            })
            .join(' ');
          return (
            <g key={s.id}>
              {sorted.length > 1 ? (
                <path d={d} fill="none" stroke={s.color} strokeWidth="2.2" />
              ) : null}
              {sorted.map((pt, i) => (
                <circle
                  key={`${s.id}-${i}`}
                  cx={scaleValue(pt.x, xMin, xMax, PAD.left, PAD.left + plotW)}
                  cy={scaleValue(pt.y, yMin, yMax, PAD.top + plotH, PAD.top)}
                  r="4"
                  fill={s.color}
                >
                  <title>{`${s.label}: x=${pt.x}, y=${pt.y}`}</title>
                </circle>
              ))}
            </g>
          );
        })}

        <text x={PAD.left + plotW / 2} y={CHART_HEIGHT - 6} textAnchor="middle" fill="var(--v3-text)" fontSize="12">
          {xLabel}
        </text>
        <text
          x={14}
          y={PAD.top + plotH / 2}
          textAnchor="middle"
          fill="var(--v3-text)"
          fontSize="12"
          transform={`rotate(-90 14 ${PAD.top + plotH / 2})`}
        >
          {yLabel}
        </text>
      </svg>
      <div className="pill-row" style={{ marginBlockStart: '0.55rem' }}>
        {series.map((s) => (
          <span key={s.id} className="pill">
            <span
              aria-hidden="true"
              style={{ inlineSize: 10, blockSize: 10, borderRadius: '50%', background: s.color }}
            />
            <span>{s.label}</span>
          </span>
        ))}
      </div>
    </figure>
  );
}
