import { useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { niceTicks } from './ScatterPlot';
import { fmtNum, fmtPct } from './ui';
import type { FuelPhase, Investigation, Mission, Range, TestRow } from '../lib/types';

const PHASE_COLOR: Record<string, string> = { solid: 'var(--series-burn)', liquid: 'var(--series-noburn)', gas: 'var(--series-other)' };
const PHASE_LABEL: Record<string, string> = { solid: 'Solid fuels', liquid: 'Liquid droplets', gas: 'Gas flames' };
const PHASES: FuelPhase[] = ['solid', 'liquid', 'gas'];

/** Sea-level oxygen partial pressure: 20.95 % of 101.325 kPa. */
export const PO2_SEA_LEVEL = 21.2;

const SHORT: Record<string, string> = {
  iss: 'ISS', spacecraft: 'Crew capsule', 'lunar-base': 'Lunar habitat', 'lunar-rover': 'Lunar rover', 'mars-base': 'Mars habitat', 'eva-suit': 'EVA suit',
};

// ---------------------------------------------------------------- atmosphere map

interface Cell { o2: number; p: number; n: number; phase: string; invs: Set<string> }

/**
 * Every microgravity test with a recorded atmosphere, on the O₂ fraction × total pressure plane, with the mission
 * atmospheres on top. Curves are lines of constant oxygen partial pressure (Dalton: pO₂ = x·P), which is exact.
 */
export function AtmosphereMap({
  tests, missions, selected, onPick, phase,
}: {
  tests: TestRow[];
  missions: Mission[];
  selected: { o2Pct: number; pressureKpa: number; label: string };
  onPick?: (m: Mission) => void;
  phase: FuelPhase | 'any';
}) {
  const W = 760;
  const H = 400;
  const M = { top: 18, right: 18, bottom: 46, left: 54 };
  const xd: [number, number] = [8, 102];
  const yd: [number, number] = [0, 118];
  const sx = (v: number) => M.left + ((v - xd[0]) / (xd[1] - xd[0])) * (W - M.left - M.right);
  const sy = (v: number) => H - M.bottom - ((v - yd[0]) / (yd[1] - yd[0])) * (H - M.top - M.bottom);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; title: string; rows: string[] } | null>(null);

  const { cells, offScale, total } = useMemo(() => {
    const map = new Map<string, Cell>();
    let off = 0;
    let tot = 0;
    for (const t of tests) {
      if (t.o2Pct === null || t.pressureKpa === null || !t.fuelPhase) continue;
      if (t.gravityG !== null && t.gravityG > 0.01) continue;
      tot += 1;
      if (t.pressureKpa > yd[1]) { off += 1; continue; }
      const o2 = Math.round(t.o2Pct / 2) * 2;
      const p = Math.round(t.pressureKpa / 5) * 5;
      const key = `${t.fuelPhase}|${o2}|${p}`;
      const c = map.get(key) ?? { o2, p, n: 0, phase: t.fuelPhase, invs: new Set<string>() };
      c.n += 1;
      c.invs.add(t.inv);
      map.set(key, c);
    }
    return { cells: [...map.values()].sort((a, b) => b.n - a.n), offScale: off, total: tot };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tests]);

  const groups = useMemo(() => {
    const g = new Map<string, Mission[]>();
    for (const m of missions) {
      if (m.o2Pct === null || m.pressureKpa === null) continue;
      const k = `${m.o2Pct}|${m.pressureKpa}`;
      g.set(k, [...(g.get(k) ?? []), m]);
    }
    return [...g.values()];
  }, [missions]);

  const iso = (po2: number) => {
    const pts: string[] = [];
    for (let x = xd[0]; x <= xd[1]; x += 1) {
      const p = (po2 * 100) / x;
      if (p <= yd[1] && p >= yd[0]) pts.push(`${sx(x).toFixed(1)},${sy(p).toFixed(1)}`);
    }
    return pts.join(' ');
  };
  const r = (n: number) => Math.min(15, 2.2 + 1.5 * Math.sqrt(n));

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const k = W / rect.width;
    const px = (e.clientX - rect.left) * k;
    const py = (e.clientY - rect.top) * k;
    for (const g of groups) {
      const m = g[0];
      if (Math.hypot(sx(m.o2Pct!) - px, sy(m.pressureKpa!) - py) < 16) {
        const po2 = (m.o2Pct! * m.pressureKpa!) / 100;
        setHover({
          x: sx(m.o2Pct!), y: sy(m.pressureKpa!), title: g.map((x) => SHORT[x.id] ?? x.label).join(' · '),
          rows: [`${fmtNum(m.o2Pct)} % O₂ at ${fmtNum(m.pressureKpa)} kPa`, `pO₂ ${fmtNum(po2)} kPa (${(po2 / PO2_SEA_LEVEL).toFixed(2)}× sea level)`, onPick ? 'Click to use this atmosphere' : ''],
        });
        return;
      }
    }
    let best: Cell | null = null;
    let bd = 20;
    for (const c of cells) {
      if (phase !== 'any' && c.phase !== phase) continue;
      const d = Math.hypot(sx(c.o2) - px, sy(c.p) - py);
      if (d < bd) { bd = d; best = c; }
    }
    setHover(best ? {
      x: sx(best.o2), y: sy(best.p), title: `${best.n} ${best.phase} test${best.n === 1 ? '' : 's'}`,
      rows: [`≈ ${best.o2} % O₂ at ≈ ${best.p} kPa`, [...best.invs].join(', ')],
    } : null);
  }

  return (
    <figure className="chart scroll">
      <div className="legend" aria-hidden>
        {PHASES.map((p) => (
          <span key={p} style={{ opacity: phase === 'any' || phase === p ? 1 : 0.4 }}><i style={{ background: PHASE_COLOR[p], borderRadius: '50%' }} /> {PHASE_LABEL[p]}</span>
        ))}
        <span>
          <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke="#fff" strokeWidth="1.6" /></svg> Mission atmosphere
        </span>
        <span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="var(--text-2)" strokeDasharray="4 3" /></svg> Constant O₂ partial pressure</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Map of ${total} microgravity tests by oxygen concentration and total pressure, with ${missions.length} mission atmospheres overlaid. Selected: ${selected.label} at ${selected.o2Pct}% oxygen and ${selected.pressureKpa} kPa.`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          if (!onPick) return;
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect) return;
          const k = W / rect.width;
          const px = (e.clientX - rect.left) * k;
          const py = (e.clientY - rect.top) * k;
          const g = groups.find((gr) => Math.hypot(sx(gr[0].o2Pct!) - px, sy(gr[0].pressureKpa!) - py) < 16);
          if (g) onPick(g.find((m) => SHORT[m.id] !== selected.label && m.label !== selected.label) ?? g[0]);
        }}
        style={{ cursor: hover && onPick && hover.rows[2] ? 'pointer' : 'default' }}
      >
        {niceTicks(yd[0], yd[1], 6).map((t) => (
          <g key={`y${t}`}>
            <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" />
            <text x={M.left - 10} y={sy(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--muted)">{t}</text>
          </g>
        ))}
        {niceTicks(10, 100, 9).map((t) => (
          <text key={`x${t}`} x={sx(t)} y={H - M.bottom + 18} textAnchor="middle" fontSize="11" fill="var(--muted)">{t}</text>
        ))}
        <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke="var(--axis)" />
        <text x={(M.left + W - M.right) / 2} y={H - 6} textAnchor="middle" fontSize="12" fill="var(--text-2)">Oxygen concentration (% by volume)</text>
        <text transform={`translate(14 ${(M.top + H - M.bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fill="var(--text-2)">Total pressure (kPa)</text>

        {/* lines of constant oxygen partial pressure */}
        {[PO2_SEA_LEVEL, 35, 60].map((po2, i) => {
          const lx = 56;
          return (
            <g key={po2} aria-hidden>
              <polyline points={iso(po2)} fill="none" stroke={i === 0 ? 'var(--text)' : 'var(--text-2)'} strokeWidth={i === 0 ? 1.4 : 1} strokeDasharray="5 4" opacity={i === 0 ? 0.75 : 0.35} />
              <text x={sx(lx) + 4} y={sy((po2 * 100) / lx) - 8} fontSize="10.5" fill="var(--text-2)" opacity={i === 0 ? 1 : 0.7}>
                {i === 0 ? `pO₂ ${po2} kPa · same as sea-level air` : `pO₂ ${po2} kPa`}
              </text>
            </g>
          );
        })}

        {cells.map((c) => (
          <circle
            key={`${c.phase}${c.o2}|${c.p}`}
            cx={sx(c.o2)} cy={sy(c.p)} r={r(c.n)}
            fill={PHASE_COLOR[c.phase]} fillOpacity={phase === 'any' || phase === c.phase ? 0.6 : 0.1}
            stroke={PHASE_COLOR[c.phase]} strokeOpacity={phase === 'any' || phase === c.phase ? 0.95 : 0.2} strokeWidth={1}
          />
        ))}

        {groups.map((g) => {
          const m = g[0];
          const x = sx(m.o2Pct!);
          const y = sy(m.pressureKpa!);
          const isSel = g.some((mm) => Math.abs(mm.o2Pct! - selected.o2Pct) < 0.01 && Math.abs(mm.pressureKpa! - selected.pressureKpa) < 0.01);
          const right = m.o2Pct! > 80;
          return (
            <g key={m.id}>
              <circle cx={x} cy={y} r={isSel ? 9 : 7} fill="rgba(0,0,0,0.55)" stroke="#fff" strokeWidth={isSel ? 2.4 : 1.5} />
              {isSel && <circle cx={x} cy={y} r={3} fill="#fff" />}
              <text
                x={x + (right ? -14 : 14)} y={y} dy="0.32em" textAnchor={right ? 'end' : 'start'} fontSize="12" fontWeight={isSel ? 600 : 500} fill="#fff"
                stroke="var(--surface-1)" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round"
              >
                {g.map((x2) => SHORT[x2.id] ?? x2.label).join(' · ')}
              </text>
            </g>
          );
        })}
        {!groups.some((g) => g.some((mm) => Math.abs(mm.o2Pct! - selected.o2Pct) < 0.01 && Math.abs(mm.pressureKpa! - selected.pressureKpa) < 0.01)) &&
          selected.pressureKpa <= yd[1] && (
            <g>
              <circle cx={sx(selected.o2Pct)} cy={sy(selected.pressureKpa)} r={9} fill="rgba(0,0,0,0.55)" stroke="var(--brand)" strokeWidth={2.4} />
              <circle cx={sx(selected.o2Pct)} cy={sy(selected.pressureKpa)} r={3} fill="var(--brand)" />
              <text x={sx(selected.o2Pct) + 14} y={sy(selected.pressureKpa)} dy="0.32em" fontSize="12" fontWeight={600} fill="#fff" stroke="var(--surface-1)" strokeWidth={4} paintOrder="stroke">
                {selected.label}
              </text>
            </g>
          )}
      </svg>
      {hover && (
        <div className="chart-tooltip" role="status" style={{ left: `${Math.min(68, (hover.x / W) * 100)}%`, top: `${(hover.y / H) * 100}%`, transform: 'translate(14px, 14px)' }}>
          <div className="tt-value">{hover.title}</div>
          {hover.rows.filter(Boolean).map((x) => <div className="tt-row" key={x}>{x}</div>)}
        </div>
      )}
      <figcaption>
        Each dot groups the tests within ±1 % O₂ and ±2.5 kPa; area grows with the number of tests. {total} microgravity tests report both values
        {offScale > 0 ? `; ${offScale} above ${yd[1]} kPa are off the scale` : ''}. Dashed curves join atmospheres with the same oxygen partial
        pressure (pO₂ = O₂ fraction × total pressure).
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- partial-pressure bar

/** Dalton's law, drawn to scale: how much of the total pressure is oxygen, against sea-level air. */
export function AtmosphereBar({ o2Pct, pressureKpa }: { o2Pct: number; pressureKpa: number }) {
  const po2 = (o2Pct * pressureKpa) / 100;
  const max = Math.max(101.325, pressureKpa);
  const Row = ({ label, o2, p }: { label: string; o2: number; p: number }) => {
    const pp = (o2 * p) / 100;
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '74px 1fr', gap: 10, alignItems: 'center' }}>
        <span className="small muted">{label}</span>
        <div style={{ display: 'flex', height: 18, width: `${(p / max) * 100}%`, minWidth: 4, borderRadius: 5, overflow: 'hidden', transition: 'width .4s var(--ease)' }}>
          <div style={{ width: `${(pp / p) * 100}%`, background: 'var(--accent)', transition: 'width .4s var(--ease)' }} title={`O₂ ${fmtNum(pp)} kPa`} />
          <div style={{ flex: 1, background: 'var(--fill-strong)' }} title={`Diluent (N₂) ${fmtNum(p - pp)} kPa`} />
        </div>
      </div>
    );
  };
  return (
    <div role="img" aria-label={`Oxygen partial pressure ${fmtNum(po2)} kPa of ${fmtNum(pressureKpa)} kPa total, ${(po2 / PO2_SEA_LEVEL).toFixed(2)} times sea level.`}>
      <div className="stack tight">
        <Row label="This cabin" o2={o2Pct} p={pressureKpa} />
        <Row label="Sea level" o2={20.95} p={101.325} />
      </div>
      <p className="small muted" style={{ margin: '10px 0 0' }}>
        <span style={{ color: 'var(--accent)' }}>■</span> O₂ partial pressure <strong style={{ color: 'var(--text)' }}>{fmtNum(po2)} kPa</strong> ={' '}
        {(po2 / PO2_SEA_LEVEL).toFixed(2)}× sea level · <span style={{ color: 'var(--muted)' }}>■</span> diluent {fmtNum(Math.max(0, pressureKpa - po2))} kPa
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- vote bar

/** Share of the weighted neighbour vote that says "flame sustained", with its interval. */
export function VoteBar({ p, interval, unbounded }: { p: number | null; interval?: [number, number] | null; unbounded?: boolean }) {
  if (p === null) return null;
  return (
    <div aria-hidden style={{ margin: '14px 0 6px' }}>
      <div style={{ position: 'relative', height: 12, borderRadius: 6, background: 'var(--series-noburn)', overflow: 'hidden', opacity: unbounded ? 0.55 : 1 }}>
        <div style={{ position: 'absolute', inset: '0 auto 0 0', width: `${p * 100}%`, background: 'var(--series-burn)', transition: 'width .4s var(--ease)' }} />
      </div>
      {interval && !unbounded && (
        <div style={{ position: 'relative', height: 8 }}>
          <div style={{ position: 'absolute', top: 3, left: `${interval[0] * 100}%`, width: `${(interval[1] - interval[0]) * 100}%`, height: 2, background: 'var(--text)', borderRadius: 1, transition: 'all .4s var(--ease)' }} />
        </div>
      )}
      <div className="row small muted" style={{ justifyContent: 'space-between', marginTop: 2 }}>
        <span><span style={{ color: 'var(--series-burn)' }}>●</span> flame sustained {fmtPct(p)}</span>
        <span>extinguished / no ignition {fmtPct(1 - p)} <span style={{ color: 'var(--series-noburn)' }}>●</span></span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tested-range strips

export interface StripRow { id: string; label: string; phase: string | null; range: Range | undefined; assumed?: boolean }

/** One row per investigation: the tested range on a shared axis, with the mission value as a line. */
export function RangeStrips({
  rows, unit, mark, markLabel, log, title, width = 720,
}: { rows: StripRow[]; unit: string; mark?: number | [number, number] | null; markLabel?: string; log?: boolean; title: string; width?: number }) {
  const have = rows.filter((r) => r.range);
  const W = width;
  const ROW = 24;
  const M = { top: 26, right: 20, bottom: 34, left: W < 500 ? 96 : 118 };
  const H = M.top + M.bottom + rows.length * ROW;
  const markVals = mark === null || mark === undefined ? [] : Array.isArray(mark) ? mark : [mark];
  const vals = [...have.flatMap((r) => r.range as [number, number]), ...markVals];
  if (!vals.length) return <p className="small muted">No documented {title.toLowerCase()} ranges.</p>;
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const useLog = !!log && lo > 0 && hi / lo > 4;
  if (useLog) { lo = lo / 1.25; hi = hi * 1.25; } else { const pad = (hi - lo || 1) * 0.06; lo = Math.max(0, lo - pad); hi = hi + pad; }
  const f = (v: number) => (useLog ? Math.log(v) : v);
  const sx = (v: number) => M.left + ((f(v) - f(lo)) / (f(hi) - f(lo))) * (W - M.left - M.right);
  const ticks = useLog ? [10, 20, 50, 100, 200, 500, 1000].filter((t) => t >= lo && t <= hi) : niceTicks(lo, hi, W < 500 ? 4 : 7);
  return (
    <figure className={W > 600 ? 'chart scroll' : 'chart'}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: tested range per investigation${markLabel ? `, with ${markLabel} marked` : ''}.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={sx(t)} x2={sx(t)} y1={M.top - 4} y2={H - M.bottom} stroke="var(--grid)" />
            <text x={sx(t)} y={H - M.bottom + 16} textAnchor="middle" fontSize="11" fill="var(--muted)">{t}</text>
          </g>
        ))}
        <text x={W - M.right} y={H - 2} textAnchor="end" fontSize="11" fill="var(--muted)">{title} ({unit}){useLog ? ' · log scale' : ''}</text>
        {markVals.length === 2 && markVals[0] !== markVals[1] && (
          <rect x={sx(markVals[0])} width={Math.max(2, sx(markVals[1]) - sx(markVals[0]))} y={M.top - 4} height={H - M.top - M.bottom + 4} fill="#fff" opacity={0.08} />
        )}
        {(markVals.length === 1 || markVals[0] === markVals[1]) && markVals.length > 0 && (
          <line x1={sx(markVals[0])} x2={sx(markVals[0])} y1={M.top - 4} y2={H - M.bottom} stroke="#fff" strokeWidth={1.5} />
        )}
        {markVals.length > 0 && markLabel && (
          <text x={Math.min(W - M.right, Math.max(M.left + 30, (sx(markVals[0]) + sx(markVals[markVals.length - 1])) / 2))} y={M.top - 10} textAnchor="middle" fontSize="11" fontWeight={600} fill="#fff">{markLabel}</text>
        )}
        {rows.map((r, i) => {
          const y = M.top + i * ROW + ROW / 2;
          const c = PHASE_COLOR[r.phase ?? ''] ?? 'var(--neutral)';
          return (
            <g key={r.id}>
              <text x={M.left - 12} y={y} dy="0.32em" textAnchor="end" fontSize="11.5" fill="var(--text-2)">{r.label}</text>
              {r.range ? (
                r.range[0] === r.range[1] ? (
                  <circle cx={sx(r.range[0])} cy={y} r={5} fill={c} opacity={r.assumed ? 0.45 : 1} />
                ) : (
                  <rect x={sx(r.range[0])} width={Math.max(4, sx(r.range[1]) - sx(r.range[0]))} y={y - 5} height={10} rx={5} fill={c} opacity={r.assumed ? 0.45 : 0.9} />
                )
              ) : (
                <text x={M.left} y={y} dy="0.32em" fontSize="10.5" fill="var(--muted)">not documented</text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function stripRowsFor(invs: Investigation[], boxes: Map<string, Partial<Record<string, Range>>>, dim: 'o2Pct' | 'pressureKpa' | 'flowCmS'): StripRow[] {
  return invs.map((i) => ({ id: i.id, label: i.id, phase: i.fuelPhase, range: boxes.get(i.id)?.[dim], assumed: i.conditions?.assumed?.includes(dim) }));
}

export function PhaseLegend({ extra }: { extra?: ReactNode }) {
  return (
    <div className="legend" aria-hidden>
      {PHASES.map((p) => <span key={p}><i style={{ background: PHASE_COLOR[p] }} /> {PHASE_LABEL[p]}</span>)}
      {extra}
    </div>
  );
}

// ---------------------------------------------------------------- d²-law

/**
 * Classical d²-law for a burning droplet: d(t)² = d₀² − K·t, so the lifetime is d₀² / K.
 * K is whatever the caller measured or estimated; nothing else is assumed.
 */
export function DropletChart({ k, d0, range }: { k: number; d0: number; range?: [number, number] | null }) {
  const W = 640;
  const H = 250;
  const M = { top: 54, right: 20, bottom: 42, left: 56 };
  const tb = (d0 * d0) / k;
  const kLo = range ? Math.min(...range) : k;
  const kHi = range ? Math.max(...range) : k;
  const tMax = Math.max(tb, kLo > 0 ? (d0 * d0) / kLo : tb) * 1.08;
  const sx = (t: number) => M.left + (t / tMax) * (W - M.left - M.right);
  const sy = (d2: number) => H - M.bottom - (d2 / (d0 * d0)) * (H - M.top - M.bottom);
  const pxPerMm = 30 / Math.max(d0, 1);
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`d-squared law: a ${d0} mm droplet with burning-rate constant ${k.toPrecision(2)} mm²/s burns out in ${tb.toFixed(1)} seconds.`}>
        {niceTicks(0, d0 * d0, 4).map((t) => (
          <g key={`y${t}`}>
            <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" />
            <text x={M.left - 10} y={sy(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--muted)">{t}</text>
          </g>
        ))}
        {niceTicks(0, tMax, 6).map((t) => (
          <text key={`x${t}`} x={sx(t)} y={H - M.bottom + 17} textAnchor="middle" fontSize="11" fill="var(--muted)">{t}</text>
        ))}
        <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke="var(--axis)" />
        <text x={(M.left + W - M.right) / 2} y={H - 6} textAnchor="middle" fontSize="12" fill="var(--text-2)">Time since ignition (s)</text>
        <text transform={`translate(14 ${(M.top + H - M.bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fill="var(--text-2)">d² (mm²)</text>
        {range && kLo !== kHi && kLo > 0 && (
          <polygon points={`${sx(0)},${sy(d0 * d0)} ${sx((d0 * d0) / kHi)},${sy(0)} ${sx((d0 * d0) / kLo)},${sy(0)}`} fill="var(--series-noburn)" opacity={0.16} />
        )}
        <line x1={sx(0)} y1={sy(d0 * d0)} x2={sx(tb)} y2={sy(0)} stroke="var(--series-noburn)" strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={sx(tb)} cy={sy(0)} r={4.5} fill="var(--series-noburn)" stroke="var(--surface-1)" strokeWidth={2} />
        <text x={sx(tb)} y={sy(0) - 12} textAnchor="middle" fontSize="12" fontWeight={600} fill="var(--text)">burn-out {tb.toFixed(1)} s</text>
        {/* the droplet itself, to scale, at 0 / 25 / 50 / 75 % of its lifetime */}
        {[0, 0.25, 0.5, 0.75].map((fr) => {
          const d = d0 * Math.sqrt(1 - fr);
          return (
            <g key={fr}>
              <circle cx={sx(fr * tb)} cy={24} r={Math.max(1.5, (d * pxPerMm) / 2)} fill="var(--series-noburn)" fillOpacity={0.35} stroke="var(--series-noburn)" />
              <text x={sx(fr * tb) + (d * pxPerMm) / 2 + 6} y={24} dy="0.32em" fontSize="10.5" fill="var(--text-2)">{d.toFixed(2)} mm</text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        d² falls linearly with time (d² = d₀² − K·t), so a droplet’s lifetime is d₀²/K. Droplets are drawn to scale. Real droplets can
        extinguish before burn-out, which this line does not show.
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- accuracy vs baseline

export interface BaselineRow { label: string; accuracy: number; baseline: number; n: number; note?: string }

export function BaselineBars({ rows }: { rows: BaselineRow[] }) {
  return (
    <div className="bars">
      {rows.map((r) => {
        const below = r.accuracy < r.baseline;
        return (
          <div className="bar-row" key={r.label}>
            <div className="bar-head">
              <span>{r.label}{r.note && <span className="muted"> · {r.note}</span>}</span>
              <span>
                <strong style={{ color: below ? 'var(--serious)' : 'var(--text)' }}>{fmtPct(r.accuracy)}</strong> vs {fmtPct(r.baseline)} baseline · n={r.n}
              </span>
            </div>
            <div className="bar-track" role="img" aria-label={`${r.label}: accuracy ${fmtPct(r.accuracy)}, baseline ${fmtPct(r.baseline)}, ${r.n} tests`}>
              <div className={`bar-fill${below ? ' below' : ''}`} style={{ width: `${r.accuracy * 100}%` }} />
              <div className="bar-mark" style={{ left: `calc(${r.baseline * 100}% - 1px)` }} />
            </div>
          </div>
        );
      })}
      <div className="legend" style={{ margin: 0 }} aria-hidden>
        <span><i style={{ background: 'var(--series-1)' }} /> EMBER accuracy</span>
        <span><i style={{ background: 'var(--serious)' }} /> below baseline</span>
        <span><i style={{ background: '#fff', width: 2, height: 12, borderRadius: 1 }} /> majority baseline</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- buoyant flow scaling

/**
 * Buoyancy-induced flow speed near a flame scales as u_b ∝ (g·α·ΔT/T∞)^⅓, so relative to Earth it is g^⅓.
 * Only the ratio is drawn, because the absolute value depends on flame size and temperature.
 */
export function BuoyancyChart({ g }: { g: number }) {
  const W = 640;
  const H = 260;
  const M = { top: 20, right: 24, bottom: 44, left: 56 };
  const sx = (v: number) => M.left + v * (W - M.left - M.right);
  const sy = (v: number) => H - M.bottom - v * (H - M.top - M.bottom);
  const pts: string[] = [];
  for (let i = 0; i <= 100; i++) { const x = (i / 100) ** 2; pts.push(`${sx(x).toFixed(1)},${sy(Math.cbrt(x)).toFixed(1)}`); }
  const marks: [number, string][] = [[0.166, 'Moon'], [0.38, 'Mars'], [1, 'Earth']];
  const custom = !marks.some(([m]) => Math.abs(m - g) < 0.01) && g > 0.01;
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Buoyant flow speed relative to Earth scales as the cube root of gravity: ${fmtPct(Math.cbrt(0.166))} on the Moon and ${fmtPct(Math.cbrt(0.38))} on Mars.`}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" />
            <text x={M.left - 10} y={sy(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--muted)">{t * 100}%</text>
            <text x={sx(t)} y={H - M.bottom + 17} textAnchor="middle" fontSize="11" fill="var(--muted)">{t}</text>
          </g>
        ))}
        <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke="var(--axis)" />
        <text x={(M.left + W - M.right) / 2} y={H - 6} textAnchor="middle" fontSize="12" fill="var(--text-2)">Gravity (g)</text>
        <text transform={`translate(14 ${(M.top + H - M.bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fill="var(--text-2)">Buoyant flow vs Earth</text>
        <polyline points={pts.join(' ')} fill="none" stroke="var(--series-burn)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {[...marks, ...(custom ? [[g, 'Mission'] as [number, string]] : [])].map(([m, l]) => (
          <g key={l}>
            <line x1={sx(m)} x2={sx(m)} y1={sy(Math.cbrt(m))} y2={H - M.bottom} stroke="var(--text-2)" strokeDasharray="3 3" opacity={0.5} />
            <circle cx={sx(m)} cy={sy(Math.cbrt(m))} r={5} fill="var(--series-burn)" stroke="var(--surface-1)" strokeWidth={2} />
            <text x={sx(m) + (m > 0.9 ? -10 : 10)} y={sy(Math.cbrt(m)) + 18} textAnchor={m > 0.9 ? 'end' : 'start'} fontSize="12" fill="var(--text)">
              <tspan fontWeight={600}>{l}</tspan> {fmtPct(Math.cbrt(m))}
            </text>
          </g>
        ))}
      </svg>
      <figcaption>
        Scaling law, not data: u<sub>b</sub> ∝ (g·α·ΔT/T<sub>∞</sub>)<sup>⅓</sup>. At one-sixth of Earth gravity the buoyant draught is still more
        than half as fast as on Earth, which is why partial gravity is not “almost microgravity” for a flame.
      </figcaption>
    </figure>
  );
}
