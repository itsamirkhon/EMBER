import { Link } from 'react-router-dom';
import { useData } from '../data/context';
import { AnswerBadge, fmtPct, Meter, PageHead } from '../components/ui';
import {
  dataCoverage,
  NUMERIC_TARGETS,
  TARGET_LABEL,
  TARGET_UNIT,
  type AnswerStatus,
  type ClassMetrics,
  type CoverageRow,
  type ErrorStats,
  type NumericMetrics,
  type NumericTarget,
} from '../lib/evidence';
import type { Backtest } from '../lib/types';

type Counts = { n: number; correct: number };
const STATUSES: AnswerStatus[] = ['measured', 'interpolated', 'extrapolated'];
const PHASES = ['solid', 'liquid', 'gas'] as const;

function pct(c: number, n: number) {
  return n ? fmtPct(c / n) : '—';
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

/** Accuracy with its baseline and n, in one string — no accuracy is ever shown alone. */
function accText(m: ClassMetrics | undefined | null): string {
  if (!m || !m.n) return 'no tests';
  return `${pct(m.correct, m.n)} vs ${pct(m.baseline.correct, m.n)} baseline (n=${m.n})`;
}

function isMetrics(x: unknown): x is ClassMetrics {
  return !!x && typeof x === 'object' && 'baseline' in x && 'byStatus' in x;
}

function ByStatus({ byStatus, title }: { byStatus: Record<string, Counts> | undefined; title: string }) {
  if (!byStatus) return null;
  return (
    <div className="stack" style={{ marginTop: 12 }}>
      <h4>{title}</h4>
      {STATUSES.map((s) => {
        const c = byStatus[s];
        if (!c) return null;
        return (
          <div key={s} className="row" style={{ alignItems: 'center' }}>
            <span style={{ width: 140 }}><AnswerBadge status={s} /></span>
            <span style={{ flex: 1, minWidth: 160 }}>
              <Meter label={`${c.correct}/${c.n}`} value={c.n ? c.correct / c.n : 0} hint={`${s}: ${c.correct} of ${c.n} correct`} />
            </span>
          </div>
        );
      })}
      <p className="small muted" style={{ margin: 0 }}>
        If the status labels are honest, Measured and Interpolated answers should be more accurate than Extrapolated ones.
      </p>
    </div>
  );
}

function MetricsTable({ rows }: { rows: { label: string; m: ClassMetrics | undefined; group?: boolean }[] }) {
  return (
    <div className="table-wrap" style={{ marginTop: 12 }}>
      <table>
        <thead>
          <tr>
            <th>Tests</th>
            <th className="num">n</th>
            <th className="num">Accuracy</th>
            <th className="num">Majority baseline</th>
            <th className="num">Measured</th>
            <th className="num">Interp.</th>
            <th className="num">Extrap.</th>
            <th className="num" title="Share of the wrong answers that were labelled Extrapolated">Wrong answers flagged</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, m, group }) =>
            m && m.n ? (
              <tr key={label}>
                <td style={group ? { fontWeight: 650 } : { paddingLeft: 20 }}>{label}</td>
                <td className="num">{m.n}</td>
                <td className="num"><strong>{pct(m.correct, m.n)}</strong></td>
                <td className="num">
                  {pct(m.baseline.correct, m.n)} <span className="muted small">({m.baseline.predicts === 'burn' ? 'burn' : 'no burn'})</span>
                </td>
                <td className="num">{m.byStatus.measured.n}</td>
                <td className="num">{m.byStatus.interpolated.n}</td>
                <td className="num">{m.byStatus.extrapolated.n}</td>
                <td className="num">{m.wrong ? `${pct(m.wrongFlagged, m.wrong)} (${m.wrongFlagged}/${m.wrong})` : '— (none wrong)'}</td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    </div>
  );
}

type LoioRow = ClassMetrics & {
  inv: string;
  fuelPhase: string | null;
  statusCounts: Record<AnswerStatus, number>;
  trainMajority?: { predicts: string | null; correct: number; accuracy: number | null };
};

