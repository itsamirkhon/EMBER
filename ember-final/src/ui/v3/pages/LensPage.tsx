import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { parseResearchQuery, rankInvestigationsV2, type CorpusV2, type FuelPhase, type InvestigationRankV2 } from '../../../core';
import { useEmber } from '../../context/EmberContext';
import { invColor } from '../EvidenceMap';
import {
  MISSION_SHORT, PLAIN, TASKS, cliffStats, fmt, fmtG, kpaToPsi, lensFromMission, lensOverrides, nearestTests, outcomeText, useCompact,
  type LensInput, type Plain,
} from '../data';
import { AtmosphereBar, Ext, GapChips, Loading, PageHead, PlainBadge, ScaleBar, Term } from '../ui';

const DEFAULT: LensInput = { missionId: 'lunar-rover', o2: 30, kPa: 70.3, flow: [0, 20], g: 0.166, phase: 'solid', material: 'PMMA', task: 'material_screening' };

/** Plain-language reasons for the engine's rule codes. */
const REASON: Record<string, string> = {
  gravity_regime_gap: 'Gravity differs: every flight test ran in microgravity; none at lunar or Martian gravity.',
  simulated_analogue_gravity: 'Only a simulated-gravity analogue exists for this, not a flight test.',
  out_of_tested_envelope: 'Your oxygen, pressure or airflow lie outside the combinations that were tested.',
  unsupported_joint_combination: 'Each value was tested somewhere, but never together in one test.',
  material_mismatch: 'The tests used a different material.',
  endpoint_mismatch: 'The tests did not record the outcome this task needs.',
  assumed_provenance_cap: 'The atmosphere of these tests was assumed, not measured.',
  unknown_field_mismatch: 'A condition this needs was not reported in the source.',
  oxidizer_stream_vs_ambient: 'Oxygen was supplied in a burner stream, not as cabin air.',
  thickness_regime_mismatch: 'Different sample thickness or geometry.',
  enclosure_scale_mismatch: 'Different scale: small flow duct vs a large enclosure.',
  planned_only_matrix: 'Planned tests only; results not yet published.',
  protocol_or_flow_mismatch: 'The test sequence or airflow history differs.',
  operator_termination_not_physical_extinction: 'The crew stopped the test; that is not a measured extinction limit.',
  cool_flame_continuation_caveat: 'Cool flames continued after the hot flame went out.',
};

const REASON_ORDER = [
  'gravity_regime_gap', 'out_of_tested_envelope', 'unsupported_joint_combination', 'simulated_analogue_gravity', 'oxidizer_stream_vs_ambient',
  'assumed_provenance_cap', 'endpoint_mismatch', 'unknown_field_mismatch', 'material_mismatch', 'thickness_regime_mismatch',
  'enclosure_scale_mismatch', 'protocol_or_flow_mismatch', 'operator_termination_not_physical_extinction', 'cool_flame_continuation_caveat', 'planned_only_matrix',
];

export interface EngineResult {
  status: Plain;
  admissible: number;
  conditional: number;
  rankings: InvestigationRankV2[];
  reasons: string[];
  warnings: string[];
}

/** Browser number inputs are not a guarantee against pasted out-of-range values. */
export function clampFlowInput(raw: string): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

export function runEngine(corpus: CorpusV2, l: LensInput): EngineResult {
  const q = parseResearchQuery('', lensOverrides(l), { applyEnvironmentDefaults: false });
  const rankings = rankInvestigationsV2(q, corpus);
  const admissible = rankings.reduce((s, r) => s + r.admissibleCount, 0);
  const conditional = rankings.reduce((s, r) => s + r.conditionalCount, 0);
  const status: Plain = admissible > 0 ? 'measured' : conditional > 0 ? 'nearby' : 'beyond';
  // Explain the status with the investigations that best answer the question (same phase, highest relevance).
  const best = Math.max(0, ...rankings.filter((x) => x.inv.fuelPhase === l.phase).map((x) => x.relevanceScore));
  const codes = new Set(rankings.filter((x) => x.inv.fuelPhase === l.phase && x.relevanceScore >= best - 0.01).flatMap((x) => x.topReasonCodes));
  const reasons = REASON_ORDER.filter((c) => codes.has(c)).map((c) => REASON[c]).slice(0, 3);
  return { status, admissible, conditional, rankings, reasons, warnings: q.validationWarnings };
}

