import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { FuelPhase } from '../../../core';
import { EvidenceMap, MapLegend } from '../EvidenceMap';
import { MARGIN_ROWS, MARGIN_SOURCE, cliffStats, fmt, marginDelta, useCompact } from '../data';
import { Ext, Loading, PageHead } from '../ui';

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
            “no microgravity flight data for cabin materials at exploration atmospheres”. Partial-gravity tests do exist outside PSI: NASA Glenn ran solid materials in a centrifuge inside a drop tower at lunar gravity (Ferkul and Olson, 2011) and at Martian gravity (Olson and Ferkul, 2012, NTRS 20130010991), and aircraft parabolic flights reach 0.05–0.6 g. In both drop-tower studies some materials burned at lower oxygen than at 1 g. These tests last seconds, not minutes, so their extinction criteria differ from 1 g tests, and they are not in PSI. {cliff.assumedSmoke} SAME / SAME-R smoke records
            are drawn hollow: their atmosphere is assumed to be ISS cabin air, not measured.
          </section>

          <section className="v3-card v3-section" aria-labelledby="margin-h">
            <div className="v3-eyebrow">Why ground tests are not enough</div>
            <h2 id="margin-h" className="v3-h2">Materials burned at lower oxygen in microgravity than the ground test allows</h2>
            <p className="v3-muted">
              NASA screens cabin materials with an upward-burning test in normal gravity (NASA-STD-6001 Test 1). When the same materials were
              burned in a drop tower with a gentle airflow like cabin ventilation, all three kept burning at lower oxygen than in 1 g. A material
              that passes on Earth can still have a smaller oxygen margin in orbit.
            </p>
            <div className="v3-table-wrap">
              <table className="v3-table">
                <caption className="visually-hidden">1 g versus 0 g oxygen flammability limits for three spacecraft materials</caption>
                <thead>
                  <tr>
                    <th scope="col">Material</th>
                    <th scope="col">Pressure</th>
                    <th scope="col">1 g: burns down to / goes out at</th>
                    <th scope="col">0 g: burns down to / goes out at</th>
                    <th scope="col">Difference, 0 g − 1 g</th>
                  </tr>
                </thead>
                <tbody>
                  {MARGIN_ROWS.map((r) => {
                    const d = marginDelta(r);
                    return (
                      <tr key={r.material}>
                        <th scope="row">{r.material}</th>
                        <td>{fmt(r.kPa)} kPa ({fmt(r.psia)} psia)</td>
                        <td>{fmt(r.uloi1g)}% / {fmt(r.moc1g)}% O₂</td>
                        <td>{fmt(r.uloi0g)}% / {fmt(r.moc0g)}% O₂</td>
                        <td className="v3-num-bad">{d > 0 ? '+' : '−'}{fmt(Math.abs(d), 2)} pts O₂</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="v3-small v3-muted">
              “Burns down to” is the lowest oxygen at which the sample burned (ULOI); “goes out at” is the highest oxygen at which it put itself out
              (MOC). The difference is the report’s equation 1, mean 0 g limit minus mean 1 g limit, computed by EMBER from the table. 0 g values come
              from 5.18-second drops in the NASA Glenn Zero Gravity Research Facility with 30 cm/s airflow along the sample; 1 g values are Test 1 data
              from NASA White Sands. For Ultem the report’s text quotes a 0 g mean of 22.5% (−2.75 pts); the table values give −1.75 pts, shown here. Three thin materials only; these tests are not in PSI and are not used by the mission lens.
              Source: <Ext href={MARGIN_SOURCE.url}>{MARGIN_SOURCE.label}</Ext>.
            </p>
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
