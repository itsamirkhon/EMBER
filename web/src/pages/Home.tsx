import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import ScenarioEditor, { flowText } from '../components/ScenarioEditor';
import { scenarioQuery, useData, useEmber } from '../data/context';
import { DEFAULT_WEIGHTS, estimate, groupTests, keywordRuleShare, proximityKernel, rankInvestigations, type Relevance, type RelevanceWeights } from '../lib/evidence';
import {
  AnswerBadge, DirectionTags, FindingBadge, findSource, fmtGravity, fmtNum, fmtPct, Meter, SourceLink, Term,
} from '../components/ui';
import type { Investigation } from '../lib/types';

export function microgravityTests<T extends { gravityG: number | null }>(tests: T[]): T[] {
  return tests.filter((t) => t.gravityG === null || t.gravityG <= 0.01);
}

function WeightSlider({ k, label, weights, setWeights }: { k: keyof RelevanceWeights; label: string; weights: RelevanceWeights; setWeights: (w: RelevanceWeights) => void }) {
  return (
    <div className="field">
      <div className="label-row">
        <label htmlFor={`w-${k}`}>{label}</label>
        <output htmlFor={`w-${k}`}>{weights[k].toFixed(1)}</output>
      </div>
      <input id={`w-${k}`} type="range" min={0} max={3} step={0.5} value={weights[k]} onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} />
    </div>
  );
}

type KeywordShare = ReturnType<typeof keywordRuleShare>;