export function LensPage() {
  const { data, error: compactError } = useCompact();
  const { ensureCorpus } = useEmber();
  const [params, setParams] = useSearchParams();
  const [l, setL] = useState<LensInput>(DEFAULT);
  const [lastCheck, setLastCheck] = useState<{ signature: string; result: EngineResult } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  // ?mission=<id> from the map
  const missionParam = params.get('mission');
  useEffect(() => {
    if (!data || !missionParam) return;
    const m = data.missions.find((x) => x.id === missionParam);
    if (m) setL((p) => lensFromMission(m, p));
    setParams({}, { replace: true });
  }, [data, missionParam, setParams]);

  const materials = useMemo(() => {
    if (!data) return [];
    const counts = new Map<string, number>();
    for (const r of data.rows) if (r.phase === l.phase && r.fuel && r.gravityMode === 'actual_flight') counts.set(r.fuel, (counts.get(r.fuel) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
  }, [data, l.phase]);

  const signature = JSON.stringify(l);
  const engine = lastCheck?.signature === signature ? lastCheck.result : null;
  const nearest = useMemo(() => (data ? nearestTests(l, data.rows, 3) : []), [data, l]);
  const cliff = useMemo(() => (data ? cliffStats(data.rows) : null), [data]);
  const set = (patch: Partial<LensInput>) => setL((p) => ({ ...p, ...patch }));
  const setCustom = (patch: Partial<LensInput>) => setL((p) => ({ ...p, ...patch, missionId: 'custom' }));

  const checkHistoricalEvidence = async () => {
    const scenario = l;
    const scenarioSignature = signature;
    setChecking(true);
    setCheckError(null);
    try {
      // Evaluates records already published in NASA PSI. This DOES NOT perform
      // a new experiment, simulation, design certification or fire prediction.
      const corpus = await ensureCorpus();
      const result = runEngine(corpus, scenario);
      setLastCheck({ signature: scenarioSignature, result });
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  if (!data) return <div className="v3-page">{compactError ? <div role="alert" className="v3-callout v3-callout-warn">Could not load NASA PSI data: {compactError}</div> : <Loading what="Loading NASA PSI data…" />}</div>;
  const mission = data.missions.find((m) => m.id === l.missionId);
  const env = l.missionId === 'custom' ? 'Custom cabin' : MISSION_SHORT[l.missionId] ?? mission?.label ?? 'Cabin';

  return (
    <div className="v3-page">
      <PageHead eyebrow="Mission lens" title="Does NASA’s data cover your cabin?">
        Select a hypothetical environment, task and material. Then check how {data.counts.tests.toLocaleString('en-US')} existing NASA PSI records
        compare under nine applicability rules. No physical tests are run, and these results do not predict fire risk or certify safety.
      </PageHead>

      <div className="v3-split">
        <section className="v3-card v3-controls" aria-label="Your scenario">
          <h2 className="v3-h3"><span className="v3-step-n">1</span> Pick a cabin</h2>
          <div className="v3-missions" role="group" aria-label="Environment">
            {data.missions.map((m) => (
              <button key={m.id} type="button" className="v3-mission" aria-pressed={l.missionId === m.id} onClick={() => setL((p) => lensFromMission(m, p))}>
                <b>{MISSION_SHORT[m.id] ?? m.label}</b>
                <span>
                  {fmt(m.o2Pct)}% O₂ · {fmt(m.pressureKpa)} kPa · {m.gravityG === null ? 'gravity not reported' : fmtG(m.gravityG)}
                </span>
              </button>
            ))}
            <button type="button" className="v3-mission" aria-pressed={l.missionId === 'custom'} onClick={() => set({ missionId: 'custom' })}>
              <b>Custom</b>
              <span>your own values</span>
            </button>
          </div>
          {mission && (
            <div className="v3-small v3-muted">
              {mission.assumption || Object.values(mission.assumptionDetail ?? {}).some(Boolean) ? (
                <p className="v3-warn-text">
                  Scenario values are not all NASA operational specifications.
                  {Object.entries(mission.assumptionDetail ?? {}).filter(([, assumed]) => assumed)
                    .map(([field]) => field === 'flowCmS' ? 'airflow' : field === 'o2Pct' ? 'oxygen' : field === 'pressureKpa' ? 'pressure' : 'gravity')
                    .join(', ') && (
                    <> Assumed: {Object.entries(mission.assumptionDetail ?? {}).filter(([, assumed]) => assumed)
                      .map(([field]) => field === 'flowCmS' ? 'airflow' : field === 'o2Pct' ? 'oxygen' : field === 'pressureKpa' ? 'pressure' : 'gravity')
                      .join(', ')}.</>
                  )}
                </p>
              ) : null}
              {mission.flowCmS === null && <p className="v3-warn-text">NASA ventilation speed was not reported for this preset. The 0–20 cm/s input is an exploratory assumption.</p>}
              {mission.sources.length > 0 && <p>Preset basis: <Ext href={mission.sources[0].url}>{mission.sources[0].label}</Ext>. Inspect the source before using these conditions.</p>}
            </div>
          )}

          <h2 className="v3-h3"><span className="v3-step-n">2</span> What are you checking?</h2>
          <div className="v3-seg v3-seg-wrap" role="group" aria-label="Task">
            {TASKS.map((t) => (
              <button key={t.id} type="button" aria-pressed={l.task === t.id} onClick={() => set({ task: t.id })} title={t.hint}>
                {t.label}
              </button>
            ))}
          </div>
          <p className="v3-small v3-muted">{TASKS.find((t) => t.id === l.task)?.hint}</p>

          <h2 className="v3-h3"><span className="v3-step-n">3</span> Material</h2>
          <div className="v3-fields">
            <label>
              <span>Fuel type</span>
              <select value={l.phase} onChange={(e) => set({ phase: e.target.value as FuelPhase, material: '' })}>
                <option value="solid">Solid (fabric, plastic, lining)</option>
                <option value="liquid">Liquid (droplets)</option>
                <option value="gas">Gas (burner flame)</option>
              </select>
            </label>
            <label>
              <span>Material in the tests</span>
              <select value={l.material} onChange={(e) => set({ material: e.target.value })}>
                <option value="">Any {l.phase} material</option>
                {materials.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <h2 className="v3-h3">4 · Atmosphere to check</h2>
          <p className="v3-small v3-muted">
            These controls define a scenario for comparison with existing records. They do not select a safe atmosphere,
            run a combustion simulation or recommend oxygen and pressure settings.
          </p>
          <div className="v3-slider">
            <div className="v3-slider-head">
              <label htmlFor="lens-o2"><Term k="o2">Oxygen</Term></label>
              <output htmlFor="lens-o2">{fmt(l.o2)}%</output>
            </div>
            <input id="lens-o2" type="range" min={10} max={100} step={0.5} value={l.o2} onChange={(e) => setCustom({ o2: Number(e.target.value) })} />
            {cliff && Number.isFinite(cliff.o2Max) && (
              <div className="v3-slider-mark" style={{ left: `${((cliff.o2Max - 10) / 90) * 100}%` }} aria-hidden>
                <span>last solid flight test {fmt(cliff.o2Max)}%</span>
              </div>
            )}
          </div>
          <div className="v3-slider">
            <div className="v3-slider-head">
              <label htmlFor="lens-p"><Term k="kpa">Pressure</Term></label>
              <output htmlFor="lens-p">
                {fmt(l.kPa)} kPa <span className="v3-muted">· {kpaToPsi(l.kPa).toFixed(1)} psi</span>
              </output>
            </div>
            <input id="lens-p" type="range" min={20} max={110} step={0.5} value={l.kPa} onChange={(e) => setCustom({ kPa: Number(e.target.value) })} />
          </div>
          <div className="v3-fields v3-fields-3">
            <label>
              <span>Airflow min, cm/s</span>
              <input type="number" min={0} max={100} value={l.flow[0]} onChange={(e) => {
                const low = clampFlowInput(e.target.value);
                setCustom({ flow: [low, Math.max(low, l.flow[1])] });
              }} />
            </label>
            <label>
              <span>Airflow max, cm/s</span>
              <input type="number" min={0} max={100} value={l.flow[1]} onChange={(e) => {
                const high = clampFlowInput(e.target.value);
                setCustom({ flow: [Math.min(l.flow[0], high), high] });
              }} />
            </label>
            <label>
              <span><Term k="g">Gravity, g</Term></span>
              <input type="number" min={0} max={1} step={0.001} value={l.g} onChange={(e) => setCustom({ g: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })} />
            </label>
          </div>
          <AtmosphereBar o2={l.o2} kPa={l.kPa} />
        </section>

        <div className="v3-stack">
          <section className="v3-card v3-verdict" aria-live="polite" aria-labelledby="lens-status-h">
            <div className="v3-eyebrow">Historical evidence check</div>
            <h2 id="lens-status-h" className="v3-h2">What do existing experiments tell us?</h2>
            <p className="v3-small v3-muted">
              Run the applicability rules against the published PSI records for the selected
              scenario. This is a database check, not a new fire test, simulation or safety recommendation.
            </p>
            <div className="v3-row">
              <button type="button" className="v3-btn v3-btn-primary" onClick={() => void checkHistoricalEvidence()}
                disabled={checking}>
                {checking ? 'Checking recorded experiments…' : engine ? 'Check evidence again' : 'Check historical evidence'}
              </button>
              <span className="v3-small v3-muted">
                {lastCheck && !engine ? 'Scenario changed. Check again for an updated status.' :
                  engine ? 'Checked against the current scenario.' : 'No evidence check run for these settings.'}
              </span>
            </div>
            {checkError && <div className="v3-callout v3-callout-warn" role="alert">
              Evidence check failed: {checkError}
            </div>}
            {engine && (
              <div className="v3-stack" style={{ marginTop: 18 }}>
                <div className="v3-verdict-top">
                  <div>
                    <div className="v3-muted v3-small">
                      {l.material || 'Any ' + l.phase + ' material'} · {env} · {fmt(l.o2)}% O₂ · {fmt(l.kPa)} kPa · {fmtG(l.g)}
                    </div>
                    <PlainBadge status={engine.status} large />
                  </div>
                  <div className="v3-verdict-count">
                    <b>{engine.admissible}</b> matching recorded tests
                    <br />
                    <b>{engine.conditional}</b> records with caveats
                  </div>
                </div>
                <p className="v3-verdict-text">{PLAIN[engine.status].short}.</p>
                <p className="v3-small v3-muted">{PLAIN[engine.status].help}</p>
                {engine.reasons.length > 0 && engine.status !== 'measured' && (
                  <ul className="v3-reasons">
                    {engine.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                )}
                {engine.warnings.length > 0 && (
                  <div className="v3-callout v3-callout-warn">
                    {engine.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="v3-card" aria-labelledby="near-h">
            <h2 id="near-h" className="v3-h2">Nearest real flight tests</h2>
            <p className="v3-small v3-muted">
              Closest {l.phase}-fuel flight records with reported (not assumed) oxygen and pressure. These are analogues, not necessarily applicable tests. A plain chip is the same; an outlined chip is a
              small gap; a highlighted chip is a large gap or unknown.
            </p>
            <div className="v3-nearest">
              {nearest.length === 0 && <div className="v3-callout">No flight records with reported oxygen and pressure were found for this fuel phase. Unknown conditions cannot be ranked as close.</div>}
              {nearest.map((n) => (
                <article key={n.row.testId} className="v3-near">
                  <div className="v3-near-head">
                    <span className="v3-swatch" style={{ background: invColor(n.row.inv) }} />
                    <b>
                      {n.row.inv} · {n.row.testId}
                    </b>
                    <span className="v3-muted">{n.row.fuel ?? 'material not reported'}</span>
                  </div>
                  <div className="v3-near-cond">
                    {fmt(n.row.o2)}% O₂ · {fmt(n.row.kPa)} kPa · {n.row.flow === null ? 'airflow not reported' : `${fmt(n.row.flow)} cm/s`} · {n.row.g === null ? 'gravity not reported' : fmtG(n.row.g)}
                  </div>
                  <GapChips gaps={n.gaps} />
                  <div className="v3-near-out">
                    Result: <b>{outcomeText(n.row.outcome, n.row.terminal)}</b>
                    {n.row.spreadMmS !== null && <> · spread {fmt(n.row.spreadMmS, 2)} mm/s</>}
                  </div>
                  <div className="v3-small v3-muted">
                    Source: <Ext href={n.row.url}>{n.row.table ?? n.row.inv}</Ext>
                    {n.row.row !== null ? `, row ${n.row.row}` : ''}
                  </div>
                </article>
              ))}
            </div>
          </section>

          {engine && (
            <section className="v3-card" aria-labelledby="rank-h">
              <h2 id="rank-h" className="v3-h2">Investigations, ranked for your question</h2>
              <p className="v3-small v3-muted">
                Three separate scales, never merged into one risk number: does it <b>answer your question</b> (fuel, material, task), does it{' '}
                <b>match your conditions</b> (share of tests that pass the rules), and how <b>reliable is the data</b> (number of tests, flight vs
                ground, raw data, assumed values).
              </p>
              <ol className="v3-rank">
                {engine.rankings.slice(0, 6).map((r) => (
                  <li key={r.inv.id}>
                    <div className="v3-rank-head">
                      <span className="v3-swatch" style={{ background: invColor(r.inv.id) }} />
                      <Link to={`/investigations/${encodeURIComponent(r.inv.id)}`}>
                        <b>{r.inv.id}</b> · {r.inv.name}
                      </Link>
                      <span className="v3-muted v3-small">
                        {r.admissibleCount} apply · {r.conditionalCount} with caveats
                      </span>
                    </div>
                    <ScaleBar label="Answers your question" value={r.relevanceScore} />
                    <ScaleBar label="Matches your conditions" value={r.applicabilityScore} />
                    <ScaleBar label="Data reliability" value={r.evidenceQualityScore} />
                  </li>
                ))}
              </ol>
            </section>
          )}

          {engine && engine.status !== 'measured' && nearest[0] && (
            <section className="v3-card v3-next" aria-labelledby="next-h">
              <div className="v3-eyebrow">Research gap · not a test protocol</div>
              <h2 id="next-h" className="v3-h2">Evidence still needed for this scenario</h2>
              <p>
                The nearest recorded {l.phase}-fuel test, <b>{nearest[0].row.testId}</b> ({nearest[0].row.inv}),
                used <b>{fmt(nearest[0].row.o2)}% O₂</b> and <b>{fmt(nearest[0].row.kPa)} kPa</b>,
                whereas your scenario specifies <b>{fmt(l.o2)}% O₂</b> and <b>{fmt(l.kPa)} kPa</b>.
                {l.g > 0.01 && <> The scenario is at {fmtG(l.g)}, which existing microgravity flight records cannot directly validate.</>}
              </p>
              <p className="v3-small v3-muted">
                This identifies missing experimental coverage; it is not a proposed burn procedure, validated protocol,
                or proof that any material is safe or unsafe.
              </p>
            </section>
          )}

          <div className="v3-row">
            <Link to="/ask" className="v3-btn">
              Ask a question about this
            </Link>
            <Link to="/compare" className="v3-btn v3-btn-ghost">
              Compare protocols →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
