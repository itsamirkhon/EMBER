import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

export type PointCat = 'burn' | 'noburn' | 'other';

export interface ScatterPoint {
  id: string;
  x: number;
  y: number;
  cat: PointCat;
  /** faded (e.g. far from query in a hidden dimension) */
  dim?: boolean;
  /** highlighted (e.g. a nearest neighbour) */
  emphasis?: boolean;
  title: string;
  rows: [string, string][];
}

export interface ScatterProps {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xDomain?: [number, number];
  yDomain?: [number, number];
  query?: { x: number; y: number; label: string } | null;
  height?: number;
  /** text for screen readers */
  summary: string;
  catLabels?: Partial<Record<PointCat, string>>;
}

const W = 640;
const M = { top: 12, right: 16, bottom: 44, left: 56 };

export function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!(hi > lo)) return [lo];
  const span = hi - lo;
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function padDomain(vals: number[], pad = 0.06): [number, number] {
  if (!vals.length) return [0, 1];
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}

const DEFAULT_LABELS: Record<PointCat, string> = { burn: 'Burned / flame sustained', noburn: 'Extinguished / no ignition', other: 'Other / unknown outcome' };

export function Mark({ cat, cx, cy, r = 5 }: { cat: PointCat; cx: number; cy: number; r?: number }) {
  if (cat === 'burn')
    return <circle cx={cx} cy={cy} r={r} fill="var(--series-burn)" stroke="var(--surface-1)" strokeWidth={2} />;
  if (cat === 'noburn')
    return (
      <g>
        <circle cx={cx} cy={cy} r={r + 1} fill="var(--surface-1)" />
        <circle cx={cx} cy={cy} r={r - 0.5} fill="none" stroke="var(--series-noburn)" strokeWidth={2.5} />
      </g>
    );
  const s = r + 0.5;
  return (
    <path
      d={`M${cx},${cy - s} L${cx + s},${cy} L${cx},${cy + s} L${cx - s},${cy} Z`}
      fill="var(--series-other)"
      stroke="var(--surface-1)"
      strokeWidth={2}
    />
  );
}

export function LegendKey({ cat }: { cat: PointCat }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <Mark cat={cat} cx={7} cy={7} r={4.5} />
    </svg>
  );
}

