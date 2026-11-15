import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { FuelPhase } from '../../../core';
import { EvidenceMap, MapLegend } from '../EvidenceMap';
import { cliffStats, fmt, useCompact } from '../data';
import { Loading, PageHead } from '../ui';

const PHASES: [FuelPhase | 'all', string][] = [
  ['all', 'All fuels'],
  ['solid', 'Solid materials'],
  ['liquid', 'Liquid droplets'],
  ['gas', 'Gas flames'],
];

export function MapPage() {
  const { data, error } = useCompact();
  const [phase, setPhase] = useState<FuelPhase | 'all'>('solid');
  const [highlight, setHighlight] = useState<string | null>(null);
  const nav = useNavigate();
  const cliff = useMemo(() => (data ? cliffStats(data.rows) : null), [data]);

  return (
    <div className="v3-page">
      <PageHead eyebrow="Evidence map" title="Where NASA’s fire data ends">
        {cliff ? (
          <>
            This chart groups the NASA PSI flight records with available oxygen and pressure values; it omits records
            where either value is unknown. Among {cliff.solidFlight} solid-material flight-test records with reported oxygen,
            the range is {fmt(cliff.o2Min)}–{fmt(cliff.o2Max)}% O₂. The mission markers are documented scenarios,
            not new tests or universal spacecraft specifications.
          </>
        ) : null}
      </PageHead>

      {error && <div className="v3-callout v3-callout-warn">Could not load data: {error}</div>}
      {!data && !error && <Loading what="Loading NASA PSI data…" />}

      {data && cliff && (
        <>
          <section className="v3-card v3-card-chart">
            <div className="v3-toolbar">
              <div className="v3-seg" role="group" aria-label="Fuel phase">
                {PHASES.map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={phase === k} onClick={() => setPhase(k)}>
                    {l}
                  </button>
                ))}
              </div>
              <span className="v3-muted v3-small">Hover a mark for details · click a cabin to check it</span>
            </div>
            <p className="v3-small v3-muted">
              Chart coverage: {data.rows.filter((row) => row.o2 !== null && row.kPa !== null && row.gravityMode === 'actual_flight').length.toLocaleString('en-US')}
              {' '}of {data.counts.tests.toLocaleString('en-US')} indexed records have plottable O₂ and pressure.
              Assumed values are drawn hollow; missing values are excluded, not set to zero.
            </p>
            <MapLegend investigations={data.investigations} phase={phase} highlight={highlight} onHighlight={setHighlight} />
            <EvidenceMap
              rows={data.rows}
              investigations={data.investigations}
              missions={data.missions}
              cliff={cliff}
              phase={phase}
              highlight={highlight}
              onPickMission={(m) => nav(`/lens?mission=${encodeURIComponent(m.id)}`)}
            />
          </section>

          <section className="v3-grid-3 v3-section">
            <article className="v3-card">
              <div className="v3-big cliff">{fmt(cliff.o2Max)}%</div>
              <h3>Highest O₂ in a solid-material flight test</h3>
              <p className="v3-muted">
                {cliff.solidFlight} tests from BASS, BASS-II and Saffire ran at {fmt(cliff.o2Min)}–{fmt(cliff.o2Max)}% O₂ and {fmt(cliff.kPaMin)}–
                {fmt(cliff.kPaMax)} kPa. Only {cliff.above225} ({cliff.above225Inv.join(', ')}) went above 22.5%.
              </p>
            </article>
            <article className="v3-card">
              <div className="v3-big">30–34%</div>
              <h3>O₂ planned for lunar cabins</h3>
              <p className="v3-muted">
                Lunar habitat: 34% at 56.5 kPa (8.2 psi), NASA’s exploration atmosphere. Lunar rover: 30% at 70.3 kPa (10.2 psi), the
                challenge’s design scenario. Mars habitat values are an EMBER assumption. No solid-material flight data overlaps these points.
              </p>
            </article>
            <article className="v3-card">
              <div className="v3-big">{fmt(cliff.gasMaxO2, 0)}%</div>
              <h3>Highest O₂ in any flight test</h3>
              <p className="v3-muted">
                ACME CFI-G burned gas flames up to {fmt(cliff.gasMaxO2, 0)}% O₂, but in an oxidizer stream, not cabin air, and with gaseous fuel. That
                transfers to fabrics and plastics only qualitatively.
              </p>
            </article>
          </section>

          <section className="v3-callout v3-section">
            <b>What this map does and does not say</b><br /> It covers <i>flight</i> data in NASA PSI. Ground tests at elevated oxygen exist (for
            example NASA-STD-6001 Test 1), and NASA work found that 1 g limiting oxygen concentrations were up to 4 points higher than in
            microgravity: materials burned in orbit where the ground test would pass them. So the gap is not “nobody tested this”; it is
            “no microgravity flight data for cabin materials at exploration atmospheres”. {cliff.assumedSmoke} SAME / SAME-R smoke records
            are drawn hollow: their atmosphere is assumed to be ISS cabin air, not measured.
          </section>

          <div className="v3-row v3-section">
            <Link to="/lens?mission=lunar-rover" className="v3-btn v3-btn-primary">
              Check the lunar rover
            </Link>
            <Link to="/investigations" className="v3-btn">
              Browse the 15 investigations
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
