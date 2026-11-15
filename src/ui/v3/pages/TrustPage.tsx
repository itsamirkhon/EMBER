import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cliffStats, fmt, useCompact } from '../data';
import { Loading, PageHead } from '../ui';

interface PhaseResult { records: number; positive: number; negative: number; ambiguous: number; excludedAtmosphere: number }
interface TrustFile { schemaVersion: number; status: string; generatedAt: string; corpusVersion: string; method: string; outcome: string; phases: Record<string, PhaseResult> }

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

export function TrustPage() {
  const { data, error: compactError } = useCompact();
  const [trust, setTrust] = useState<TrustFile | null>(null);
  const [trustError, setTrustError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch('./data/trust.json')
      .then((r) => r.ok ? r.json() as Promise<TrustFile> : Promise.reject(new Error('HTTP ' + r.status)))
      .then((result) => { if (live) setTrust(result); },
            (error: unknown) => { if (live) setTrustError(error instanceof Error ? error.message : String(error)); });
    return () => { live = false; };
  }, []);
  const trustIsStale = Boolean(trust && data && (trust.corpusVersion !== data.corpusVersion || trust.schemaVersion !== 2 || trust.status !== 'withdrawn_pending_independent_validation'));
  const cliff = useMemo(() => (data ? cliffStats(data.rows) : null), [data]);
  const ee = data?.extractionEval as { n?: number; correct?: number; partial?: number; wrong?: number } | undefined;
  const oa = data?.outcomeAudit as { n?: number; ruleAnswered?: number; agree?: number; wrong?: number; missed?: number } | undefined;

  return (
    <div className="v3-page">
      <PageHead eyebrow="Trust" title="How far you can trust EMBER.">
        EMBER does not predict whether a cabin will catch fire. It says where NASA’s data applies. This page separates reproducible data checks from scientific validation that remains unfinished.
      </PageHead>

      {compactError && <div className="v3-callout v3-callout-warn" role="alert">NASA PSI data unavailable: {compactError}</div>}
      {!data && !compactError && <Loading what="Loading…" />}
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
            <h2 className="v3-h2">2 · Outcome backtest withdrawn</h2>
            <p className="v3-callout v3-callout-warn">
              The earlier backtest incorrectly counted self-extinction as “no flame established”. A flame can form and then go out.
              Its accuracy percentages and claimed gains over a baseline have been withdrawn; they do not validate the applicability labels.
            </p>
            {!trust || trustIsStale ? (
              <p role="alert">{trustIsStale ? 'Outcome audit is incompatible with this corpus; results withheld.' : trustError ? 'Outcome audit unavailable: ' + trustError : 'Loading outcome audit…'}</p>
            ) : (
              <>
                <p>{trust.method}</p>
                <p className="v3-small v3-muted">{trust.outcome}</p>
                <div className="v3-grid-2">
                  {(['solid', 'gas', 'liquid'] as const).map((phase) => {
                    const result = trust.phases[phase];
                    if (!result) return null;
                    return <article key={phase}>
                      <h3>{phase === 'solid' ? 'Solid materials' : phase === 'gas' ? 'Gas flames' : 'Liquid droplets'}</h3>
                      <p>{result.records} records: {result.positive} candidate positive, {result.negative} candidate negative,
                        {' '}{result.ambiguous} ambiguous/unscored. {result.excludedAtmosphere} additional records excluded for missing or assumed atmosphere.</p>
                    </article>;
                  })}
                </div>
              </>
            )}
            <p><b>Required before publishing a new score:</b> independently adjudicate one endpoint per test stage;
              exclude series aggregates; keep reused samples and related protocol groups in the same holdout;
              evaluate admissibility against expert judgments. Any separate outcome-transfer experiment must use the same eligible records
              for training and evaluation, a fold-specific majority baseline, and report abstention coverage. Beyond-evidence cases must abstain.</p>
            <p>No replacement scientific accuracy or operational safety claim is made by this audit.</p>
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