function LoioTable({ details }: { details: LoioRow[] }) {
  return (
    <div className="table-wrap" style={{ marginTop: 12 }}>
      <table>
        <thead>
          <tr>
            <th>Hidden investigation</th>
            <th>Phase</th>
            <th className="num">n</th>
            <th className="num">Strict accuracy</th>
            <th className="num" title="Always predict the most common outcome of the other investigations">Baseline (others’ majority)</th>
            <th className="num">Measured</th>
            <th className="num">Interp.</th>
            <th className="num">Extrap.</th>
            <th className="num">Wrong answers flagged</th>
          </tr>
        </thead>
        <tbody>
          {details.map((d) => (
            <tr key={d.inv}>
              <td><Link to={`/investigations/${encodeURIComponent(d.inv)}`}>{d.inv}</Link></td>
              <td>{d.fuelPhase ?? '—'}</td>
              <td className="num">{d.n}</td>
              <td className="num"><strong>{pct(d.correct, d.n)}</strong></td>
              <td className="num">{d.trainMajority ? pct(d.trainMajority.correct, d.n) : '—'}</td>
              <td className="num">{d.statusCounts?.measured ?? 0}</td>
              <td className="num">{d.statusCounts?.interpolated ?? 0}</td>
              <td className="num">{d.statusCounts?.extrapolated ?? 0}</td>
              <td className="num">{d.wrong ? `${pct(d.wrongFlagged, d.wrong)} (${d.wrongFlagged}/${d.wrong})` : '— (none wrong)'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const num = (v: number | null | undefined, unit: string) => (v === null || v === undefined ? '—' : `${v.toPrecision(2)} ${unit}`);
const ape = (s: ErrorStats) => (s.medianAbsPctErr === null ? '—' : `${Math.round(100 * s.medianAbsPctErr)}%`);

type NumericEntry = { target: NumericTarget; unit: string; grouped: boolean; overall: NumericMetrics; perInvestigation: Record<string, NumericMetrics> };

function NumericTable({ entries }: { entries: NumericEntry[] }) {
  const present = new Set(entries.map((e) => e.target));
  return (
    <div className="table-wrap" style={{ marginTop: 12 }}>
      <table>
        <thead>
          <tr>
            <th>Target</th>
            <th>Leave-out</th>
            <th className="num">Rows</th>
            <th className="num">Predicted</th>
            <th className="num">kNN MAE</th>
            <th className="num">kNN median |%err|</th>
            <th className="num">Baseline: investigation mean</th>
            <th className="num">Baseline: global mean</th>
            <th className="num">M / I / E</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const o = e.overall;
            return (
              <tr key={`${e.target}-${e.grouped}`}>
                <td>{TARGET_LABEL[e.target] ?? e.target} <span className="muted small">({e.unit})</span></td>
                <td>{e.grouped ? 'grouped (replicates hidden)' : 'one test'}</td>
                <td className="num">{o.n}</td>
                <td className="num">{o.nPredicted}</td>
                <td className="num"><strong>{num(o.model.mae, e.unit)}</strong></td>
                <td className="num"><strong>{ape(o.model)}</strong></td>
                <td className="num">{num(o.baselineInvMean.mae, e.unit)} · {ape(o.baselineInvMean)}</td>
                <td className="num">{num(o.baselineGlobalMean.mae, e.unit)} · {ape(o.baselineGlobalMean)}</td>
                <td className="num">{o.byStatus.measured.n} / {o.byStatus.interpolated.n} / {o.byStatus.extrapolated.n}</td>
              </tr>
            );
          })}
          {NUMERIC_TARGETS.filter((t) => !present.has(t)).map((t) => (
            <tr key={t} className="muted">
              <td>{TARGET_LABEL[t]} <span className="small">({TARGET_UNIT[t]})</span></td>
              <td colSpan={8}>No rows in the loaded data report this value — no estimate, no backtest.</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoverageTable({ rows, total }: { rows: CoverageRow[]; total: CoverageRow }) {
  const cell = (n: number) => (n ? n : <span className="muted">0</span>);
  return (
    <div className="table-wrap" style={{ marginTop: 12, maxHeight: 460 }}>
      <table>
        <thead>
          <tr>
            <th>Investigation</th>
            <th>Phase</th>
            <th className="num">Rows</th>
            <th className="num">Burn / no-burn outcome</th>
            {NUMERIC_TARGETS.map((t) => (
              <th key={t} className="num">{TARGET_LABEL[t]}</th>
            ))}
            <th className="num">In no estimate</th>
            <th className="num" title="Outcomes obtained by keyword rules on free-text notes">Outcome from notes</th>
          </tr>
        </thead>
        <tbody>
          {[...rows, total].map((r) => (
            <tr key={r.inv} style={r === total ? { fontWeight: 650 } : undefined}>
              <td>{r === total ? 'All investigations' : <Link to={`/investigations/${encodeURIComponent(r.inv)}`}>{r.inv}</Link>}</td>
              <td>{r === total ? '' : r.fuelPhase ?? 'mixed'}</td>
              <td className="num">{r.rows}</td>
              <td className="num">{cell(r.outcome)}</td>
              {NUMERIC_TARGETS.map((t) => (
                <td key={t} className="num">{cell(r.targets?.[t] ?? 0)}</td>
              ))}
              <td className="num">{cell(r.none)}</td>
              <td className="num">{r.derivation?.['keyword-rule'] ? `${r.derivation['keyword-rule']} of ${r.outcome}` : cell(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Trust() {
  const { validation, extractionEval, outcomeAudit, fixtureFiles, tests } = useData();
  const fixtureVal = fixtureFiles.includes('validation.json');
  const loto = validation?.backtests.find((b) => b.name === 'leave-one-test-out');
  const lotoG = validation?.backtests.find((b) => b.name === 'leave-one-test-out-grouped');
  const loio = validation?.backtests.find((b) => b.name === 'leave-one-investigation-out');
  const others = validation?.backtests.filter((b) => b !== loto && b !== loio && b !== lotoG) ?? [];
  const newShape = isMetrics(loto?.overall) && isMetrics(loio?.overall);

  const m = (bt: Backtest | undefined, key: 'overall') => (bt && isMetrics(bt[key]) ? (bt[key] as ClassMetrics) : undefined);
  const phase = (bt: Backtest | undefined, ph: string) => (bt?.byPhase as Record<string, ClassMetrics> | undefined)?.[ph];
  const inv = (bt: Backtest | undefined, id: string) => {
    const x = (bt?.perInvestigation as Record<string, unknown> | undefined)?.[id];
    return isMetrics(x) ? x : undefined;
  };
  const lotoAll = m(loto, 'overall');
  const lotoGAll = m(lotoG, 'overall');
  const loioAll = m(loio, 'overall');
  const trainMajority = loio?.trainMajority as { correct: number; accuracy: number | null } | undefined;
  const replicates = lotoG?.replicates as { removedTotal: number; testsWithReplicates: number } | undefined;
  const numeric = (validation?.numeric ?? []) as unknown as NumericEntry[];
  const liveCoverage = dataCoverage(tests);
  const coverage = (validation?.coverage as unknown as ReturnType<typeof dataCoverage> | undefined) ?? liveCoverage;

  const variantRows = (bt: Backtest | undefined) => [
    { label: 'All tests', m: m(bt, 'overall'), group: true },
    ...PHASES.map((ph) => ({ label: `${ph[0].toUpperCase()}${ph.slice(1)} fuels`, m: phase(bt, ph) })),
    { label: 'BASS-II (solid, demo)', m: inv(bt, 'BASS-II') },
    { label: 'BASS (solid, demo)', m: inv(bt, 'BASS') },
  ];

  return (
    <>
      <PageHead eyebrow="Module 4.10" title="How far can you trust EMBER?">
        <p>
          EMBER grades its own answers. This page shows how those grades hold up when we hide data and check the predictions, and how
          accurately the AI extracted claims from NASA reports. Every accuracy is shown next to a <strong>majority baseline</strong>{' '}
          (always guess the most common outcome) and the number of tests. It is part of the product, not a slide.
        </p>
      </PageHead>
      {fixtureVal && (
        <div className="callout" style={{ marginBottom: 16 }}>
          These numbers come from the <strong>fixture</strong> dataset and say nothing about real PSI data yet. Run{' '}
          <code>npm run backtest</code> after the data pipeline publishes <code>data/tests.json</code>.
        </div>
      )}

      <h2>1. “Hide an experiment” backtests</h2>
      {!validation && <p className="muted">validation.json not available.</p>}
      {validation && (
        <p className="small muted">
          Generated {new Date(validation.generatedAt).toLocaleString()} {validation.dataset ? `from ${validation.dataset}` : ''}.{' '}
          {validation.method}
        </p>
      )}
      {validation && !newShape && (
        <div className="callout" style={{ marginBottom: 16 }}>
          This validation.json predates strict scoring. Run <code>npm run backtest</code> to regenerate it.
        </div>
      )}

      {newShape && lotoAll && loioAll && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3>What the backtests say, plainly</h3>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            <li>
              <strong>
                {loioAll.correct <= loioAll.baseline.correct
                  ? 'Results barely transfer between different experiments.'
                  : 'Results transfer only partly between different experiments.'}
              </strong>{' '}
              When a whole investigation is hidden and predicted from the others, {pct(loioAll.correct, loioAll.n)} of its tests get the
              right burn / no-burn answer ({loioAll.correct} of {loioAll.n}),
              <strong> {loioAll.correct <= loioAll.baseline.correct ? 'not better than' : 'compared with'}</strong> the{' '}
              {pct(loioAll.baseline.correct, loioAll.n)} of always guessing the most common outcome
              {trainMajority ? ` (guessing the other experiments’ majority: ${pct(trainMajority.correct, loioAll.n)})` : ''}.
            </li>
            <li>
              <strong>EMBER flags this itself.</strong> Of the {loioAll.wrong} wrong cross-experiment answers, {loioAll.wrongFlagged} (
              {pct(loioAll.wrongFlagged, loioAll.wrong)}) were labelled <em>Extrapolated</em>; {loioAll.confidentWrong} were wrong while
              labelled Measured or Interpolated.
            </li>
            <li>
              Within an experiment, predicting a hidden test from all others gives {accText(lotoAll)} — but{' '}
              {lotoAll.byStatus.measured.n} of {lotoAll.n} answers are “Measured” because a near-identical replicate exists.
              {lotoGAll && (
                <> Hiding those replicates too (grouped) gives {accText(lotoGAll)}, with {lotoGAll.byStatus.measured.n} Measured answers left.</>
              )}
            </li>
            <li>
              {(() => {
                const s = phase(lotoG ?? loto, 'solid');
                const b2 = inv(lotoG ?? loto, 'BASS-II');
                const b = inv(lotoG ?? loto, 'BASS');
                return (
                  <>
                    <strong>Solid materials (the demo scenario){lotoG ? ', grouped' : ''}:</strong> {accText(s)}; BASS-II {accText(b2)}; BASS {accText(b)}.{' '}
                    Most outcome rows are gas flames and droplets, not solids
                    {lotoAll && phase(loto, 'solid') ? ` (${phase(loto, 'solid')!.n} of ${lotoAll.n} are solid)` : ''}.
                  </>
                );
              })()}
            </li>
            <li>
              {coverage.total.none} of {coverage.total.rows} test rows have neither a burn / no-burn outcome nor a numeric result and take
              part in no estimate (see coverage below).
            </li>
          </ul>
        </section>
      )}

      {newShape && (
        <div className="stack">
          <section className="card">
            <h3>Leave one test out — by fuel phase</h3>
            <p className="small">{loto?.description}</p>
            <MetricsTable rows={variantRows(loto)} />
          </section>
          {lotoG && (
            <section className="card">
              <h3>Grouped leave-out: replicates hidden too</h3>
              <p className="small">{lotoG.description}</p>
              {replicates && (
                <p className="small muted">
                  {replicates.testsWithReplicates} of {lotoG.n} held-out tests had at least one replicate; {replicates.removedTotal} replicate
                  rows were hidden in total across all hold-outs.
                </p>
              )}
              <MetricsTable rows={variantRows(lotoG)} />
              <ByStatus byStatus={lotoGAll?.byStatus} title="Grouped: accuracy by answer status" />
            </section>
          )}
          {loio && (
            <section className="card">
              <h3>Leave one investigation out (cross-experiment transfer)</h3>
              <p className="small">{loio.description}</p>
              <div className="grid grid-3" style={{ gap: 12 }}>
                {loioAll && (
                  <Stat
                    label="Strict accuracy (correct only)"
                    value={pct(loioAll.correct, loioAll.n)}
                    sub={`${loioAll.correct} of ${loioAll.n} hidden tests`}
                  />
                )}
                {loioAll && (
                  <Stat
                    label="Majority baseline"
                    value={pct(loioAll.baseline.correct, loioAll.n)}
                    sub={trainMajority ? `others’ majority: ${pct(trainMajority.correct, loioAll.n)} · n=${loioAll.n}` : `n=${loioAll.n}`}
                  />
                )}
                {loioAll && (
                  <Stat
                    label="Flagging rate"
                    value={pct(loioAll.wrongFlagged, loioAll.wrong)}
                    sub={`${loioAll.wrongFlagged} of ${loioAll.wrong} wrong answers were labelled Extrapolated`}
                  />
                )}
              </div>
              <MetricsTable
                rows={[
                  { label: 'All hidden tests', m: loioAll, group: true },
                  ...PHASES.map((ph) => ({ label: `${ph[0].toUpperCase()}${ph.slice(1)} fuels`, m: phase(loio, ph) })),
                ]}
              />
              <LoioTable details={loio.details as unknown as LoioRow[]} />
              <ByStatus byStatus={loioAll?.byStatus} title="Cross-experiment: accuracy by answer status" />
            </section>
          )}
          {others.map((b) => (
            <section key={b.name} className="card">
              <h3>{b.name}</h3>
              {b.description && <p className="small">{b.description}</p>}
              <Stat label="Correct" value={`${b.correct} of ${b.n}`} />
            </section>
          ))}

          <section className="card">
            <h3>Numeric results: spread rate, burning rate, particle size, smoke point</h3>
            <p className="small">
              The same nearest-neighbour method and Measured / Interpolated / Extrapolated rules, predicting a number instead of burn / no-burn.
              Each row is hidden in turn (grouped: its replicates too) and predicted from rows of the same fuel phase. Error is the mean
              absolute error (MAE) and the median absolute percentage error, next to two baselines scored on the same rows: the mean of the
              remaining rows of the same investigation, and the mean of all remaining rows.
            </p>
            <NumericTable entries={numeric} />
          </section>

          <section className="card">
            <h3>Data coverage: what each row can be used for</h3>
            <p className="small">
              Rows per investigation in <code>tests.json</code>, and how many can feed each kind of estimate. “In no estimate” counts rows
              with no burn / no-burn outcome and no numeric result: they are shown in tables and plots but never predict anything.
              {coverage !== liveCoverage ? '' : ' (Computed live from the loaded data.)'}
            </p>
            <CoverageTable rows={coverage.perInvestigation} total={coverage.total} />
          </section>
        </div>
      )}

      {outcomeAudit && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>{outcomeAudit.inv} outcomes parsed from notes: manual check</h2>
          <p className="small">
            {outcomeAudit.inv} outcomes come from keyword rules over the free-text test observations (no result column exists and the
            final report is unavailable). Manual check of {outcomeAudit.n} random rows:{' '}
            <strong>
              {outcomeAudit.agree} of {outcomeAudit.n} agree, {outcomeAudit.wrong} wrong
            </strong>
            . Where the rule gave a burn / no-burn answer ({outcomeAudit.ruleAnswered} rows), it was wrong {outcomeAudit.wrong} times
            {outcomeAudit.wrong === 0 && outcomeAudit.ruleAnswered > 0
              ? ` (with this sample size the error rate could still be up to ~${Math.round((3 / outcomeAudit.ruleAnswered) * 100)}%, rule of three)`
              : ''}
            ; it abstained {outcomeAudit.missed} time{outcomeAudit.missed === 1 ? '' : 's'} where the notes allow an answer, and gave a
            finer category that differs from the reading in {outcomeAudit.subtypeDisagreements} rows without changing burn / no-burn.
          </p>
          <p className="small muted">{outcomeAudit.method}</p>
          <div className="table-wrap" style={{ marginTop: 12, maxHeight: 420 }}>
            <table>
              <thead>
                <tr><th>Test</th><th>Rule</th><th>Manual</th><th>Verdict</th><th>Why (from the notes)</th></tr>
              </thead>
              <tbody>
                {outcomeAudit.items.map((it) => (
                  <tr key={it.testId}>
                    <td className="mono small">{it.testId}</td>
                    <td className="small">{it.ruleOutcome}</td>
                    <td className="small">{it.manualBinary ?? 'no answer'}</td>
                    <td className="small">
                      {it.verdict === 'agree' ? '✓ agree' : it.verdict === 'missed' ? '◐ missed' : '✗ ' + it.verdict}
                    </td>
                    <td className="small" title={it.observations ?? undefined}>
                      {it.note}
                      {it.subtypeNote && <div className="muted">{it.subtypeNote}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <h2 style={{ marginTop: 28 }}>2. Claim extraction accuracy</h2>
      {!extractionEval ? (
        <p className="muted">extraction_eval.json not available.</p>
      ) : (
        <section className="card">
          <p className="small">{extractionEval.method}</p>
          <div className="grid grid-3" style={{ gap: 12 }}>
            <Stat label="Correct" value={pct(extractionEval.correct, extractionEval.n)} sub={`${extractionEval.correct} of ${extractionEval.n} claims`} />
            <Stat label="Partially correct" value={String(extractionEval.partial)} />
            <Stat label="Wrong" value={String(extractionEval.wrong)} />
          </div>
          <div className="table-wrap" style={{ marginTop: 12, maxHeight: 420 }}>
            <table>
              <thead>
                <tr><th>Claim</th><th>Hand-labelled (gold)</th><th>AI extracted</th><th>Verdict</th></tr>
              </thead>
              <tbody>
                {extractionEval.items.map((it) => (
                  <tr key={it.claimId}>
                    <td className="mono small">{it.claimId}</td>
                    <td className="small">{it.goldText}</td>
                    <td className="small">{it.llmText}</td>
                    <td className="small">
                      {it.verdict === 'correct' ? '✓ correct' : it.verdict === 'partial' ? '◐ partial' : '✗ wrong'}
                      {it.note && <div className="muted">{it.note}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <h2 style={{ marginTop: 28 }}>3. Physics model</h2>
      <section className="card">
        {validation?.physicsModel ? (
          <pre className="small mono" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(validation.physicsModel, null, 2)}</pre>
        ) : (
          <p className="small">
            Not calibrated. The <Link to="/physics">flame illustration</Link> is a visualization, not a calculation, and is not used for
            any answer.
          </p>
        )}
      </section>

      <h2 style={{ marginTop: 28 }}>Methods and limits</h2>
      <section className="card small">
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li>
            <strong>Distance.</strong> Conditions are normalized so one unit ≈ 3% O₂, 15 kPa or 8 cm/s. A different fuel phase adds 4
            units, a different material 1 unit, a value the test does not report 1 unit (1.5 units for ranking proximity; an investigation without documented O₂ or pressure is always Unknown); in backtests a gravity difference of 0.5 g adds 1 unit.
          </li>
          <li>
            <strong>Estimate.</strong> The five nearest tests vote with weights 1/(d+0.05)². The 95% interval is a Wilson interval on the
            effective sample size, and is reported as 0–100% whenever the point is Extrapolated. Numeric results (spread rate, burning
            rate, particle size, smoke point) use the weighted mean of the same five neighbours, or the mean of the matching tests when
            Measured, and are never borrowed from another fuel phase.
          </li>
          <li>
            <strong>Status.</strong> Measured: a test within ±0.6% O₂, ±3 kPa, ±2 cm/s with the same phase/material. Interpolated: tests
            within 2 units bracket the point on every dimension and the nearest is within 1.25 units. Otherwise Extrapolated.
          </li>
          <li>
            <strong>Ranking.</strong> A transparent formula, not AI: weighted geometric mean of safety consequence (from the challenge
            text), evidence strength (tests, flight, raw data) and proximity 1/(1+(d/2)²), × 0.25 when the fuel phase differs. Proximity and Known/Extrapolating/Unknown use only tests from the matching gravity regime (µg for space missions), so 1 g ground references never count as “known” for orbit or the Moon.
          </li>
          <li>
            <strong>Scoring.</strong> Accuracy counts correct predictions only. The majority baseline always guesses the most common
            outcome of the same tests (optimistic: it knows their class balance). The flagging rate is the share of wrong answers that
            EMBER had labelled Extrapolated. A grouped leave-out hides a test together with its same-investigation replicates.
          </li>
          <li>
            <strong>Limits.</strong> Outcomes are collapsed to burn / no-burn; different investigations define “extinguished”
            differently. There are no partial-gravity data. Backtests measure consistency within PSI data, not real-world safety.
            EMBER is a research aid, not a certification tool (NASA-STD-6001 testing still applies).
          </li>
        </ul>
      </section>
    </>
  );
}