export default function ScatterPlot({
  points, xLabel, yLabel, xDomain, yDomain, query, height = 340, summary, catLabels,
}: ScatterProps) {
  const H = height;
  const labels = { ...DEFAULT_LABELS, ...catLabels };
  const xd = xDomain ?? padDomain([...points.map((p) => p.x), ...(query ? [query.x] : [])]);
  const yd = yDomain ?? padDomain([...points.map((p) => p.y), ...(query ? [query.y] : [])]);
  const sx = (v: number) => M.left + ((v - xd[0]) / (xd[1] - xd[0])) * (W - M.left - M.right);
  const sy = (v: number) => H - M.bottom - ((v - yd[0]) / (yd[1] - yd[0])) * (H - M.top - M.bottom);
  const xt = niceTicks(xd[0], xd[1], 6);
  const yt = niceTicks(yd[0], yd[1], 5);
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const cats = useMemo(() => (['burn', 'noburn', 'other'] as PointCat[]).filter((c) => points.some((p) => p.cat === c)), [points]);
  const order = useMemo(() => points.map((_, i) => i).sort((a, b) => points[a].x - points[b].x || points[a].y - points[b].y), [points]);

  // draw order: dimmed first, emphasised last
  const drawOrder = useMemo(
    () => points.map((_, i) => i).sort((a, b) => Number(!!points[b].dim) - Number(!!points[a].dim) || Number(!!points[a].emphasis) - Number(!!points[b].emphasis)),
    [points],
  );

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scale = W / rect.width;
    const px = (e.clientX - rect.left) * scale;
    const py = (e.clientY - rect.top) * scale;
    let best = -1;
    let bd = Infinity;
    points.forEach((p, i) => {
      const d = Math.hypot(sx(p.x) - px, sy(p.y) - py);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setActive(best >= 0 && bd <= 24 * scale ? best : null);
  }

  function onKey(e: KeyboardEvent<SVGSVGElement>) {
    if (!points.length) return;
    const pos = active === null ? -1 : order.indexOf(active);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      setActive(order[(pos + 1) % order.length]);
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      setActive(order[(pos - 1 + order.length) % order.length]);
      e.preventDefault();
    } else if (e.key === 'Escape') setActive(null);
  }

  const ap = active !== null ? points[active] : null;
  const coincident = ap ? points.filter((p) => Math.abs(sx(p.x) - sx(ap.x)) < 2 && Math.abs(sy(p.y) - sy(ap.y)) < 2) : [];

  return (
    <figure className="chart" style={{ margin: 0 }}>
      <div className="legend" aria-hidden>
        {cats.map((c) => (
          <span key={c}>
            <LegendKey cat={c} /> {labels[c]}
          </span>
        ))}
        {query && (
          <span>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <circle cx="8" cy="8" r="6" fill="none" stroke="var(--text)" strokeWidth="2" />
              <circle cx="8" cy="8" r="1.8" fill="var(--text)" />
            </svg>
            {query.label}
          </span>
        )}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={summary}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        {/* grid */}
        {yt.map((t) => (
          <g key={`y${t}`}>
            <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={M.left - 8} y={sy(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--muted)" className="tabular">
              {t}
            </text>
          </g>
        ))}
        {xt.map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} x2={sx(t)} y1={M.top} y2={H - M.bottom} stroke="var(--grid)" strokeWidth={1} />
            <text x={sx(t)} y={H - M.bottom + 16} textAnchor="middle" fontSize="11" fill="var(--muted)" className="tabular">
              {t}
            </text>
          </g>
        ))}
        <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke="var(--axis)" />
        <line x1={M.left} x2={M.left} y1={M.top} y2={H - M.bottom} stroke="var(--axis)" />
        <text x={(M.left + W - M.right) / 2} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--text-2)">
          {xLabel}
        </text>
        <text transform={`translate(14 ${(M.top + H - M.bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fill="var(--text-2)">
          {yLabel}
        </text>

        {/* query crosshair */}
        {query && (
          <g aria-hidden>
            <line x1={sx(query.x)} x2={sx(query.x)} y1={M.top} y2={H - M.bottom} stroke="var(--text-2)" strokeWidth={1} opacity={0.6} />
            <line x1={M.left} x2={W - M.right} y1={sy(query.y)} y2={sy(query.y)} stroke="var(--text-2)" strokeWidth={1} opacity={0.6} />
          </g>
        )}

        {/* neighbour links */}
        {query &&
          points
            .filter((p) => p.emphasis)
            .map((p) => (
              <line key={`l${p.id}`} x1={sx(query.x)} y1={sy(query.y)} x2={sx(p.x)} y2={sy(p.y)} stroke="var(--text-2)" strokeWidth={1} opacity={0.5} />
            ))}

        {drawOrder.map((i) => {
          const p = points[i];
          return (
            <g key={p.id} opacity={p.dim ? 0.28 : 1}>
              {p.emphasis && <circle cx={sx(p.x)} cy={sy(p.y)} r={9} fill="none" stroke="var(--text)" strokeWidth={1.5} />}
              <Mark cat={p.cat} cx={sx(p.x)} cy={sy(p.y)} />
            </g>
          );
        })}

        {query && (
          <g aria-hidden>
            <circle cx={sx(query.x)} cy={sy(query.y)} r={9} fill="none" stroke="var(--surface-1)" strokeWidth={5} />
            <circle cx={sx(query.x)} cy={sy(query.y)} r={9} fill="none" stroke="var(--text)" strokeWidth={2} />
            <circle cx={sx(query.x)} cy={sy(query.y)} r={2.5} fill="var(--text)" />
          </g>
        )}

        {ap && <circle cx={sx(ap.x)} cy={sy(ap.y)} r={11} fill="none" stroke="var(--focus)" strokeWidth={2} />}
      </svg>
      {ap && (
        <div
          className="chart-tooltip"
          role="status"
          style={{
            left: `${Math.min(70, (sx(ap.x) / W) * 100)}%`,
            top: `${(sy(ap.y) / H) * 100}%`,
            transform: 'translate(12px, 12px)',
          }}
        >
          {coincident.slice(0, 4).map((p) => (
            <div key={p.id} style={{ marginBottom: 4 }}>
              <div className="tt-value">
                <span className="tt-key" style={{ background: `var(--series-${p.cat})` }} />
                {p.title}
              </div>
              {p.rows.map(([k, v]) => (
                <div className="tt-row" key={k}>
                  {k}: <span style={{ color: 'var(--text)' }}>{v}</span>
                </div>
              ))}
            </div>
          ))}
          {coincident.length > 4 && <div className="tt-row">+{coincident.length - 4} more tests at this point</div>}
        </div>
      )}
      <figcaption className="row small muted" style={{ marginTop: 6 }}>
        <span>Hover or focus the chart and use arrow keys to step through tests.</span>
        <span className="spacer" />
        <button type="button" className="ghost small" onClick={() => setShowTable((s) => !s)} aria-expanded={showTable}>
          {showTable ? 'Hide table' : 'Show as table'}
        </button>
      </figcaption>
      {showTable && (
        <div className="table-wrap" style={{ maxHeight: 280, marginTop: 8 }}>
          <table>
            <thead>
              <tr>
                <th>Test</th>
                <th className="num">{xLabel}</th>
                <th className="num">{yLabel}</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {order.map((i) => {
                const p = points[i];
                return (
                  <tr key={p.id}>
                    <td>{p.title}</td>
                    <td className="num">{p.x}</td>
                    <td className="num">{p.y}</td>
                    <td>{labels[p.cat]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
