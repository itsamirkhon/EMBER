import { Link } from 'react-router-dom';
import { useData } from '../data/context';
import { AnswerBadge, fmtPct, Meter, PageHead } from '../components/ui';
import type { AnswerStatus } from '../lib/evidence';
import type { Backtest } from '../lib/types';

type Counts = { n: number; correct: number };
const STATUSES: AnswerStatus[] = ['measured', 'interpolated', 'extrapolated'];

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

function ByStatus({ byStatus }: { byStatus: Record<string, Counts> | undefined }) {
  if (!byStatus) return null;
  return (
    <div className="stack" style={{ marginTop: 12 }}>
      <h4>Accuracy by answer status</h4>
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

function LoioTable({ bt }: { bt: Backtest }) {
  const details = bt.details as {
    inv: string; n: number; predictionCorrect: number; honest: number; correct: boolean; statusCounts: Record<AnswerStatus, number>;
  }[];
  return (
    <div className="table-wrap" style={{ marginTop: 12 }}>
      <table>
        <thead>
          <tr>
            <th>Hidden investigation</th>
            <th className="num">Tests</th>
            <th className="num">Measured</th>
            <th className="num">Interp.</th>
            <th className="num">Extrap.</th>
            <th className="num">Outcome correct</th>
            <th className="num">Handled honestly</th>
            <th>Pass</th>
          </tr>
        </thead>
        <tbody>
          {details.map((d) => (
            <tr key={d.inv}>
              <td><Link to={`/investigations/${encodeURIComponent(d.inv)}`}>{d.inv}</Link></td>
              <td className="num">{d.n}</td>
              <td className="num">{d.statusCounts?.measured ?? 0}</td>
              <td className="num">{d.statusCounts?.interpolated ?? 0}</td>
              <td className="num">{d.statusCounts?.extrapolated ?? 0}</td>
              <td className="num">{pct(d.predictionCorrect, d.n)}</td>
              <td className="num">{pct(d.honest, d.n)}</td>
              <td>{d.correct ? '✓ pass' : '✗ fail'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PerInvTable({ per }: { per: Record<string, Counts> }) {
  return (
    <div className="table-wrap" style={{ marginTop: 12, maxHeight: 300 }}>
      <table>
        <thead>
          <tr><th>Investigation</th><th className="num">Tests</th><th className="num">Correct</th><th className="num">Accuracy</th></tr>
        </thead>
        <tbody>
          {Object.entries(per).map(([inv, c]) => (
            <tr key={inv}>
              <td>{inv}</td>
              <td className="num">{c.n}</td>
              <td className="num">{c.correct}</td>
              <td className="num">{pct(c.correct, c.n)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Trust() {
  const { validation, extractionEval, fixtureFiles } = useData();
  const fixtureVal = fixtureFiles.includes('validation.json');
  const loto = validation?.backtests.find((b) => b.name === 'leave-one-test-out');
  const loio = validation?.backtests.find((b) => b.name === 'leave-one-investigation-out');
  const others = validation?.backtests.filter((b) => b !== loto && b !== loio) ?? [];
  const testLevel = loio?.testLevel as (Counts & { byStatus?: Record<string, Counts> }) | undefined;

  return (
    <>
      <PageHead eyebrow="Module 4.10" title="How far can you trust EMBER?">
        <p>
          EMBER grades its own answers. This page shows how those grades hold up when we hide data and check the predictions, and how
          accurately the AI extracted claims from NASA reports. It is part of the product, not a slide.
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
      <div className="grid grid-2">
        {loio && (
          <section className="card">
            <h3>Leave one investigation out</h3>
            <p className="small">{loio.description}</p>
            <div className="grid grid-2" style={{ gap: 12 }}>
              <Stat label="Investigations handled honestly" value={`${loio.correct} of ${loio.n}`} sub={`pass = ≥${Math.round(Number(loio.passThreshold ?? 0.75) * 100)}% of tests correct or flagged Extrapolated`} />
              {testLevel && <Stat label="Hidden tests predicted correctly" value={pct(testLevel.correct, testLevel.n)} sub={`${testLevel.correct} of ${testLevel.n} tests`} />}
            </div>
            <ByStatus byStatus={testLevel?.byStatus} />
            <LoioTable bt={loio} />
          </section>
        )}
        {loto && (
          <section className="card">
            <h3>Leave one test out</h3>
            <p className="small">{loto.description}</p>
            <Stat label="Outcome predicted correctly" value={pct(loto.correct, loto.n)} sub={`${loto.correct} of ${loto.n} tests (burn vs no burn)`} />
            <ByStatus byStatus={loto.byStatus as Record<string, Counts> | undefined} />
            {loto.perInvestigation ? <PerInvTable per={loto.perInvestigation as Record<string, Counts>} /> : null}
          </section>
        )}
        {others.map((b) => (
          <section key={b.name} className="card">
            <h3>{b.name}</h3>
            {b.description && <p className="small">{b.description}</p>}
            <Stat label="Correct" value={`${b.correct} of ${b.n}`} />
          </section>
        ))}
      </div>

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
            effective sample size, and is reported as 0–100% whenever the point is Extrapolated.
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
            <strong>Limits.</strong> Outcomes are collapsed to burn / no-burn; different investigations define “extinguished”
            differently. There are no partial-gravity data. Backtests measure consistency within PSI data, not real-world safety.
            EMBER is a research aid, not a certification tool (NASA-STD-6001 testing still applies).
          </li>
        </ul>
      </section>
    </>
  );
}
