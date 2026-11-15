import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { parseResearchQuery, rankInvestigationsV2, type CorpusV2, type FuelPhase, type InvestigationRankV2 } from '../../../core';
import { useEmber } from '../../context/EmberContext';
import { invColor } from '../EvidenceMap';
import {
  MISSION_SHORT, PLAIN, TASKS, cliffStats, fmt, fmtG, kpaToPsi, lensFromMission, lensOverrides, nearestTests, outcomeText, useCompact,
  type LensInput, type Plain,
} from '../data';
import { AtmosphereBar, Ext, GapChips, Loading, PageHead, PlainBadge, ScaleBar } from '../ui';

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

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

interface EngineResult {
  status: Plain;
  admissible: number;
  conditional: number;
  rankings: InvestigationRankV2[];
  reasons: string[];
  warnings: string[];
}

function runEngine(corpus: CorpusV2, l: LensInput): EngineResult {
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
  const { data } = useCompact();
  const { ensureCorpus } = useEmber();
  const [params, setParams] = useSearchParams();
  const [corpus, setCorpus] = useState<CorpusV2 | null>(null);
  const [corpusError, setCorpusError] = useState<string | null>(null);
  const [l, setL] = useState<LensInput>(DEFAULT);

  useEffect(() => {
    ensureCorpus().then(setCorpus, (e: unknown) => setCorpusError(String(e)));
  }, [ensureCorpus]);

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

  const dl = useDebounced(l, 160);
  const engine = useMemo(() => (corpus ? runEngine(corpus, dl) : null), [corpus, dl]);
  const nearest = useMemo(() => (data ? nearestTests(l, data.rows, 3) : []), [data, l]);
  const cliff = useMemo(() => (data ? cliffStats(data.rows) : null), [data]);
  const set = (patch: Partial<LensInput>) => setL((p) => ({ ...p, ...patch }));
  const setCustom = (patch: Partial<LensInput>) => setL((p) => ({ ...p, ...patch, missionId: 'custom' }));
  const stale = engine !== null && dl !== l;

  if (!data) return <div className="v3-page"><Loading what="Loading NASA PSI data…" /></div>;
  const mission = data.missions.find((m) => m.id === l.missionId);
  const env = l.missionId === 'custom' ? 'Custom cabin' : MISSION_SHORT[l.missionId] ?? mission?.label ?? 'Cabin';

  return (
    <div className="v3-page">
      <PageHead eyebrow="Mission lens" title="Does NASA’s data cover your cabin?">
        Pick an environment, a task and a material. EMBER runs every one of the {data.counts.tests.toLocaleString('en-US')} test records through
        nine applicability rules and tells you, in plain words, whether real flight tests apply.
      </PageHead>

      <div className="v3-split">
        <section className="v3-card v3-controls" aria-label="Your scenario">
          <h2 className="v3-h3">1 · Environment</h2>
          <div className="v3-missions" role="group" aria-label="Environment">
            {data.missions.map((m) => (
              <button key={m.id} type="button" className="v3-mission" aria-pressed={l.missionId === m.id} onClick={() => setL((p) => lensFromMission(m, p))}>
                <b>{MISSION_SHORT[m.id] ?? m.label}</b>
                <span>
                  {fmt(m.o2Pct)}% O₂ · {fmt(m.pressureKpa)} kPa · {fmtG(m.gravityG ?? 0)}
                </span>
              </button>
            ))}
            <button type="button" className="v3-mission" aria-pressed={l.missionId === 'custom'} onClick={() => set({ missionId: 'custom' })}>
              <b>Custom</b>
              <span>your own values</span>
            </button>
          </div>
          {mission?.assumption && <p className="v3-small v3-warn-text">Some values for this environment are EMBER assumptions, not NASA specifications.</p>}

          <h2 className="v3-h3">2 · Task</h2>
          <div className="v3-seg v3-seg-wrap" role="group" aria-label="Task">
            {TASKS.map((t) => (
              <button key={t.id} type="button" aria-pressed={l.task === t.id} onClick={() => set({ task: t.id })} title={t.hint}>
                {t.label}
              </button>
            ))}
          </div>
          <p className="v3-small v3-muted">{TASKS.find((t) => t.id === l.task)?.hint}</p>

          <h2 className="v3-h3">3 · Material</h2>
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

          <h2 className="v3-h3">4 · Atmosphere</h2>
          <div className="v3-slider">
            <div className="v3-slider-head">
              <label htmlFor="lens-o2">Oxygen</label>
              <output htmlFor="lens-o2">{fmt(l.o2)}%</output>
            </div>
            <input id="lens-o2" type="range" min={10} max={100} step={0.5} value={l.o2} onChange={(e) => setCustom({ o2: Number(e.target.value) })} />
            {cliff && (
              <div className="v3-slider-mark" style={{ left: `${((cliff.o2Max - 10) / 90) * 100}%` }} aria-hidden>
                <span>last solid flight test {fmt(cliff.o2Max)}%</span>
              </div>
            )}
          </div>
          <div className="v3-slider">
            <div className="v3-slider-head">
              <label htmlFor="lens-p">Pressure</label>
              <output htmlFor="lens-p">
                {fmt(l.kPa)} kPa <span className="v3-muted">· {kpaToPsi(l.kPa).toFixed(1)} psi</span>
              </output>
            </div>
            <input id="lens-p" type="range" min={20} max={110} step={0.5} value={l.kPa} onChange={(e) => setCustom({ kPa: Number(e.target.value) })} />
          </div>
          <div className="v3-fields v3-fields-3">
            <label>
              <span>Airflow min, cm/s</span>
              <input type="number" min={0} max={100} value={l.flow[0]} onChange={(e) => setCustom({ flow: [Number(e.target.value) || 0, Math.max(Number(e.target.value) || 0, l.flow[1])] })} />
            </label>
            <label>
              <span>Airflow max, cm/s</span>
              <input type="number" min={0} max={100} value={l.flow[1]} onChange={(e) => setCustom({ flow: [Math.min(l.flow[0], Number(e.target.value) || 0), Number(e.target.value) || 0] })} />
            </label>
            <label>
              <span>Gravity, g</span>
              <input type="number" min={0} max={1} step={0.001} value={l.g} onChange={(e) => setCustom({ g: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })} />
            </label>
          </div>
          <AtmosphereBar o2={l.o2} kPa={l.kPa} />
        </section>

        <div className="v3-stack">
          <section className={`v3-card v3-verdict v3-verdict-${engine?.status ?? 'pending'}`} aria-live="polite">
            {!engine ? (
              corpusError ? (
                <div className="v3-callout v3-callout-warn">Could not load the full corpus: {corpusError}</div>
              ) : (
                <Loading what="Loading the full corpus (26 MB) to run the applicability rules…" />
              )
            ) : (
              <>
                <div className="v3-verdict-top">
                  <div>
                    <div className="v3-muted v3-small">
                      {l.material || `Any ${l.phase} material`} · {env} · {fmt(l.o2)}% O₂ · {fmt(l.kPa)} kPa · {fmtG(l.g)}
                    </div>
                    <PlainBadge status={engine.status} large />
                  </div>
                  <div className="v3-verdict-count">
                    <b>{engine.admissible}</b> tests apply
                    <br />
                    <b>{engine.conditional}</b> apply with caveats
                  </div>
                </div>
                <p className="v3-verdict-text">{PLAIN[engine.status].short}.</p>
                {engine.status !== 'measured' && engine.reasons.length > 0 && (
                  <ul className="v3-reasons">
                    {engine.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}
                {engine.status === 'beyond' && <p className="v3-small v3-muted">EMBER gives no fire-risk percentage here, or anywhere. The nearest real tests are below.</p>}
                {stale && <p className="v3-small v3-muted">Updating…</p>}
              </>
            )}
          </section>

          <section className="v3-card" aria-labelledby="near-h">
            <h2 id="near-h" className="v3-h2">Nearest real flight tests</h2>
            <p className="v3-small v3-muted">
              Closest {l.phase}-fuel flight records to your conditions, and how far each one is on every axis. A grey chip is the same; amber is a
              small gap; orange is a large gap or unknown.
            </p>
            <div className="v3-nearest">
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
                    {fmt(n.row.o2)}% O₂ · {fmt(n.row.kPa)} kPa · {n.row.flow === null ? 'airflow not reported' : `${fmt(n.row.flow)} cm/s`} · {fmtG(n.row.g ?? 0)}
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
              <div className="v3-eyebrow">Next experiment</div>
              <h2 id="next-h" className="v3-h2">The flight test that would shrink this gap most</h2>
              <p>
                Burn <b>{l.material || nearest[0].row.fuel || `a ${l.phase} sample`}</b> at <b>{fmt(l.o2)}% O₂ and {fmt(l.kPa)} kPa</b>
                {l.flow[1] > 0 ? <>, with airflow across {l.flow[0]}–{l.flow[1]} cm/s,</> : ''} in microgravity first, using the same kind of flow
                duct as {nearest[0].row.inv}. Today the nearest flown test is {nearest[0].row.testId} at {fmt(nearest[0].row.o2)}% O₂ and{' '}
                {fmt(nearest[0].row.kPa)} kPa.
                {l.g > 0.01 && <> A test at {fmtG(l.g)} would then be needed too: no partial-gravity combustion flight data exist in PSI.</>}
              </p>
              <p className="v3-small v3-muted">
                Derived from the gap between your conditions and the nearest record; it is a pointer to missing data, not a test plan.
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
