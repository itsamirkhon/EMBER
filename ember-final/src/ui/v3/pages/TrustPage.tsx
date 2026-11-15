import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cliffStats, fmt, pct, useCompact } from '../data';
import { Loading, PageHead, PlainBadge } from '../ui';

interface Bucket { n: number; correct: number; baselineCorrect: number }
interface PhaseResult { all: Bucket; byStatus: Record<'measured' | 'nearby' | 'beyond', Bucket>; excluded: number }
interface TrustFile { generatedAt: string; corpusVersion: string; method: string; outcome: string; phases: Record<string, PhaseResult>; liquidExcluded: { rows: number; withNegativeOutcome: number } }

const RULES: [string, string][] = [
  ['Outcome', 'The test recorded the outcome your question needs (ignition, spread, extinction, smoke size…). Smoke is never treated as a flame.'],
  ['Material', 'Same fuel phase and a compatible material; different materials never match by a shared word.'],
  ['Geometry', 'Thin film vs thick slab vs droplet, and small duct vs large enclosure.'],
  ['Unknowns', 'A value the source did not report never counts as a match.'],
  ['Gas role', 'Oxygen in the cabin air is not the same as oxygen in a burner stream.'],
  ['Provenance', 'Assumed atmospheres (SAME / SAME-R) can support an answer only with a caveat.'],
  ['Gravity', 'Microgravity and 1 g results are never stretched to the Moon or Mars.'],
  ['Protocol', 'The crew switching the flow off is not a measured extinction limit.'],
  ['Joint conditions', 'O₂, pressure and airflow must have been tested together, not just each somewhere.'],
];

function Bar({ label, b, note }: { label: React.ReactNode; b: Bucket; note?: string }) {
  if (!b.n) return null;
  const acc = b.correct / b.n;
  const base = b.baselineCorrect / b.n;
  const below = acc < base;
  return (
    <div className="v3-bar-row">
      <div className="v3-bar-head">
        <span>
          {label}
          {note && <span className="v3-muted"> · {note}</span>}
        </span>
        <span>
          <b className={below ? 'v3-warn-text' : ''}>{pct(acc)}</b> vs {pct(base)} baseline · n={b.n}
        </span>
      </div>
      <div className="v3-bar-track" role="img" aria-label={`accuracy ${pct(acc)}, baseline ${pct(base)}, ${b.n} tests`}>
        <div className={`v3-bar-fill${below ? ' below' : ''}`} style={{ width: `${acc * 100}%` }} />
        <div className="v3-bar-mark" style={{ left: `calc(${base * 100}% - 1px)` }} />
      </div>
    </div>
  );
}

