import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import {
  parseResearchQuery,
  predictAllApplicableTargets,
  type DomainPrediction,
  type FuelPhase,
} from '../../core';
import { MultiLineSeriesSvg, ScatterPlotSvg, type ScatterPoint } from '../components/ScientificCharts';
import { StatusPill } from '../components/StatusPill';
import { useEmber } from '../context/EmberContext';

type LabTab = 'replay' | 'predictor' | 'illustration';

export function ModelingLabPage() {
  const { corpus, corpusLoading, ensureCorpus, activeSnapshot } = useEmber();
  const [activeTab, setActiveTab] = useState<LabTab>('replay');

  // Predictor form state
  const [material, setMaterial] = useState('PMMA');
  const [fuelPhase, setFuelPhase] = useState<FuelPhase>('solid');
  const [thicknessMm, setThicknessMm] = useState('0.2');
  const [o2Pct, setO2Pct] = useState('21');
  const [pressureKpa, setPressureKpa] = useState('101.3');
  const [flowCmS, setFlowCmS] = useState('10');

  // Conceptual Illustration controls
  const [illusFlow, setIllusFlow] = useState<'quiescent' | 'concurrent' | 'opposed'>('concurrent');
  const [illusMode, setIllusMode] = useState<'hot_flame' | 'cool_flame' | 'flow_shutoff'>('hot_flame');

  useEffect(() => {
    if (!corpus) {
      void ensureCorpus();
    }
  }, [corpus, ensureCorpus]);

  useEffect(() => {
    if (!activeSnapshot) return;
    const q = activeSnapshot.review.query;
    if (q.material) setMaterial(q.material);
    if (q.fuelPhase) setFuelPhase(q.fuelPhase);
    if (q.thicknessMm !== null) setThicknessMm(String(q.thicknessMm));
    if (q.o2Pct !== null) setO2Pct(String(q.o2Pct));
    if (q.pressureKpa !== null) setPressureKpa(String(q.pressureKpa));
    if (typeof q.flowCmS === 'number') setFlowCmS(String(q.flowCmS));
  }, [activeSnapshot?.reviewId]);

  const tests = corpus?.tests ?? [];

  // Data Replay Series 1: BASS-II Table 5.1 spread rate vs velocity
  const bassSeries = useMemo(() => {
    const colors = ['#ff9f0a', '#64d2ff', '#30d158', '#bf5af2', '#ffd60a'];
    return tests
      .filter((t) => t.inv === 'BASS-II' && t.extra && typeof t.extra.tmTable5_1 === 'object' && t.extra.tmTable5_1 !== null)
      .slice(0, 5)
      .map((t, idx) => {
        const tbl = t.extra.tmTable5_1 as { velocitiesCmS?: number[]; spreadRatesMmS?: number[] };
        const vel = tbl.velocitiesCmS ?? [];
        const spr = tbl.spreadRatesMmS ?? [];
        return {
          id: t.testId,
          label: `${t.testId} (${t.atmosphere.o2.value ?? '?'}% O2)`,
          color: colors[idx % colors.length],
          points: vel.map((v, i) => ({ x: v, y: spr[i] ?? 0 })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
        };
      });
  }, [tests]);

  // Data Replay Series 2: CFI hot vs cool extinction droplet diameter
  const cfiPoints = useMemo<ScatterPoint[]>(() => {
    return tests
      .filter(
        (t) =>
          t.inv === 'CFI' &&
          typeof t.extra?.DextHotMm === 'number' &&
          typeof t.extra?.DextCoolMm === 'number',
      )
      .map((t) => ({
        id: t.testId,
        x: t.extra.DextHotMm as number,
        y: t.extra.DextCoolMm as number,
        label: `${t.testId} (${t.fuel ?? 'alkane'}): Hot Ext ${t.extra.DextHotMm} mm → Cool Ext ${t.extra.DextCoolMm} mm`,
        color: '#64d2ff',
      }));
  }, [tests]);

  // Data Replay Series 3: SAME-R smoke particle size vs aging time
  const sameRPoints = useMemo<ScatterPoint[]>(() => {
    return tests
      .filter((t) => t.inv === 'SAME-R' && t.particleSizeNm.value !== null && t.extra?.['Net aging time (sec)'] != null)
      .map((t) => ({
        id: t.testId,
        x: Number(t.extra['Net aging time (sec)']),
        y: t.particleSizeNm.value!,
        label: `${t.testId} (${t.fuel ?? 'fuel'}): ${t.particleSizeNm.value} nm at ${t.extra['Net aging time (sec)']} s`,
        color: '#30d158',
      }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  }, [tests]);

  // Tab 2: Live Domain-Gated Prediction
  const predictions: DomainPrediction[] = useMemo(() => {
    if (tests.length === 0) return [];
    const q = parseResearchQuery(`${material} at ${o2Pct}% O2 ${pressureKpa} kPa ${flowCmS} cm/s`, {
      material,
      fuelPhase,
      thicknessMm: thicknessMm.trim() ? Number(thicknessMm) : null,
      o2Pct: o2Pct.trim() ? Number(o2Pct) : null,
      pressureKpa: pressureKpa.trim() ? Number(pressureKpa) : null,
      flowCmS: flowCmS.trim() ? Number(flowCmS) : null,
      o2Role: 'ambient',
    });
    return predictAllApplicableTargets(q, tests);
  }, [tests, material, fuelPhase, thicknessMm, o2Pct, pressureKpa, flowCmS]);

  const handleTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const order: LabTab[] = ['replay', 'predictor', 'illustration'];
    const idx = order.indexOf(activeTab);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setActiveTab(order[(idx + 1) % order.length]);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setActiveTab(order[(idx + order.length - 1) % order.length]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveTab(order[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveTab(order[order.length - 1]);
    }
  };

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>Modeling &amp; Experimental Replay Lab</h1>
          <p className="page-lead">
            Measured NASA flight data replay, domain-gated local regression with leave-one-group-out CV refusal gates, and non-computational physical schematic diagrams.
          </p>
        </div>
      </div>

      <div role="tablist" aria-label="Modeling Lab Sections" className="tablist" onKeyDown={handleTabKey}>
        <button
          id="tab-replay"
          type="button"
          role="tab"
          aria-selected={activeTab === 'replay'}
          tabIndex={activeTab === 'replay' ? 0 : -1}
          className="tab-btn"
          onClick={() => setActiveTab('replay')}
        >
          1. Data Replay (Measured NASA Series)
        </button>
        <button
          id="tab-predictor"
          type="button"
          role="tab"
          aria-selected={activeTab === 'predictor'}
          tabIndex={activeTab === 'predictor' ? 0 : -1}
          className="tab-btn"
          onClick={() => setActiveTab('predictor')}
        >
          2. Domain-Gated Endpoint Predictor
        </button>
        <button
          id="tab-illustration"
          type="button"
          role="tab"
          aria-selected={activeTab === 'illustration'}
          tabIndex={activeTab === 'illustration' ? 0 : -1}
          className="tab-btn"
          onClick={() => setActiveTab('illustration')}
        >
          3. Conceptual Illustration
        </button>
      </div>

      {corpusLoading ? (
        <div className="card"><p className="muted">Loading NASA PSI experimental series…</p></div>
      ) : null}

      {activeTab === 'replay' ? (
        <div role="tabpanel" aria-labelledby="tab-replay" tabIndex={0} className="tabpanel stack-lg">
          <div className="banner banner-info">
            <span aria-hidden="true">●</span>
            <span>
              <strong>Empirical Replay Only:</strong> Plotted points come directly from recorded NASA experimental tables (BASS-II Table 5.1, CFI Droplet Transitions, SAME-R Coagulation Aging).
            </span>
          </div>

          <MultiLineSeriesSvg
            title="BASS-II Table 5.1: Concurrent vs Opposed Spread Rate (mm/s) across Flow Velocities"
            xLabel="Flow Velocity (cm/s)"
            yLabel="Spread Rate (mm/s)"
            series={bassSeries}
          />

          <div className="grid-2">
            <ScatterPlotSvg
              title="CFI Droplet Combustion: Hot Flame Extinction Diameter vs Cool Flame Extinction Diameter (mm)"
              xLabel="Hot-Flame Extinction Diameter DextHot (mm)"
              yLabel="Cool-Flame Extinction Diameter DextCool (mm)"
              points={cfiPoints}
            />
            <ScatterPlotSvg
              title="SAME-R Smoke Sizing: Particle Size (nm) vs Net Aging Time (sec)"
              xLabel="Net Aging Time (s)"
              yLabel="Particle Size (nm)"
              points={sameRPoints}
            />
          </div>
        </div>
      ) : null}

      {activeTab === 'predictor' ? (
        <div role="tabpanel" aria-labelledby="tab-predictor" tabIndex={0} className="tabpanel stack-lg">
          <div className="card stack-md">
            <div className="card-header">
              <h2 className="card-title">Query Condition Point for Domain-Gated Prediction</h2>
              <div className="btn-group">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setMaterial('PMMA');
                    setFuelPhase('solid');
                    setThicknessMm('0.2');
                    setO2Pct('21');
                    setPressureKpa('101.3');
                    setFlowCmS('10');
                  }}
                >
                  In-Domain Preset: PMMA BASS-II
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setMaterial('PMMA');
                    setFuelPhase('solid');
                    setThicknessMm('5.0');
                    setO2Pct('45');
                    setPressureKpa('35');
                    setFlowCmS('40');
                  }}
                >
                  Out-of-Domain Stress Preset (45% O2 / 35 kPa)
                </button>
              </div>
            </div>

            <div className="field-grid">
              <div className="field">
                <label htmlFor="pred-mat" className="field-label">Material</label>
                <input id="pred-mat" type="text" value={material} onChange={(e) => setMaterial(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="pred-phase" className="field-label">Fuel Phase</label>
                <select id="pred-phase" value={fuelPhase} onChange={(e) => setFuelPhase(e.target.value as FuelPhase)}>
                  <option value="solid">solid</option>
                  <option value="liquid">liquid</option>
                  <option value="gas">gas</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="pred-thick" className="field-label">Thickness (mm)</label>
                <input id="pred-thick" type="number" step="any" value={thicknessMm} onChange={(e) => setThicknessMm(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="pred-o2" className="field-label">O2 %</label>
                <input id="pred-o2" type="number" step="any" value={o2Pct} onChange={(e) => setO2Pct(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="pred-p" className="field-label">Pressure (kPa)</label>
                <input id="pred-p" type="number" step="any" value={pressureKpa} onChange={(e) => setPressureKpa(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="pred-f" className="field-label">Flow (cm/s)</label>
                <input id="pred-f" type="number" step="any" value={flowCmS} onChange={(e) => setFlowCmS(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="grid-2">
            {predictions.map((pred) => (
              <article key={pred.target} className="card stack-sm">
                <div className="card-header">
                  <div>
                    <h3 className="card-title mono">{pred.target}</h3>
                    <span className="muted" style={{ fontSize: '0.82rem' }}>Unit: {pred.unit} · Group-CV kNN Ridge</span>
                  </div>
                  <StatusPill
                    tone={pred.refused ? 'danger' : 'ok'}
                    icon={pred.refused ? '⊘' : '✓'}
                    label={pred.status}
                  />
                </div>

                {pred.refused ? (
                  <div className="banner banner-danger">
                    <div>
                      <strong>Prediction Refused by Domain / Baseline Gate</strong>
                      <ul style={{ margin: '0.35rem 0 0', paddingInlineStart: '1.15rem' }}>
                        {pred.refusalReasons.map((r, idx) => (
                          <li key={idx}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="stack-sm">
                    <div className="kpi-tile">
                      <span className="kpi-label">Predicted Value (95% Local Interval)</span>
                      <span className="kpi-value tabular">
                        {pred.predictedValue?.toFixed(3)} {pred.unit}{' '}
                        {pred.interval ? (
                          <span className="muted" style={{ fontSize: '0.85rem' }}>
                            [{pred.interval[0].toFixed(3)}, {pred.interval[1].toFixed(3)}]
                          </span>
                        ) : null}
                      </span>
                    </div>

                    <div className="pill-row">
                      <StatusPill tone="info" label={`Train: ${pred.nTrainRows} rows / ${pred.nTrainGroups} groups`} />
                      <StatusPill tone="ok" label={`LOGO CV MAE: ${pred.cvMae?.toFixed(3) ?? 'n/a'}`} />
                      <StatusPill
                        tone="neutral"
                        label={`Baselines (Inv/Global): ${pred.baselineInvMeanMae?.toFixed(3) ?? '—'} / ${pred.baselineGlobalMeanMae?.toFixed(3) ?? '—'}`}
                      />
                    </div>

                    <div>
                      <strong style={{ fontSize: '0.84rem' }}>Nearest Verified Neighbours:</strong>
                      <ul style={{ margin: '0.3rem 0 0', paddingInlineStart: '1.15rem', fontSize: '0.82rem' }}>
                        {pred.nearestNeighbours.map((nn) => (
                          <li key={nn.testId} className="mono">
                            {nn.testId} ({nn.inv}, group={nn.groupId}) → {nn.value} {pred.unit} (d={nn.distance.toFixed(2)})
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {activeTab === 'illustration' ? (
        <div role="tabpanel" aria-labelledby="tab-illustration" tabIndex={0} className="tabpanel stack-md">
          <div className="banner banner-warn">
            <span aria-hidden="true">⚠</span>
            <strong>CONCEPTUAL ILLUSTRATION — NOT A PHYSICAL CALCULATION</strong>
          </div>

          <div className="card stack-md">
            <div className="field-grid">
              <div className="field">
                <label htmlFor="illus-flow" className="field-label">Qualitative Flow Geometry</label>
                <select
                  id="illus-flow"
                  value={illusFlow}
                  onChange={(e) => setIllusFlow(e.target.value as typeof illusFlow)}
                >
                  <option value="quiescent">Quiescent 0g Spherical Diffusion Zone</option>
                  <option value="concurrent">Concurrent Boundary-Layer Plume</option>
                  <option value="opposed">Opposed-Flow Stagnation Front</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="illus-mode" className="field-label">Regime State</label>
                <select
                  id="illus-mode"
                  value={illusMode}
                  onChange={(e) => setIllusMode(e.target.value as typeof illusMode)}
                >
                  <option value="hot_flame">Visible Hot Diffusion Flame</option>
                  <option value="cool_flame">Low-Temp Invisible Cool Flame (CFI/FLEX)</option>
                  <option value="flow_shutoff">Post-Shutoff Radiation &amp; Smolder Risk</option>
                </select>
              </div>
            </div>

            <figure className="chart-figure">
              <figcaption>Conceptual Schematic: {illusFlow} flow · {illusMode}</figcaption>
              <svg
                viewBox="0 0 640 240"
                className="chart-svg"
                role="img"
                aria-label={`Conceptual illustration of ${illusFlow} flow under ${illusMode} regime. Not a physical calculation.`}
              >
                <title>Conceptual 2D Flame Morphology Diagram</title>
                <rect x="0" y="0" width="640" height="240" fill="#0b0c10" rx="8" />
                <text x="16" y="24" fill="#ffd60a" fontSize="11" fontWeight="700">
                  CONCEPTUAL ILLUSTRATION — NOT A PHYSICAL CALCULATION
                </text>

                {/* Sample Slab / Droplet */}
                <rect x="210" y="135" width="220" height="26" fill="#2a2f3a" stroke="#6c788e" rx="4" />
                <text x="320" y="152" textAnchor="middle" fill="#edf1f7" fontSize="12">
                  Fuel Surface / Sample Core
                </text>

                {/* Flow Arrows */}
                {illusFlow !== 'quiescent' ? (
                  <g stroke="#64d2ff" strokeWidth="2.2">
                    <line
                      x1={illusFlow === 'concurrent' ? 60 : 580}
                      y1="95"
                      x2={illusFlow === 'concurrent' ? 160 : 480}
                      y2="95"
                    />
                    <text x={illusFlow === 'concurrent' ? 60 : 460} y="82" fill="#64d2ff" stroke="none" fontSize="12">
                      {illusFlow === 'concurrent' ? 'Forced Flow →' : '← Opposed Flow'}
                    </text>
                  </g>
                ) : (
                  <text x="320" y="54" textAnchor="middle" fill="#64d2ff" fontSize="12">
                    Zero Buoyancy · Diffusion-Controlled Transport
                  </text>
                )}

                {/* Schematic Envelope */}
                {illusMode === 'hot_flame' ? (
                  <ellipse
                    cx={illusFlow === 'concurrent' ? 355 : illusFlow === 'opposed' ? 285 : 320}
                    cy="112"
                    rx="110"
                    ry="40"
                    fill="rgba(255, 159, 10, 0.28)"
                    stroke="#ff9f0a"
                    strokeWidth="2.5"
                  />
                ) : illusMode === 'cool_flame' ? (
                  <ellipse
                    cx="320"
                    cy="112"
                    rx="95"
                    ry="34"
                    fill="rgba(100, 210, 255, 0.14)"
                    stroke="#64d2ff"
                    strokeDasharray="6 4"
                    strokeWidth="2"
                  />
                ) : (
                  <ellipse
                    cx="320"
                    cy="126"
                    rx="75"
                    ry="18"
                    fill="rgba(255, 69, 58, 0.16)"
                    stroke="#ff453a"
                    strokeDasharray="4 4"
                    strokeWidth="2"
                  />
                )}

                <text x="320" y="206" textAnchor="middle" fill="#a1aab8" fontSize="12">
                  {illusMode === 'hot_flame'
                    ? 'Luminous visible hot reaction sheet; soot & radiative heat feedback shift with velocity.'
                    : illusMode === 'cool_flame'
                      ? 'Low-temperature (~500–800 K) cool-flame chemistry may persist invisibly after visible hot extinction.'
                      : 'Ventilation cutoff terminates convective O2 feed (FT), distinct from natural flammability limits.'}
                </text>
              </svg>
            </figure>
          </div>
        </div>
      ) : null}
    </div>
  );
}