function RankItem({ r, rank, invs, keyword }: { r: Relevance; rank: number; invs: Investigation[]; keyword?: KeywordShare }) {
  const inv = r.inv;
  const kf = inv.keyFindings[0];
  const p = r.proximity;
  return (
    <li className="card rank-item">
      <div className="rank-num" aria-label={`Rank ${rank}`}>{rank}</div>
      <div>
        <div className="panel-title">
          <div>
            <h3 style={{ marginBottom: 2 }}>
              <Link to={`/investigations/${encodeURIComponent(inv.id)}`}>{inv.name}</Link>
            </h3>
            <div className="row small muted">
              <span>{inv.id}</span>
              {inv.psi && <span>· {inv.psi}</span>}
              <span>· {inv.family}</span>
              <span>· {inv.fuelPhase ?? 'phase n/a'} fuel</span>
              <DirectionTags dirs={inv.direction} />
              {keyword && keyword.share !== null && keyword.share > 0.5 && (
                <span
                  className="tag tag-caveat"
                  title={`${keyword.keyword} of ${keyword.withOutcome} burn / no-burn outcomes were parsed by keyword rules from free-text test notes, not read from a results column.`}
                >
                  outcomes parsed from notes
                </span>
              )}
              {inv.conditions?.assumed?.length ? (
                <span className="tag tag-caveat" title={inv.conditions.assumptionNote}>
                  assumed O₂ / pressure
                </span>
              ) : null}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="rank-score" title="Relevance score (0–1)">{r.score.toFixed(2)}</div>
            <FindingBadge status={r.status} />
          </div>
        </div>
        {inv.resultSummary && <p style={{ marginBottom: 6 }}>{inv.resultSummary}</p>}
        {kf && (
          <p className="small" style={{ marginBottom: 6 }}>
            <strong>Key finding:</strong> {kf.text}{' '}
            <SourceLink source={findSource(kf.sourceId, invs, inv)} fallback={kf.sourceId ? `[${kf.sourceId}]` : '[no source]'} />
          </p>
        )}
        <ul className="small" style={{ margin: '0 0 8px', paddingLeft: 18, color: 'var(--text-2)' }}>
          {r.statusReasons.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
        <details>
          <summary>Why this score</summary>
          <div className="stack">
            <Meter label="Consequence" value={r.consequence} hint="safetyConsequence / 3" />
            <Meter label="Evidence" value={r.evidence.score} hint="tests, flight, raw data" />
            <Meter label="Proximity" value={p.score} hint="closeness to mission conditions" />
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Consequence {inv.safetyConsequence}/3 ({inv.safetyConsequence >= 3 ? 'direct fire-safety answer' : inv.safetyConsequence === 2 ? 'partial' : 'fundamental combustion'}).</li>
              <li>
                Evidence: {inv.nTests ?? '?'} tests (score {r.evidence.nTestsScore.toFixed(2)}), {inv.flight ? 'flight' : inv.flight === false ? 'ground only (×0.6)' : 'flight status unknown'},{' '}
                {inv.rawDataAvailable ? 'raw data available' : 'no raw data (×0.8)'}.
              </li>
              <li>
                Proximity: nearest {p.basis === 'tests' ? 'test' : p.basis === 'ranges' ? 'tested range' : 'condition (undocumented)'} is {p.distance.toFixed(2)}{' '}
                <Term k="normdist">normalized units</Term> away → 1/(1+(d/2)²) = {proximityKernel(p.distance).toFixed(2)}
                {p.phaseFactor !== 1 && <> × phase factor {p.phaseFactor}</>}.
              </li>
            </ul>
          </div>
        </details>
        <div className="row small" style={{ marginTop: 8 }}>
          <Link to={`/investigations/${encodeURIComponent(inv.id)}`}>Open card</Link>
          <Link to={`/compare?ids=${encodeURIComponent(inv.id)}`}>Compare</Link>
          <Link to={`/what-if`}>What-if at these conditions</Link>
        </div>
      </div>
    </li>
  );
}

export default function Home() {
  const { scenario, weights, setWeights } = useEmber();
  const { investigations, tests, history } = useData();
  const q = useMemo(() => scenarioQuery(scenario), [scenario]);
  const ranked = useMemo(() => rankInvestigations(investigations, tests, q, weights), [investigations, tests, q, weights]);
  const overall = useMemo(() => estimate(q, microgravityTests(tests)), [q, tests]);
  const keywordShares = useMemo(() => {
    const m = new Map<string, KeywordShare>();
    for (const [id, rows] of groupTests(tests)) m.set(id, keywordRuleShare(rows));
    return m;
  }, [tests]);
  const counts = { known: 0, extrapolating: 0, unknown: 0 };
  ranked.forEach((r) => (counts[r.status] += 1));

  return (
    <>
      <section style={{ marginBottom: 24 }}>
        <div className="eyebrow">Mission lens</div>
        <h1 style={{ fontSize: 'clamp(1.6rem, 3.5vw, 2.4rem)', maxWidth: '24ch' }}>
          What NASA knows about fire in space — and what nobody knows yet.
        </h1>
        <p style={{ color: 'var(--text-2)', maxWidth: '72ch' }}>
          Pick a habitat and a material. EMBER ranks NASA <Term k="psiRepo">PSI</Term> combustion investigations by relevance to
          your conditions and labels every answer as <strong>Known</strong>, <strong>Extrapolating</strong> or{' '}
          <strong>Unknown</strong>, so you can see where the data ends and guessing begins.
        </p>
        {history.length > 0 && (
          <div className="grid grid-3" style={{ marginTop: 12 }}>
            {history.slice(0, 3).map((h) => (
              <div key={h.id} className="card tight small">
                <strong>{h.title}</strong>
                <p className="muted" style={{ margin: '4px 0' }}>{h.summary}</p>
                {h.sources[0] && <SourceLink source={h.sources[0]} />}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="split wide-left">
        <div className="stack">
          <ScenarioEditor />
          <section className="card" aria-labelledby="w-h">
            <h2 id="w-h">3. Ranking weights</h2>
            <p className="small muted">
              Relevance = consequence<sup>a</sup> × evidence<sup>b</sup> × proximity<sup>c</sup>, normalized as a weighted geometric
              mean (exponents divided by a+b+c). Set a weight to 0 to ignore that factor.
            </p>
            <WeightSlider k="consequence" label="a · Safety consequence" weights={weights} setWeights={setWeights} />
            <WeightSlider k="evidence" label="b · Evidence strength" weights={weights} setWeights={setWeights} />
            <WeightSlider k="proximity" label="c · Proximity to mission" weights={weights} setWeights={setWeights} />
            <button type="button" className="ghost small" onClick={() => setWeights(DEFAULT_WEIGHTS)}>
              Reset weights
            </button>
          </section>
        </div>

        <div className="stack">
          <section className="card" aria-labelledby="sum-h">
            <div className="panel-title">
              <h2 id="sum-h" style={{ margin: 0 }}>
                {scenario.materialLabel || 'Material'} at {fmtNum(scenario.o2Pct)}% O₂, {fmtNum(scenario.pressureKpa)} kPa
              </h2>
              <AnswerBadge status={overall.status} large />
            </div>
            <p className="small muted" style={{ marginBottom: 8 }}>
              Microgravity evidence for {scenario.fuelPhase === 'any' ? 'any fuel' : `${scenario.fuelPhase} fuel`}
              {scenario.material ? ` (${scenario.material})` : ''}, flow {flowText(scenario)}.
            </p>
            {overall.pBurn !== null ? (
              <p>
                Nearest real tests vote <strong>{fmtPct(overall.pBurn)}</strong> “flame sustained”
                {overall.status === 'extrapolated' ? (
                  <> — but these conditions are <strong>outside the data</strong>, so this is not a prediction.</>
                ) : (
                  <> (95% interval {fmtPct(overall.interval![0])}–{fmtPct(overall.interval![1])}).</>
                )}
              </p>
            ) : (
              <p>No tests with a recorded outcome are available.</p>
            )}
            <ul className="small" style={{ margin: '0 0 8px', paddingLeft: 18, color: 'var(--text-2)' }}>
              {overall.reasons.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
            {scenario.gravityG > 0.01 && (
              <div className="callout small">
                Your environment has {fmtGravity(scenario.gravityG)}. PSI has no combustion data at partial gravity; see the{' '}
                <Link to="/gravity">gravity bracket</Link> between µg and 1 g results.
              </div>
            )}
            <div className="row small" style={{ marginTop: 8 }}>
              <Link to="/what-if">Explore in What-if →</Link>
              <span className="muted">
                Findings: {counts.known} known · {counts.extrapolating} extrapolating · {counts.unknown} unknown
              </span>
            </div>
          </section>

          <section aria-labelledby="rank-h">
            <h2 id="rank-h">Ranked investigations</h2>
            <ol style={{ listStyle: 'none', padding: 0, margin: 0 }} className="stack">
              {ranked.map((r, i) => (
                <RankItem key={r.inv.id} r={r} rank={i + 1} invs={investigations} keyword={keywordShares.get(r.inv.id)} />
              ))}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}
