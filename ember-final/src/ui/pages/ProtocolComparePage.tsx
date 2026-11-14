import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  evaluateApplicability,
  hasCoolFlameContinuation,
  isOperatorTerminated,
  parseResearchQuery,
  type Test,
} from '../../core';
import { MultiLineSeriesSvg, ScatterPlotSvg, type ScatterPoint } from '../components/ScientificCharts';
import { GasRoleBadge, ProvenanceBadge, StatusPill, VerdictBadge } from '../components/StatusPill';
import { formatLocator, useEmber } from '../context/EmberContext';

const DEFAULT_PROTOCOL_PRESETS = ['BASS-II-B1', 'BASS-II-B10', 'BASS-II-M1', 'CFI-1206', 'SAME-R-51a'];

export function ProtocolComparePage() {
  const [searchParams] = useSearchParams();
  const initialTestId = searchParams.get('testId');
  const { corpus, corpusLoading, ensureCorpus, activeSnapshot, openSourceRef } = useEmber();

  const [activeTab, setActiveTab] = useState<'protocol' | 'compare'>('protocol');
  const [selectedTestId, setSelectedTestId] = useState<string>(initialTestId ?? 'BASS-II-B1');
  const [testFilter, setTestFilter] = useState('');
  const [compareIds, setCompareIds] = useState<string[]>(['BASS-II-B1', 'BASS-II-B10', 'BASS-II-M1']);
  const [candidateAddId, setCandidateAddId] = useState('BASS-II-O1');

  useEffect(() => {
    if (!corpus) {
      void ensureCorpus();
    }
  }, [corpus, ensureCorpus]);

  useEffect(() => {
    if (initialTestId) {
      setSelectedTestId(initialTestId);
      setActiveTab('protocol');
    }
  }, [initialTestId]);

  const tests = corpus?.tests ?? [];

  const testById = useMemo(() => new Map(tests.map((t) => [t.testId, t])), [tests]);

  const activeTest: Test | null = useMemo(() => {
    if (testById.has(selectedTestId)) return testById.get(selectedTestId) ?? null;
    for (const pid of DEFAULT_PROTOCOL_PRESETS) {
      if (testById.has(pid)) return testById.get(pid) ?? null;
    }
    return tests[0] ?? null;
  }, [testById, selectedTestId, tests]);

  const matchingTestOptions = useMemo(() => {
    const q = testFilter.trim().toLowerCase();
    const list = q
      ? tests.filter((t) =>
          `${t.testId} ${t.inv} ${t.fuel ?? ''} ${t.terminalEvent ?? ''}`.toLowerCase().includes(q),
        )
      : tests;
    const sliced = list.slice(0, 120);
    if (activeTest && !sliced.some((t) => t.testId === activeTest.testId)) {
      return [activeTest, ...sliced];
    }
    return sliced;
  }, [tests, testFilter, activeTest]);

  const activeQuery = useMemo(
    () =>
      activeSnapshot?.review.query ??
      parseResearchQuery('PMMA flame spread and extinction under flow reduction in concurrent flow'),
    [activeSnapshot],
  );

  // Build side-by-side comparison diagnostics
  const comparedTests = useMemo(
    () => compareIds.map((id) => testById.get(id)).filter((t): t is Test => Boolean(t)),
    [compareIds, testById],
  );

  const comparisonAnalysis = useMemo(() => {
    if (comparedTests.length < 2) return null;
    const decisions = comparedTests.map((t) => evaluateApplicability(activeQuery, t));
    const fields: Array<{ label: string; values: string[] }> = [
      { label: 'Investigation', values: comparedTests.map((t) => t.inv) },
      { label: 'Fuel / Phase', values: comparedTests.map((t) => `${t.fuel ?? 'unknown'} (${t.fuelPhase ?? '?'})`) },
      { label: 'Geometry & Thickness', values: comparedTests.map((t) => `${t.geometry ?? 'unknown'} / ${t.thicknessMm.value ?? 'unknown'} mm`) },
      { label: 'O2 % & Role', values: comparedTests.map((t) => `${t.atmosphere.o2.value ?? 'unknown'}% [${t.atmosphere.o2.role}, ${t.atmosphere.o2.provenance}]`) },
      { label: 'Pressure (kPa)', values: comparedTests.map((t) => `${t.atmosphere.pressure.value ?? 'unknown'} (${t.atmosphere.pressure.provenance})`) },
      { label: 'Flow & Direction', values: comparedTests.map((t) => `${t.flow.initialFlowCmS.value ?? 'unknown'} cm/s (${t.flow.direction}, ${t.flow.history})`) },
      { label: 'Gravity Regime', values: comparedTests.map((t) => `${t.gravity.gravityG.value ?? 'unknown'}g (${t.gravity.platform})`) },
      { label: 'Initial / Terminal', values: comparedTests.map((t) => `${t.initialOutcome} / ${t.terminalEvent ?? 'none'}`) },
    ];

    const sharedFactors: string[] = [];
    const changedFactors: string[] = [];
    const unknownFactors: string[] = [];

    for (const f of fields.slice(1, 7)) {
      const uniq = new Set(f.values);
      if (f.values.some((v) => v.includes('unknown') || v.includes('assumed'))) {
        unknownFactors.push(f.label);
      }
      if (uniq.size === 1) {
        sharedFactors.push(`${f.label}: ${f.values[0]}`);
      } else {
        changedFactors.push(f.label);
      }
    }

    const opTermCount = comparedTests.filter((t) => isOperatorTerminated(t)).length;
    const hasMixedEndpointTermination = opTermCount > 0 && opTermCount < comparedTests.length;
    const hasInadmissible = decisions.some((d) => d.verdict === 'inadmissible');
    const confounded = changedFactors.length > 2 || hasMixedEndpointTermination || hasInadmissible;

    let causalWarning = 'Single-factor or controlled protocol contrast across matching context.';
    if (hasMixedEndpointTermination) {
      causalWarning =
        'Confounded termination endpoint: selection mixes operator flow shutoff (FT) with natural extinction/sustained runs.';
    } else if (changedFactors.length > 2) {
      causalWarning = `Multi-factor shift (${changedFactors.join(', ')}) precludes attributing outcome differences to a single variable.`;
    } else if (hasInadmissible) {
      causalWarning = 'One or more compared tests fail query applicability gates (material, phase, O2 role, or protocol endpoint).';
    }

    return { fields, decisions, sharedFactors, changedFactors, unknownFactors, confounded, causalWarning };
  }, [comparedTests, activeQuery]);

  // Extract BASS-II Table 5.1 spread rate series & SAME-R aging series & O2 vs Flow scatter
  const o2FlowPoints = useMemo<ScatterPoint[]>(() => {
    const bassAndCfi = tests
      .filter((t) => t.atmosphere.o2.value !== null && t.flow.initialFlowCmS.value !== null)
      .slice(0, 180);
    return bassAndCfi.map((t) => ({
      id: t.testId,
      x: t.flow.initialFlowCmS.value!,
      y: t.atmosphere.o2.value!,
      label: `${t.testId} (${t.inv}): ${t.atmosphere.o2.value}% O2 @ ${t.flow.initialFlowCmS.value} cm/s`,
      color: compareIds.includes(t.testId)
        ? '#ff9f0a'
        : t.atmosphere.o2.role === 'oxidizer_stream'
          ? '#ff453a'
          : '#64d2ff',
    }));
  }, [tests, compareIds]);

  const bassTableSeries = useMemo(() => {
    const palette = ['#ff9f0a', '#64d2ff', '#30d158', '#bf5af2', '#ffd60a'];
    const matching = tests.filter((t) => t.inv === 'BASS-II' && t.extra && typeof t.extra.tmTable5_1 === 'object' && t.extra.tmTable5_1 !== null);
    return matching.slice(0, 5).map((t, idx) => {
      const tbl = t.extra.tmTable5_1 as { velocitiesCmS?: number[]; spreadRatesMmS?: number[] };
      const vel = tbl.velocitiesCmS ?? [];
      const spr = tbl.spreadRatesMmS ?? [];
      const points = vel.map((v, i) => ({ x: v, y: spr[i] ?? 0 })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      return {
        id: t.testId,
        label: `${t.testId} (${t.atmosphere.o2.value ?? '?'}% O2, ${t.thicknessMm.value ?? '?'} mm)`,
        color: palette[idx % palette.length],
        points,
      };
    });
  }, [tests]);

  const sameRPoints = useMemo<ScatterPoint[]>(() => {
    return tests
      .filter((t) => t.inv === 'SAME-R' && t.particleSizeNm.value !== null && t.extra?.['Net aging time (sec)'] != null)
      .map((t) => ({
        id: t.testId,
        x: Number(t.extra['Net aging time (sec)']),
        y: t.particleSizeNm.value!,
        label: `${t.testId} (${t.fuel ?? 'fuel'}): ${t.particleSizeNm.value} nm at ${t.extra['Net aging time (sec)']} s aging`,
        color: '#30d158',
      }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  }, [tests]);

  const handleTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActiveTab((prev) => (prev === 'protocol' ? 'compare' : 'protocol'));
    }
  };

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>Protocol Timeline &amp; Experimental Comparison</h1>
          <p className="page-lead">
            Inspect stage-bound test execution steps (ignition vs flow intervention vs operator shutoff FT vs cool flames) and verify whether cross-test contrasts are causally admissible.
          </p>
        </div>
      </div>

      <div role="tablist" aria-label="Protocol and Comparison views" className="tablist" onKeyDown={handleTabKeyDown}>
        <button
          id="tab-protocol"
          type="button"
          role="tab"
          aria-selected={activeTab === 'protocol'}
          tabIndex={activeTab === 'protocol' ? 0 : -1}
          className="tab-btn"
          onClick={() => setActiveTab('protocol')}
        >
          1. Protocol Step Timeline
        </button>
        <button
          id="tab-compare"
          type="button"
          role="tab"
          aria-selected={activeTab === 'compare'}
          tabIndex={activeTab === 'compare' ? 0 : -1}
          className="tab-btn"
          onClick={() => setActiveTab('compare')}
        >
          2. Admissible Comparison &amp; Series Plots
        </button>
      </div>

      {corpusLoading ? (
        <div className="card"><p className="muted">Loading test protocol corpus…</p></div>
      ) : null}

      {activeTab === 'protocol' ? (
        <div role="tabpanel" aria-labelledby="tab-protocol" tabIndex={0} className="tabpanel stack-md">
          <div className="card stack-sm">
            <div className="card-header">
              <h2 className="card-title">Select Experimental Run</h2>
              <div className="btn-group">
                {DEFAULT_PROTOCOL_PRESETS.filter((pid) => testById.has(pid)).map((pid) => (
                  <button
                    key={pid}
                    type="button"
                    className={`btn btn-sm ${activeTest?.testId === pid ? 'btn-primary' : ''}`}
                    onClick={() => setSelectedTestId(pid)}
                  >
                    {pid}
                  </button>
                ))}
              </div>
            </div>

            <div className="field-grid">
              <div className="field">
                <label htmlFor="proto-search" className="field-label">Filter Test List</label>
                <input
                  id="proto-search"
                  type="search"
                  value={testFilter}
                  placeholder="Type testId (e.g. BASS-II-B10, CFI-1206, SAME-R)…"
                  onChange={(e) => setTestFilter(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="proto-select" className="field-label">Test Record ({matchingTestOptions.length} shown)</label>
                <select
                  id="proto-select"
                  value={activeTest?.testId ?? ''}
                  onChange={(e) => setSelectedTestId(e.target.value)}
                >
                  {matchingTestOptions.map((t) => (
                    <option key={t.testId} value={t.testId}>
                      {t.testId} ({t.inv}) — {t.fuel ?? 'n/a'} · {t.initialOutcome}
                      {t.terminalEvent ? ` / ${t.terminalEvent}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {activeTest ? (
            <section className="card stack-md" aria-label={`Protocol details for ${activeTest.testId}`}>
              <div className="card-header">
                <div>
                  <h2 className="card-title">
                    <span className="mono">{activeTest.testId}</span> ({activeTest.inv}) — {activeTest.fuel ?? 'Unknown Fuel'}
                  </h2>
                  <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.86rem' }}>
                    Group: <span className="mono">{activeTest.groupId}</span> · Geometry: {activeTest.geometry ?? 'n/a'} · Thickness: {activeTest.thicknessMm.value ?? 'unknown'} mm · Outcome raw: {activeTest.outcomeRaw ?? activeTest.initialOutcome}
                  </p>
                </div>

                <div className="pill-row">
                  <GasRoleBadge role={activeTest.atmosphere.o2.role} />
                  {isOperatorTerminated(activeTest) ? (
                    <StatusPill tone="warn" icon="⏹" label="Operator Flow Shutoff (FT)" />
                  ) : null}
                  {hasCoolFlameContinuation(activeTest) ? (
                    <StatusPill tone="info" icon="❄" label="Cool-Flame Continuation" />
                  ) : null}
                  {activeTest.sourceRef?.sourceId ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => openSourceRef(activeTest.sourceRef)}
                    >
                      Verify Source
                    </button>
                  ) : null}
                </div>
              </div>

              <div>
                <h3 style={{ fontSize: '0.96rem', marginBlockEnd: '0.5rem' }}>
                  Stage-Bound Protocol Steps ({activeTest.segments.length})
                </h3>
                {activeTest.segments.length === 0 ? (
                  <p className="muted">No discrete stage segments recorded; initial outcome = {activeTest.initialOutcome}.</p>
                ) : (
                  <ol className="timeline">
                    {activeTest.segments.map((seg) => {
                      const isCutoff = seg.intervention === 'flow_shutoff' || seg.intervention === 'heater_cutoff';
                      const isMod = seg.stageType === 'flow_modification' || seg.stageType === 'gas_intervention';
                      const cls = `timeline-step ${isCutoff ? 'intervention-cutoff' : isMod ? 'intervention-physical' : ''}`;
                      return (
                        <li key={seg.segmentId} className={cls}>
                          <div className="pill-row" style={{ justifyContent: 'space-between', marginBlockEnd: '0.35rem' }}>
                            <div className="pill-row">
                              <strong className="mono">#{seg.order} · {seg.segmentId}</strong>
                              <StatusPill tone="info" label={seg.stageType} />
                              <StatusPill
                                tone={isCutoff ? 'warn' : 'neutral'}
                                label={`intervention: ${seg.intervention}`}
                              />
                              {seg.timeStartS !== null ? (
                                <StatusPill
                                  tone="ok"
                                  label={`t = ${seg.timeStartS}–${seg.timeEndS ?? '?'} s`}
                                />
                              ) : (
                                <StatusPill tone="neutral" icon="?" label="Timestamp: unknown" />
                              )}
                            </div>

                            {seg.sourceRef?.sourceId ? (
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => openSourceRef(seg.sourceRef)}
                              >
                                {seg.sourceRef.sourceId} {formatLocator(seg.sourceRef) ? `(${formatLocator(seg.sourceRef)})` : ''}
                              </button>
                            ) : null}
                          </div>

                          <p style={{ margin: '0 0 0.4rem' }}>{seg.description}</p>
                          {seg.sourceRef?.quote ? (
                            <p className="muted" style={{ margin: '0 0 0.4rem', fontSize: '0.82rem' }}>
                              Source quote: &ldquo;{seg.sourceRef.quote}&rdquo;
                            </p>
                          ) : null}

                          <div className="pill-row" style={{ fontSize: '0.8rem' }}>
                            <span className="tabular">
                              Flow: {seg.flowCmS.value !== null ? `${seg.flowCmS.value} cm/s` : 'unknown'}{' '}
                              ({seg.flowCmS.provenance})
                            </span>
                            <span className="tabular">
                              O2: {seg.o2Pct.value !== null ? `${seg.o2Pct.value}%` : 'unknown'}{' '}
                              ({seg.o2Pct.provenance})
                            </span>
                            <span className="tabular">
                              P: {seg.pressureKpa.value !== null ? `${seg.pressureKpa.value} kPa` : 'unknown'}{' '}
                              ({seg.pressureKpa.provenance})
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>

              {activeTest.events.length > 0 ? (
                <div>
                  <h3 style={{ fontSize: '0.96rem', marginBlockEnd: '0.5rem' }}>
                    Recorded Test Events ({activeTest.events.length})
                  </h3>
                  <div className="grid-2">
                    {activeTest.events.map((ev) => (
                      <div key={ev.id} className="card-elevated stack-sm">
                        <div className="pill-row" style={{ justifyContent: 'space-between' }}>
                          <span className="mono">{ev.id} → {ev.segmentId}</span>
                          <ProvenanceBadge provenance={ev.observedValue.provenance} />
                        </div>
                        <div>
                          Endpoint: <strong>{ev.endpoint}</strong> · Event: <span className="mono">{ev.eventType}</span>
                        </div>
                        <div className="tabular">
                          Value: <strong>{String(ev.observedValue.value ?? 'null')}</strong> {ev.observedValue.unit}
                          {ev.sensorOrMethod ? ` · Method: ${ev.sensorOrMethod}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : (
        <div role="tabpanel" aria-labelledby="tab-compare" tabIndex={0} className="tabpanel stack-lg">
          <div className="card stack-sm">
            <div className="card-header">
              <h2 className="card-title">Compare 2–4 Tests Side by Side ({compareIds.length}/4)</h2>
              <div className="btn-group">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setCompareIds(['BASS-II-B1', 'BASS-II-B10', 'BASS-II-M1'])}
                >
                  Preset: BASS-II FT vs SE Extinction
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setCompareIds(['CFI-1206', 'CFI-1207'])}
                >
                  Preset: CFI Cool Flames
                </button>
              </div>
            </div>

            <div className="btn-group">
              {compareIds.map((cid) => (
                <button
                  key={cid}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => compareIds.length > 2 && setCompareIds((prev) => prev.filter((x) => x !== cid))}
                  title="Remove from comparison (min 2)"
                >
                  <span className="mono">{cid}</span> ×
                </button>
              ))}

              <div className="field" style={{ minInlineSize: 220 }}>
                <label htmlFor="cmp-add" className="visually-hidden">Add test to comparison</label>
                <select id="cmp-add" value={candidateAddId} onChange={(e) => setCandidateAddId(e.target.value)}>
                  {tests.slice(0, 120).map((t) => (
                    <option key={t.testId} value={t.testId}>
                      {t.testId} ({t.inv})
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={compareIds.length >= 4 || compareIds.includes(candidateAddId)}
                onClick={() => setCompareIds((prev) => [...prev, candidateAddId])}
              >
                + Add Test
              </button>
            </div>
          </div>

          {comparisonAnalysis ? (
            <section className="card stack-md" aria-label="Comparison admissibility diagnostics">
              <div className="card-header">
                <h2 className="card-title">Causal Contrast Verdict</h2>
                <StatusPill
                  tone={comparisonAnalysis.confounded ? 'danger' : 'ok'}
                  icon={comparisonAnalysis.confounded ? '⚠' : '✓'}
                  label={comparisonAnalysis.confounded ? 'Confounded / Inadmissible Contrast' : 'Admissible Contrast'}
                />
              </div>

              <div className={`banner ${comparisonAnalysis.confounded ? 'banner-warn' : 'banner-ok'}`}>
                <span>{comparisonAnalysis.causalWarning}</span>
              </div>

              <div className="pill-row">
                <StatusPill tone="ok" label={`Shared: ${comparisonAnalysis.sharedFactors.length}`} />
                <StatusPill tone="warn" label={`Changed: ${comparisonAnalysis.changedFactors.join(', ') || 'None'}`} />
                <StatusPill tone="neutral" label={`Unknown/Assumed: ${comparisonAnalysis.unknownFactors.join(', ') || 'None'}`} />
              </div>

              <div className="table-wrapper" tabIndex={0} role="region" aria-label="Side by side test matrix">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Parameter / Dimension</th>
                      {comparedTests.map((t, i) => (
                        <th key={t.testId} scope="col">
                          <div className="mono">{t.testId}</div>
                          <VerdictBadge verdict={comparisonAnalysis.decisions[i].verdict} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonAnalysis.fields.map((row) => (
                      <tr key={row.label}>
                        <th scope="row">{row.label}</th>
                        {row.values.map((v, idx) => (
                          <td key={`${row.label}-${idx}`}>{v}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <div className="grid-2">
            <ScatterPlotSvg
              title="O2 Concentration (%) vs Initial Flow Velocity (cm/s)"
              xLabel="Initial Flow Velocity (cm/s)"
              yLabel="O2 Concentration (%)"
              points={o2FlowPoints}
            />
            <MultiLineSeriesSvg
              title="BASS-II Table 5.1: Spread Rate (mm/s) vs Opposed/Concurrent Flow Velocity"
              xLabel="Flow Velocity (cm/s)"
              yLabel="Spread Rate (mm/s)"
              series={bassTableSeries}
            />
          </div>

          {sameRPoints.length > 0 ? (
            <ScatterPlotSvg
              title="SAME-R: Smoke Particle Diameter (nm) vs Net Aging Time (sec)"
              xLabel="Net Aging Time (sec)"
              yLabel="Particle Size (nm)"
              points={sameRPoints}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
