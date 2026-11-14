import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import ScatterPlot from '../components/ScatterPlot';
import { testToPoint } from '../components/testPoints';
import { useData, useEmber } from '../data/context';
import {
  DIM_LABEL, DIM_UNIT, estimate, estimateNumeric, kpaToPsi, TARGET_LABEL, TARGET_UNIT, targetValue,
  type NumericEstimate, type NumericTarget, type Query,
} from '../lib/evidence';
import type { FuelPhase, TestRow } from '../lib/types';
import { AnswerBadge, answerHelp, fmtGravity, fmtNum, fmtPct, PageHead, Term } from '../components/ui';

type GravityPool = 'micro' | 'ground' | 'all';

function Slider(props: { id: string; label: ReactNode; value: number; min: number; max: number; step: number; unit: string; extra?: string; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <div className="label-row">
        <label htmlFor={props.id}>{props.label}</label>
        <output htmlFor={props.id}>
          {fmtNum(props.value)} {props.unit}
          {props.extra && <span className="muted"> · {props.extra}</span>}
        </output>
      </div>
      <input id={props.id} type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
    </div>
  );
}

/** Which numeric results are meaningful for a fuel phase. */
const PHASE_TARGETS: Record<FuelPhase | 'any', NumericTarget[]> = {
  solid: ['spreadRateMmS'],
  liquid: ['burningRateMm2S'],
  gas: ['smokePointLengthMm'],
  any: ['spreadRateMmS', 'burningRateMm2S', 'smokePointLengthMm'],
};

function fmtValue(v: number | null, unit: string) {
  if (v === null) return '—';
  const a = Math.abs(v);
  return `${a >= 100 ? Math.round(v) : a >= 1 ? v.toFixed(2) : v.toPrecision(2)} ${unit}`;
}

