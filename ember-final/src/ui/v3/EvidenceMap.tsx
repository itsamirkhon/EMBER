import { useMemo, useRef, useState, type PointerEvent } from 'react';
import type { FuelPhase, Mission } from '../../core';
import { MISSION_SHORT, fmt, type Cliff, type InvBrief, type Row } from './data';

/** Colour per investigation, one family per fuel phase: pine = solid, teal-green = liquid, olive = gas.
 *  Highlighter chartreuse is kept for the evidence cliff alone. */
export const INV_COLOR: Record<string, string> = {
  BASS: '#10302a',
  'BASS-II': '#2c5546',
  'Saffire-I': '#4f7a68',
  'Saffire-II': '#1b4637',
  'Saffire-III': '#6b9483',
  SAME: '#80958a',
  'SAME-R': '#a3b3a8',
  FLEX: '#2e8a7c',
  'FLEX-2': '#62b3a6',
  CFI: '#1f6b60',
  'ACME-BRE': '#8a9a2a',
  'ACME-CFI-G': '#6a7a14',
  'ACME-E-FIELD': '#aab84e',
  SPICE: '#7d7a12',
  SLICE: '#b5b062',
};
export const invColor = (id: string) => INV_COLOR[id] ?? '#6c8076';

const PHASE_LABEL: Record<FuelPhase, string> = { solid: 'Solid materials', liquid: 'Liquid droplets', gas: 'Gas flames' };

export function PhaseMark({ phase, x, y, r, fill, stroke, hollow, opacity = 1 }: { phase: FuelPhase | null; x: number; y: number; r: number; fill: string; stroke?: string; hollow?: boolean; opacity?: number }) {
  const common = { fill: hollow ? 'none' : fill, fillOpacity: hollow ? 0 : 0.78 * opacity, stroke: stroke ?? fill, strokeOpacity: opacity, strokeWidth: hollow ? 1.6 : 1 };
  if (phase === 'liquid') {
    const s = r * 1.15;
    return <path d={`M${x},${y - s}L${x + s},${y}L${x},${y + s}L${x - s},${y}Z`} {...common} />;
  }
  if (phase === 'gas') {
    const s = r * 1.25;
    return <path d={`M${x},${y - s}L${x + s * 0.95},${y + s * 0.7}L${x - s * 0.95},${y + s * 0.7}Z`} {...common} />;
  }
  return <circle cx={x} cy={y} r={r} {...common} />;
}

interface Cell { key: string; inv: string; phase: FuelPhase | null; o2: number; kPa: number; n: number; assumed: boolean; fuels: Set<string> }

export interface EvidenceMapProps {
  rows: Row[];
  investigations: InvBrief[];
  missions: Mission[];
  cliff: Cliff;
  phase: FuelPhase | 'all';
  highlight?: string | null;
  selected?: { o2: number; kPa: number; label: string } | null;
  onPickMission?: (m: Mission) => void;
  compact?: boolean;
}

const W = 900;
const H = 470;
const M = { top: 24, right: 22, bottom: 50, left: 58 };
const XD: [number, number] = [8, 102];
const YD: [number, number] = [0, 118];
const sx = (v: number) => M.left + ((v - XD[0]) / (XD[1] - XD[0])) * (W - M.left - M.right);
const sy = (v: number) => H - M.bottom - ((v - YD[0]) / (YD[1] - YD[0])) * (H - M.top - M.bottom);
const PO2_SEA = 21.2;

