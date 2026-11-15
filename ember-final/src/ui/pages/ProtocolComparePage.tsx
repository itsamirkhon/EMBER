import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  compareTests,
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

  const comparedTests = useMemo(
    () => compareIds.map((id) => testById.get(id)).filter((test): test is Test => Boolean(test)),
    [compareIds, testById],
  );

  // Every pair uses the same domain verdict as review/API/export; UI only renders it.
  const comparisons = useMemo(
    () => comparedTests.flatMap((test, index) =>
      comparedTests.slice(index + 1).map((other) => compareTests(activeQuery, test, other))),
    [comparedTests, activeQuery],
  );

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
      const points = vel.flatMap((velocity, index) => Number.isFinite(velocity) && Number.isFinite(spr[index]) ? [{ x: velocity, y: spr[index] }] : []);
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
          <h1>Compare experiments</h1>
          <p className="page-lead">
            Put two tests or investigations side by side: their conditions, the sequence of each test, and what differs. Similar records describe; they do not prove cause and effect.
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

          <p className="muted">Query: {activeQuery.rawQuestion} · Endpoint: {activeQuery.targetEndpoint ?? 'unspecified'}. All {comparisons.length} selected pairs are evaluated independently.</p>
          {comparisons.map((comparison) => (
            <section key={comparison.id} className="card stack-md" aria-label={`Scientific comparison ${comparison.testAId} and ${comparison.testBId}`}>
              <div className="card-header">
                <h2 className="card-title">{comparison.testAId} vs {comparison.testBId}</h2>
                <StatusPill tone="info" label={`Endpoint: ${comparison.endpoint ?? 'unspecified'}`} />
              </div>
              <div className="grid-2">
                <div>
                  <h3>Observation comparability</h3>
                  <StatusPill tone={comparison.observationComparability.status === 'comparable' ? 'ok' : 'warn'} label={comparison.observationComparability.status} />
                  <p>{comparison.observationComparability.reasons.join(' ')}</p>
                  <p>Quantitative comparison: {comparison.observationComparability.quantitativeAllowed ? 'allowed' : 'not established'}.</p>
                </div>
                <div>
                  <h3>Causal boundary</h3>
                  <StatusPill tone="neutral" label={comparison.causalSupport.status} />
                  <p>{comparison.causalSupport.reasons.join(' ')}</p>
                </div>
              </div>
              <div>
                <h3>Applicability to this query</h3>
                <div className="pill-row">
                  <span className="mono">{comparison.testAId}</span><VerdictBadge verdict={comparison.applicabilityToQuery.a.verdict} />
                  <span className="mono">{comparison.testBId}</span><VerdictBadge verdict={comparison.applicabilityToQuery.b.verdict} />
                </div>
                {[comparison.applicabilityToQuery.a, comparison.applicabilityToQuery.b].map((decision) => (
                  <p key={decision.testId}><strong>{decision.testId}:</strong> {decision.rules.filter((rule) => rule.status !== 'pass').map((rule) => rule.reason).join(' ') || 'Query applicability rules passed; this does not establish causal control.'}</p>
                ))}
              </div>
              <div className="grid-2">
                {[comparison.observations.a, comparison.observations.b].map((observation) => (
                  <div key={observation.testId}>
                    <h3>{observation.testId}: {observation.status}</h3>
                    <p>{observation.label}</p>
                    <p className="muted">Segments: {observation.segmentIds.join(', ') || 'none resolved'} · Events: {observation.eventIds.join(', ') || 'none resolved'}</p>
                  </div>
                ))}
              </div>
              {comparison.numericDelta ? <p>Observed difference: {comparison.numericDelta.value} {comparison.numericDelta.unit} · {comparison.numericDelta.definition}</p> : null}
              <div className="table-wrapper" tabIndex={0} role="region" aria-label="Engine factor comparison">
                <table>
                  <thead><tr><th scope="col">Factor</th><th scope="col">{comparison.testAId}</th><th scope="col">{comparison.testBId}</th><th scope="col">Status / basis</th></tr></thead>
                  <tbody>{comparison.factors.map((factor) => (
                    <tr key={factor.factor}>
                      <th scope="row">{factor.factor} ({factor.relevance})</th>
                      <td>{String(factor.valueA.value ?? 'unknown')} {factor.valueA.unit} · {factor.valueA.provenance}</td>
                      <td>{String(factor.valueB.value ?? 'unknown')} {factor.valueB.unit} · {factor.valueB.provenance}</td>
                      <td><strong>{factor.status}</strong>: {factor.reason}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div><h3>Interpretation limits</h3><ul>{comparison.limitations.map((limit, index) => <li key={index}>{limit}</li>)}</ul></div>
              <div><h3>Unsupported inferences</h3><ul>{comparison.prohibitedInferences.map((inference, index) => <li key={index}>{inference}</li>)}</ul></div>
              <p><strong>Next action:</strong> {comparison.nextAction}</p>
              <div className="btn-group">{comparison.sourceRefs.map((source, index) => (
                <button key={`${source.sourceId}-${index}`} type="button" className="btn btn-sm" onClick={() => openSourceRef(source)}>
                  Verify {source.sourceId} {formatLocator(source)}
                </button>
              ))}</div>
            </section>
          ))}

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