function NumericResult({ e }: { e: NumericEstimate }) {
  const unit = TARGET_UNIT[e.target];
  return (
    <div className="panel-title" style={{ alignItems: 'flex-start', marginTop: 10 }}>
      <div style={{ minWidth: 0 }}>
        <div className="small muted">{TARGET_LABEL[e.target]}</div>
        {e.value === null ? (
          <div className="small muted">{e.reasons[0]}</div>
        ) : (
          <>
            <AnswerBadge status={e.status} />
            <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18, color: 'var(--text-2)' }}>
              {e.reasons.slice(0, 3).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      {e.value !== null && (
        <div style={{ textAlign: 'right' }}>
          <div className="hero-figure" style={{ fontSize: '1.6rem' }}>{fmtValue(e.value, unit)}</div>
          <div className="small muted">
            {e.status === 'extrapolated'
              ? 'outside the data — treat as a guess'
              : e.range && e.range[0] !== e.range[1]
                ? `tests used: ${fmtValue(e.range[0], unit)} – ${fmtValue(e.range[1], unit)}`
                : 'single value in the tests used'}
          </div>
          <div className="small muted">{e.poolSize} tests report this value</div>
        </div>
      )}
    </div>
  );
}

function SmokeDetection({ tests }: { tests: TestRow[] }) {
  const smoke = useMemo(() => tests.filter((t) => targetValue(t, 'particleSizeNm') !== null), [tests]);
  const materials = useMemo(() => [...new Set(smoke.map((t) => t.fuel).filter((f): f is string => !!f))].sort(), [smoke]);
  const invs = [...new Set(smoke.map((t) => t.inv))];
  const [material, setMaterial] = useState('');
  const [flow, setFlow] = useState(8);
  const mat = material && materials.includes(material) ? material : materials[0] ?? '';
  const e = useMemo(
    () => (smoke.length ? estimateNumeric({ o2Pct: null, pressureKpa: null, flowCmS: flow, fuelPhase: null, fuel: mat || null }, smoke, 'particleSizeNm') : null),
    [smoke, flow, mat],
  );
  return (
    <section className="card" style={{ marginTop: 16 }} aria-labelledby="smoke-h">
      <h2 id="smoke-h">Smoke detection: how big are the smoke particles?</h2>
      <p className="small muted">
        Smoke detectors are tuned to a particle size range. SAME and SAME-R heated spacecraft materials below ignition in microgravity
        and measured the smoke. EMBER estimates particle size from the nearest of those tests by material and flow, with the same
        Measured / Interpolated / Extrapolated rules. Heating temperature and aging time are not part of the distance.
      </p>
      {!e ? (
        <p className="muted" style={{ marginBottom: 0 }}>No particle-size data loaded.</p>
      ) : (
        <div className="split">
          <div>
            <label>
              <span className="small muted">Material</span>
              <select value={mat} onChange={(ev) => setMaterial(ev.target.value)}>
                {materials.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <Slider id="smoke-flow" label="Flow past the sample" value={flow} min={0} max={20} step={0.5} unit="cm/s" onChange={setFlow} />
            <p className="small muted">
              {smoke.length} tests from {invs.join(', ')}. O₂ and pressure are cabin air and not recorded per test, so they are not used.
            </p>
          </div>
          <div>
            <NumericResult e={e} />
            {e.neighbours.length > 0 && (
              <p className="small muted">
                Nearest tests:{' '}
                {(e.status === 'measured' ? e.measuredTests.map((t) => ({ test: t })) : e.neighbours).slice(0, 5).map((n, i) => (
                  <span key={`${n.test.inv}::${n.test.testId}`}>
                    {i > 0 && ' · '}
                    <span className="mono">{n.test.testId}</span> ({n.test.fuel}, {fmtNum(n.test.flowCmS)} cm/s,{' '}
                    {fmtValue(targetValue(n.test, 'particleSizeNm'), 'nm')})
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default function WhatIf() {
  const { scenario } = useEmber();
  const { tests } = useData();
  const [o2, setO2] = useState(scenario.o2Pct);
  const [p, setP] = useState(scenario.pressureKpa);
  const [flow, setFlow] = useState(Math.round((scenario.flowMin + scenario.flowMax) / 2));
  const [phase, setPhase] = useState<FuelPhase | 'any'>(scenario.fuelPhase);
  const [material, setMaterial] = useState(scenario.material);
  const [gpool, setGpool] = useState<GravityPool>('micro');

  const pool = useMemo(
    () =>
      tests.filter((t) =>
        gpool === 'all' ? true : gpool === 'micro' ? t.gravityG === null || t.gravityG <= 0.01 : t.gravityG !== null && t.gravityG >= 0.9,
      ),
    [tests, gpool],
  );
  const materials = useMemo(
    () => [...new Set(pool.filter((t) => t.fuel && (phase === 'any' || t.fuelPhase === phase)).map((t) => t.fuel as string))].sort(),
    [pool, phase],
  );
  const query: Query = useMemo(
    () => ({ o2Pct: o2, pressureKpa: p, flowCmS: flow, fuelPhase: phase === 'any' ? null : phase, fuel: material || null }),
    [o2, p, flow, phase, material],
  );
  const e = useMemo(() => estimate(query, pool), [query, pool]);
  const numeric = useMemo(() => PHASE_TARGETS[phase].map((t) => estimateNumeric(query, pool, t)), [query, pool, phase]);

  const plotted = pool.filter((t) => (phase === 'any' || t.fuelPhase === phase || e.phaseFallback) && t.o2Pct !== null && t.pressureKpa !== null);
  const nbIds = new Set(e.neighbours.map((n) => `${n.test.inv}::${n.test.testId}`));
  const points = plotted
    .map((t) =>
      testToPoint(t, 'o2Pct', 'pressureKpa', {
        dim: t.flowCmS !== null && Math.abs(t.flowCmS - flow) > 10,
        emphasis: nbIds.has(`${t.inv}::${t.testId}`),
      }),
    )
    .filter((x) => x !== null);

  const reset = () => {
    setO2(scenario.o2Pct);
    setP(scenario.pressureKpa);
    setFlow(Math.round((scenario.flowMin + scenario.flowMax) / 2));
    setPhase(scenario.fuelPhase);
    setMaterial(scenario.material);
  };

  return (
    <>
      <PageHead eyebrow="Module 4.5" title="What if…?">
        <p>
          Move the sliders. EMBER estimates the outcome from the nearest real tests (inverse-distance-weighted nearest neighbours in
          normalized <Term k="o2">O₂</Term> / pressure / <Term k="flow">flow</Term> space) and always tells you whether the answer is{' '}
          <strong>measured</strong>, <strong>interpolated</strong> or <strong>extrapolated</strong>.
        </p>
      </PageHead>
      <div className="split">
        <section className="card" aria-label="Conditions">
          <Slider id="wo2" label={<><Term k="o2">O₂</Term> concentration</>} value={o2} min={10} max={100} step={0.5} unit="%" onChange={setO2} />
          <Slider id="wp" label={<>Pressure (<Term k="kpa">kPa</Term>)</>} value={p} min={20} max={110} step={0.5} unit="kPa" extra={`${kpaToPsi(p).toFixed(1)} psi`} onChange={setP} />
          <Slider id="wf" label={<><Term k="flow">Flow</Term> velocity</>} value={flow} min={0} max={60} step={1} unit="cm/s" onChange={setFlow} />
          <div className="inline-fields">
            <label>
              <span className="small muted"><Term k="phase">Fuel phase</Term></span>
              <select value={phase} onChange={(ev) => { setPhase(ev.target.value as FuelPhase | 'any'); setMaterial(''); }}>
                <option value="solid">Solid</option>
                <option value="liquid">Liquid</option>
                <option value="gas">Gas</option>
                <option value="any">Any</option>
              </select>
            </label>
            <label>
              <span className="small muted">Material</span>
              <select value={material} onChange={(ev) => setMaterial(ev.target.value)}>
                <option value="">Any</option>
                {materials.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
            <legend className="small muted">Gravity of the evidence</legend>
            <div className="row">
              {(
                [
                  ['micro', 'µg tests'],
                  ['ground', '1 g tests'],
                  ['all', 'All'],
                ] as [GravityPool, string][]
              ).map(([k, l]) => (
                <button key={k} type="button" className="chip-btn" aria-pressed={gpool === k} onClick={() => setGpool(k)}>
                  {l}
                </button>
              ))}
            </div>
          </fieldset>
          <hr className="sep" />
          <div className="row">
            <button type="button" onClick={reset}>Reset to mission lens</button>
            <Link to="/gravity" className="small">Partial gravity →</Link>
          </div>
        </section>

        <div className="stack">
          <section className="card" aria-live="polite">
            <div className="panel-title">
              <div>
                <div className="small muted">Answer status</div>
                <AnswerBadge status={e.status} large />
                <div className="small muted" style={{ marginTop: 4 }}>{answerHelp(e.status)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="small muted">Weighted vote: flame sustained</div>
                <div className="hero-figure">{fmtPct(e.pBurn)}</div>
                <div className="small muted">
                  {e.status === 'extrapolated' ? 'uncertainty unbounded outside the data' : e.interval ? `95% interval ${fmtPct(e.interval[0])}–${fmtPct(e.interval[1])}` : ''}
                </div>
              </div>
            </div>
            <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--text-2)' }}>
              {e.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            {e.outOfRange.length > 0 && (
              <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
                Tested range in this pool ({e.poolSize} tests):{' '}
                {e.outOfRange.map((o) => `${DIM_LABEL[o.dim]} ${fmtNum(o.min)}–${fmtNum(o.max)} ${DIM_UNIT[o.dim]}`).join(' · ')}
              </p>
            )}
          </section>

          <section className="card" aria-live="polite">
            <h2>Numeric estimate</h2>
            <p className="small muted" style={{ marginBottom: 0 }}>
              Same nearest-neighbour method, predicting a measured number from tests of the same fuel phase only. Backtest errors are on
              the <Link to="/trust">Trust</Link> page.
            </p>
            {numeric.map((ne) => (
              <NumericResult key={ne.target} e={ne} />
            ))}
          </section>

          <section className="card">
            <h2>Tests in O₂ × pressure</h2>
            <p className="small muted">
              Ringed tests are the {e.neighbours.length} nearest neighbours. Faded tests have flow more than 10 cm/s from {flow} cm/s.
              {gpool === 'micro' ? ' Microgravity tests only.' : gpool === 'ground' ? ' Earth-gravity (1 g) tests only.' : ''}
            </p>
            {points.length ? (
              <ScatterPlot
                points={points}
                xLabel="O₂ (%)"
                yLabel="Pressure (kPa)"
                query={{ x: o2, y: p, label: 'Your query' }}
                summary={`Scatter of ${points.length} tests by oxygen and pressure with the query point at ${o2}% O2 and ${p} kPa. Status ${e.status}.`}
              />
            ) : (
              <p className="muted">No tests to plot for this selection.</p>
            )}
          </section>

          <section className="card">
            <h2>{e.status === 'measured' ? 'Matching tests' : 'Nearest real tests'}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Test</th>
                    <th>Fuel</th>
                    <th className="num">O₂ %</th>
                    <th className="num">kPa</th>
                    <th className="num">cm/s</th>
                    <th>g</th>
                    <th>Outcome</th>
                    <th className="num"><Term k="normdist">Distance</Term></th>
                    <th className="num">Weight</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {(e.status === 'measured' ? e.measuredTests.map((t) => ({ test: t, distance: 0, weight: 1 / e.measuredTests.length })) : e.neighbours).map((n) => {
                    const sw = e.status === 'measured' ? 1 : e.neighbours.reduce((s, x) => s + x.weight, 0);
                    return (
                      <tr key={`${n.test.inv}::${n.test.testId}`}>
                        <td>
                          <Link to={`/investigations/${encodeURIComponent(n.test.inv)}`}>{n.test.inv}</Link> <span className="mono small">{n.test.testId}</span>
                        </td>
                        <td>{n.test.fuel ?? '—'}</td>
                        <td className="num">{fmtNum(n.test.o2Pct)}</td>
                        <td className="num">{fmtNum(n.test.pressureKpa)}</td>
                        <td className="num">{fmtNum(n.test.flowCmS)}</td>
                        <td>{fmtGravity(n.test.gravityG)}</td>
                        <td>{n.test.outcome}</td>
                        <td className="num">{n.distance.toFixed(2)}</td>
                        <td className="num">{fmtPct(n.weight / sw)}</td>
                        <td className="small muted">
                          {n.test.source.file ?? '—'}
                          {n.test.source.row !== null ? ` #${n.test.source.row}` : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
      <SmokeDetection tests={tests} />
    </>
  );
}