export function EvidenceMap({ rows, investigations, missions, cliff, phase, highlight, selected, onPickMission }: EvidenceMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; title: string; lines: string[] } | null>(null);
  const names = useMemo(() => new Map(investigations.map((i) => [i.id, i.name])), [investigations]);

  const { cells, off, total } = useMemo(() => {
    const map = new Map<string, Cell>();
    let offScale = 0;
    let n = 0;
    for (const r of rows) {
      if (r.o2 === null || r.kPa === null) continue;
      if (r.g !== null && r.g > 0.01) continue;
      n += 1;
      if (r.kPa > YD[1]) {
        offScale += 1;
        continue;
      }
      const o2 = Math.round(r.o2);
      const kPa = Math.round(r.kPa / 2.5) * 2.5;
      const key = `${r.inv}|${o2}|${kPa}`;
      const c = map.get(key) ?? { key, inv: r.inv, phase: r.phase, o2, kPa, n: 0, assumed: r.o2Prov === 'assumed' || r.kPaProv === 'assumed', fuels: new Set<string>() };
      c.n += 1;
      if (r.fuel) c.fuels.add(r.fuel);
      map.set(key, c);
    }
    return { cells: [...map.values()].sort((a, b) => b.n - a.n), off: offScale, total: n };
  }, [rows]);

  const groups = useMemo(() => {
    const g = new Map<string, Mission[]>();
    for (const m of missions) {
      if (m.o2Pct === null || m.pressureKpa === null) continue;
      const k = `${m.o2Pct}|${m.pressureKpa}`;
      g.set(k, [...(g.get(k) ?? []), m]);
    }
    return [...g.values()];
  }, [missions]);

  const visible = (c: Cell) => phase === 'all' || c.phase === phase;
  const lit = (c: Cell) => visible(c) && (!highlight || c.inv === highlight);
  const r = (n: number) => Math.min(16, 3 + 1.7 * Math.sqrt(n));
  const iso = (po2: number) => {
    const pts: string[] = [];
    for (let x = XD[0]; x <= XD[1]; x += 0.5) {
      const p = (po2 * 100) / x;
      if (p <= YD[1] && p >= YD[0]) pts.push(`${sx(x).toFixed(1)},${sy(p).toFixed(1)}`);
    }
    return pts.join(' ');
  };

  function locate(e: PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const k = W / rect.width;
    return { px: (e.clientX - rect.left) * k, py: (e.clientY - rect.top) * k };
  }
  function missionAt(px: number, py: number) {
    return groups.find((g) => Math.hypot(sx(g[0].o2Pct as number) - px, sy(g[0].pressureKpa as number) - py) < 18) ?? null;
  }

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const p = locate(e);
    if (!p) return;
    const g = missionAt(p.px, p.py);
    if (g) {
      const m = g[0];
      const po2 = ((m.o2Pct as number) * (m.pressureKpa as number)) / 100;
      setHover({
        x: sx(m.o2Pct as number), y: sy(m.pressureKpa as number),
        title: g.map((x) => x.label).join(' · '),
        lines: [`${fmt(m.o2Pct)}% O₂ at ${fmt(m.pressureKpa)} kPa · ${fmt(m.gravityG, 3)} g`, `O₂ partial pressure ${fmt(po2)} kPa (${(po2 / PO2_SEA).toFixed(2)}× sea level)`, onPickMission ? 'Click to check this cabin' : ''],
      });
      return;
    }
    let best: Cell | null = null;
    let bd = 22;
    for (const c of cells) {
      if (!lit(c)) continue;
      const d = Math.hypot(sx(c.o2) - p.px, sy(c.kPa) - p.py);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    setHover(
      best
        ? {
            x: sx(best.o2), y: sy(best.kPa),
            title: `${best.inv} · ${best.n} test${best.n === 1 ? '' : 's'}`,
            lines: [
              names.get(best.inv) ?? '',
              `≈ ${best.o2}% O₂ at ≈ ${best.kPa} kPa`,
              [...best.fuels].slice(0, 4).join(', '),
              best.assumed ? 'At least one atmospheric value is assumed rather than reported' : '',
            ],
          }
        : null,
    );
  }

  const cliffX = sx(cliff.o2Max);
  const isSelected = (m: Mission) => !!selected && Math.abs((m.o2Pct ?? -1) - selected.o2) < 0.01 && Math.abs((m.pressureKpa ?? -1) - selected.kPa) < 0.01;
  const selectedIsMission = !!selected && groups.some((g) => g.some(isSelected));

  return (
    <figure className="v3-chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Evidence map: ${total} microgravity tests by oxygen concentration and pressure. Solid-material flight tests stop at ${fmt(cliff.o2Max)}% oxygen; lunar and Mars habitat atmospheres sit at 30 to 34% oxygen and 56 to 70 kPa.`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const p = locate(e);
          const g = p ? missionAt(p.px, p.py) : null;
          if (g && onPickMission) onPickMission(g[g.length > 1 && isSelected(g[0]) ? 1 : 0]);
        }}
      >
        {/* region beyond the solid-material flight evidence */}
        <rect x={cliffX} y={M.top} width={W - M.right - cliffX} height={H - M.top - M.bottom} fill="var(--v3-cliff)" fillOpacity={0.05} />
        <line x1={cliffX} x2={cliffX} y1={M.top} y2={H - M.bottom} stroke="var(--v3-cliff)" strokeWidth={1.5} />
        <text x={cliffX + 10} y={M.top + 16} fontSize="12.5" fontWeight={500} fill="var(--v3-cliff-text)">Evidence cliff · {fmt(cliff.o2Max)}% O₂</text>
        <text x={cliffX + 10} y={M.top + 33} fontSize="11.5" fill="var(--v3-text-2)">No solid-material flight test in PSI to the right of this line</text>

        {[0, 20, 40, 60, 80, 100].map((t) => (
          <g key={`y${t}`}>
            <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} stroke="var(--v3-grid)" />
            <text x={M.left - 10} y={sy(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--v3-muted)">{t}</text>
          </g>
        ))}
        {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((t) => (
          <text key={`x${t}`} x={sx(t)} y={H - M.bottom + 18} textAnchor="middle" fontSize="11" fill="var(--v3-muted)">{t}</text>
        ))}
        <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke="var(--v3-axis)" />
        <text x={(M.left + W - M.right) / 2} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--v3-text-2)">Oxygen (% by volume)</text>
        <text transform={`translate(15 ${(M.top + H - M.bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fill="var(--v3-text-2)">Total pressure (kPa)</text>

        {[PO2_SEA, 35].map((po2, i) => (
          <g key={po2} aria-hidden>
            <polyline points={iso(po2)} fill="none" stroke="var(--v3-text)" strokeWidth={i === 0 ? 1.2 : 0.9} strokeDasharray="4 4" opacity={i === 0 ? 0.45 : 0.22} />
            <text x={sx(70) + 4} y={sy((po2 * 100) / 70) - 7} fontSize="10.5" fill="var(--v3-muted)">
              {i === 0 ? `pO₂ ${po2} kPa — same oxygen as sea-level air` : `pO₂ ${po2} kPa`}
            </text>
          </g>
        ))}

        {cells.map((c) => (
          <PhaseMark
            key={c.key}
            phase={c.phase}
            x={sx(c.o2)}
            y={sy(c.kPa)}
            r={r(c.n)}
            fill={invColor(c.inv)}
            hollow={c.assumed}
            opacity={lit(c) ? 1 : 0.1}
          />
        ))}

        {groups.map((g) => {
          const m = g[0];
          const x = sx(m.o2Pct as number);
          const y = sy(m.pressureKpa as number);
          const sel = g.some(isSelected);
          const right = (m.o2Pct as number) > 80;
          return (
            <g key={m.id} style={{ cursor: onPickMission ? 'pointer' : 'default' }}>
              <circle cx={x} cy={y} r={sel ? 10 : 8} fill="var(--v3-bg)" stroke="var(--v3-text)" strokeWidth={sel ? 2.4 : 1.5} />
              {sel && <circle cx={x} cy={y} r={3.2} fill="var(--v3-text)" />}
              <text
                x={x + (right ? -15 : 15)} y={y} dy="0.32em" textAnchor={right ? 'end' : 'start'} fontSize="13" fontWeight={sel ? 600 : 500}
                fill="var(--v3-text)" stroke="var(--v3-surface)" strokeWidth={4.5} paintOrder="stroke" strokeLinejoin="round"
              >
                {g.map((x2) => MISSION_SHORT[x2.id] ?? x2.label).join(' · ')}
              </text>
            </g>
          );
        })}
        {selected && !selectedIsMission && selected.kPa <= YD[1] && (
          <g>
            <circle cx={sx(selected.o2)} cy={sy(selected.kPa)} r={10} fill="var(--v3-bg)" stroke="var(--v3-accent)" strokeWidth={2.4} />
            <circle cx={sx(selected.o2)} cy={sy(selected.kPa)} r={3.2} fill="var(--v3-accent)" />
            <text x={sx(selected.o2) + 15} y={sy(selected.kPa)} dy="0.32em" fontSize="13" fontWeight={600} fill="var(--v3-text)" stroke="var(--v3-surface)" strokeWidth={4.5} paintOrder="stroke">
              {selected.label}
            </text>
          </g>
        )}
      </svg>
      {hover && (
        <div className="v3-tip" role="status" style={{ left: `${Math.min(66, (hover.x / W) * 100)}%`, top: `${(hover.y / H) * 100}%` }}>
          <div className="v3-tip-title">{hover.title}</div>
          {hover.lines.filter(Boolean).map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
      )}
      <figcaption>
        {total.toLocaleString('en-US')} PSI flight records have oxygen and pressure values available (including inferred/assumed values).
        Records missing either are not plotted. Each mark groups tests within 1% O₂ and 2.5 kPa; larger marks contain more records
        {off ? `; ${off} records above ${YD[1]} kPa are off-scale` : ''}. Hollow marks: at least one atmospheric value was assumed.
        Dashed curves indicate equal oxygen partial pressure (pO₂ = O₂ fraction × pressure).
        {onPickMission && (
          <div className="v3-row v3-section" aria-label="Choose a mission scenario">
            {missions.filter((m) => m.o2Pct !== null && m.pressureKpa !== null).map((m) => (
              <button key={m.id} type="button" className="v3-btn v3-btn-ghost" onClick={() => onPickMission(m)}>
                {MISSION_SHORT[m.id] ?? m.label}
              </button>
            ))}
          </div>
        )}
      </figcaption>
    </figure>
  );
}

const PHASE_SWATCH: Record<FuelPhase, string> = { solid: 'var(--v3-solid)', liquid: 'var(--v3-liquid)', gas: 'var(--v3-gas)' };

export function MapLegend({ investigations, phase, highlight, onHighlight }: { investigations: InvBrief[]; phase: FuelPhase | 'all'; highlight: string | null; onHighlight: (id: string | null) => void }) {
  const byPhase: FuelPhase[] = ['solid', 'liquid', 'gas'];
  return (
    <div className="v3-stack">
      <div className="v3-legend">
        {byPhase.map((p) => (
          <span key={p} style={{ opacity: phase === 'all' || phase === p ? 1 : 0.4 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <PhaseMark phase={p} x={7} y={7.5} r={4.6} fill={PHASE_SWATCH[p]} />
            </svg>
            {PHASE_LABEL[p]}
          </span>
        ))}
        <span>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <circle cx="7" cy="7" r="5" fill="var(--v3-bg)" stroke="var(--v3-text)" strokeWidth="1.5" />
          </svg>
          Planned cabin
        </span>
        <span>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M7 1v12" stroke="var(--v3-cliff)" strokeWidth="1.5" />
          </svg>
          Evidence cliff
        </span>
      </div>
      <details className="v3-legend-more" open={!!highlight}>
        <summary>Highlight one experiment{highlight ? `: ${highlight}` : ''}</summary>
        <div className="v3-legend">
          {byPhase.map((p) => {
            const list = investigations.filter((i) => i.fuelPhase === p);
            if (!list.length) return null;
            return (
              <div key={p} className="v3-legend-group" style={{ opacity: phase === 'all' || phase === p ? 1 : 0.4 }}>
                <div className="v3-legend-head">{PHASE_LABEL[p]}</div>
                <div className="v3-legend-items">
                  {list.map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      className="v3-legend-item"
                      aria-pressed={highlight === i.id}
                      onClick={() => onHighlight(highlight === i.id ? null : i.id)}
                      title={i.name}
                    >
                      <i style={{ background: i.assumed.length ? 'transparent' : invColor(i.id), borderColor: invColor(i.id) }} />
                      {i.id}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}