export function TrustPage() {
  const { data } = useCompact();
  const [trust, setTrust] = useState<TrustFile | null>(null);
  useEffect(() => {
    fetch('./data/trust.json').then((r) => (r.ok ? r.json() : null)).then(setTrust, () => setTrust(null));
  }, []);
  const cliff = useMemo(() => (data ? cliffStats(data.rows) : null), [data]);
  const ee = data?.extractionEval as { n?: number; correct?: number; partial?: number; wrong?: number } | undefined;
  const oa = data?.outcomeAudit as { n?: number; ruleAnswered?: number; agree?: number; wrong?: number; missed?: number } | undefined;

  return (
    <div className="v3-page">
      <PageHead eyebrow="Trust" title="How far you can trust EMBER.">
        EMBER does not predict whether a cabin will catch fire. It says where NASA’s data applies. This page checks that claim against the data
        itself, next to a baseline, and lists what has not been checked.
      </PageHead>

      {!data && <Loading what="Loading…" />}
      {data && cliff && (
        <>
          <section className="v3-card v3-section">
            <h2 className="v3-h2">1 · The finding, recomputed from the data you are looking at</h2>
            <p>
              This page counts {cliff.solidFlight} solid-material flight tests with a reported oxygen value in the loaded corpus ({data.corpusVersion}):
              oxygen {fmt(cliff.o2Min)}–{fmt(cliff.o2Max)}%, pressure {fmt(cliff.kPaMin)}–{fmt(cliff.kPaMax)} kPa where reported. {cliff.above225}{' '}
              of them are above 22.5% O₂ ({cliff.above225Inv.join(', ')}). {cliff.assumedSmoke} smoke records (SAME, SAME-R) are excluded because
              their atmosphere is assumed. You can check it yourself: <Link to="/export">download the tables</Link> and filter by fuel phase.
            </p>
            <p className="v3-muted v3-small">
              Scope: flight data in NASA PSI only. Ground tests at elevated oxygen exist outside PSI; EMBER does not claim nobody tested these
              atmospheres.
            </p>
          </section>

          <section className="v3-card v3-section">
            <h2 className="v3-h2">2 · Do the status labels mean anything?</h2>
            {!trust ? (
              <p className="v3-muted">Backtest not available in this build.</p>
            ) : (
              <>
                <p className="v3-small v3-muted">
                  {trust.method} Outcome: {trust.outcome} Baseline: always guess the most common outcome of the remaining tests (here always
                  “flame established”).
                </p>
                <div className="v3-grid-2">
                  {(['solid', 'gas'] as const).map((ph) => {
                    const r = trust.phases[ph];
                    if (!r) return null;
                    return (
                      <div key={ph}>
                        <h3>{ph === 'solid' ? 'Solid materials' : 'Gas flames'}</h3>
                        <div className="v3-bars">
                          <Bar label={<b>All tests</b>} b={r.all} />
                          <Bar label={<PlainBadge status="measured" />} b={r.byStatus.measured} />
                          <Bar label={<PlainBadge status="nearby" />} b={r.byStatus.nearby} />
                          <Bar label={<PlainBadge status="beyond" />} b={r.byStatus.beyond} note="nearest test shown, not claimed" />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="v3-legend v3-small" aria-hidden>
                  <span><i style={{ background: 'var(--v3-accent)' }} /> EMBER, nearest applicable tests</span>
                  <span><i style={{ background: 'var(--v3-warn)' }} /> below baseline</span>
                  <span><i style={{ background: '#fff', width: 2 }} /> baseline</span>
                </div>
                <ul className="v3-list">
                  <li>
                    <b>Solid materials:</b> {pct(trust.phases.solid.all.correct / trust.phases.solid.all.n)} vs{' '}
                    {pct(trust.phases.solid.all.baselineCorrect / trust.phases.solid.all.n)} baseline. Answers labelled <i>Measured</i> are more often
                    right than those labelled <i>Data nearby</i>, so the labels carry information. Most solids burned, so the baseline is already high.
                  </li>
                  <li>
                    <b>Gas flames:</b> {pct(trust.phases.gas.all.correct / trust.phases.gas.all.n)} vs{' '}
                    {pct(trust.phases.gas.all.baselineCorrect / trust.phases.gas.all.n)} baseline: <b>worse than always guessing “it lights”</b>.
                    Nearby gas-flame tests do not transfer well, which is one more reason EMBER shows records instead of a risk number.
                  </li>
                  <li>
                    Liquid droplets are not scored: {trust.liquidExcluded.withNegativeOutcome} of {trust.liquidExcluded.rows} droplet records have a
                    no-flame outcome, so there is nothing to predict.
                  </li>
                </ul>
              </>
            )}
          </section>

          <section className="v3-grid-2 v3-section">
            <article className="v3-card">
              <h2 className="v3-h2">3 · AI-extracted claims</h2>
              <p>
                {data.counts.claims} claims were extracted by an LLM from NTRS reports and PSI pages, each with a quote. Every quote was found
                verbatim in the cached source text ({data.counts.claims}/{data.counts.claims}).
              </p>
              {ee?.n ? (
                <p>
                  A sample of {ee.n} was re-read against the source: <b>{ee.correct} correct</b>, {ee.partial} partial (attribution, tense or
                  coverage), {ee.wrong} wrong. The same model family wrote and graded the claims, so treat this as optimistic.
                </p>
              ) : null}
            </article>
            <article className="v3-card">
              <h2 className="v3-h2">4 · BASS outcomes read from notes</h2>
              <p>BASS has no results column; burn / no-burn outcomes were parsed from free-text test notes by keyword rules.</p>
              {oa?.n ? (
                <p>
                  {oa.n} random rows were read in full. The rule agreed with the reading on <b>{oa.agree} of {oa.n}</b> rows (including rows where
                  neither could tell), gave a wrong burn / no-burn answer on {oa.wrong}, and stayed silent on {oa.missed} it could have answered. The
                  reading was done by an AI, not an independent human.
                </p>
              ) : null}
            </article>
          </section>

          <section className="v3-card v3-section">
            <h2 className="v3-h2">5 · The nine applicability rules</h2>
            <p className="v3-small v3-muted">Transparent rules, not a black box. A test supports your question only if it passes all nine.</p>
            <ol className="v3-rules">
              {RULES.map(([k, v]) => (
                <li key={k}>
                  <b>{k}.</b> {v}
                </li>
              ))}
            </ol>
          </section>

          <section className="v3-card v3-section">
            <h2 className="v3-h2">6 · A bug we found in our own engine</h2>
            <p>
              While building this release we found that a test with an <i>unreported</i> airflow, oxygen or pressure value skipped the
              joint-conditions rule. Sixteen-percent-oxygen BASS-II tests were being accepted as evidence for a 30% O₂ lunar cabin. An unreported
              value now counts as a gap, never as a match; a regression test fails without the fix. After it, no solid flight test applies to a
              lunar exploration atmosphere, which is what the map shows.
            </p>
          </section>

          <section className="v3-card v3-section">
            <h2 className="v3-h2">7 · What has not been checked</h2>
            <ul className="v3-list">
              <li>No independent domain expert has reviewed the extracted claims, the reconstructed test protocols or the rule tolerances.</li>
              <li>The 1,678 records include series aggregates and reconstructed protocols: they are not 1,678 independent experiments.</li>
              <li>
                The Interpret module passes 25/25 descriptive and 2/2 quantitative cases on a team-built development set; that is not an
                independent test set.
              </li>
              <li>Ask EMBER’s model-written answers are kept only after five automatic checks pass; automatic checks are not proof of meaning.</li>
              <li>There are no partial-gravity combustion flight data in PSI. EMBER never infers a Moon or Mars outcome.</li>
              <li>EMBER is a research aid. It is not a certification tool and gives no fire-risk percentage.</li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
