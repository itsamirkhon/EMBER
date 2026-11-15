import { Link } from 'react-router-dom';
import { cliffStats, fmt, useCompact } from '../data';
import { Ext, Loading } from '../ui';

export function HomePage() {
  const { data, error } = useCompact();
  const cliff = data ? cliffStats(data.rows) : null;
  const lunar = data?.missions.filter((m) => m.id === 'lunar-base' || m.id === 'lunar-rover') ?? [];
  const lunarO2 = lunar.map((m) => m.o2Pct ?? 0);
  const lunarP = lunar.map((m) => m.pressureKpa ?? 0);

  return (
    <div className="v3-page">
      <section className="v3-hero">
        <div className="v3-eyebrow">NASA Space Apps 2026 · Flame in Freefall</div>
        <h1>
          Every NASA fire experiment in one place. <em>And the line where the evidence ends.</em>
        </h1>
        {cliff ? (
          <p className="v3-hero-lede">
            No solid-material flight test in NASA’s PSI repository ran above <strong>{fmt(cliff.o2Max)}% oxygen</strong>; all{' '}
            {cliff.solidFlight} of them ran near {Math.round(cliff.kPaMin)}–{Math.round(cliff.kPaMax)} kPa. Lunar cabins plan{' '}
            <strong>
              {Math.min(...lunarO2)}–{Math.max(...lunarO2)}% O₂ at {Math.min(...lunarP)}–{Math.max(...lunarP)} kPa
            </strong>
            . EMBER shows engineers where NASA’s data ends for their cabin, and which test is nearest.
          </p>
        ) : (
          <p className="v3-hero-lede">Loading the evidence…</p>
        )}
        <div className="v3-row v3-hero-cta">
          <Link to="/map" className="v3-btn v3-btn-primary">
            Open the evidence map
          </Link>
          <Link to="/lens" className="v3-btn">
            Check your cabin
          </Link>
          <Link to="/ask" className="v3-btn v3-btn-ghost">
            Ask EMBER →
          </Link>
        </div>
      </section>

      <section className="v3-stage" aria-label="Intro: fire in microgravity">
        <iframe src="./intro.html" title="EMBER intro: the same flame at 1 g and in microgravity, then a lunar cabin" loading="lazy" allow="fullscreen" />
        <div className="v3-stage-note">
          3D illustration, not a calculation. The flame shape is procedural; the evidence rows it cites are real PSI records.{' '}
          <a href="./intro.html" target="_blank" rel="noreferrer">
            Open full screen ↗
          </a>
        </div>
      </section>

      {error && <div className="v3-callout v3-callout-warn">Could not load data: {error}</div>}
      {!data && !error && <Loading what="Loading NASA PSI data…" />}

      {data && cliff && (
        <>
          <section className="v3-kpis" aria-label="What is in EMBER">
            <div>
              <b>{data.counts.investigations}</b>
              <span>NASA PSI investigations</span>
            </div>
            <div>
              <b>{data.counts.tests.toLocaleString('en-US')}</b>
              <span>test records, each traced to a PSI table row</span>
            </div>
            <div>
              <b>{data.counts.claims}</b>
              <span>claims with a verbatim source quote</span>
            </div>
            <div>
              <b>{cliff.solidFlight}</b>
              <span>solid-material flight tests with measured O₂</span>
            </div>
          </section>

          <section className="v3-section">
            <h2 className="v3-h2">Why this matters</h2>
            <div className="v3-grid-3">
              {data.history.slice(0, 3).map((h) => (
                <article key={h.id} className="v3-card">
                  <div className="v3-eyebrow">{h.year}</div>
                  <h3>{h.title}</h3>
                  <p className="v3-muted">{h.summary}</p>
                  {h.sources[0] && <Ext href={h.sources[0].url}>{h.sources[0].label}</Ext>}
                </article>
              ))}
            </div>
          </section>

          <section className="v3-section">
            <h2 className="v3-h2">Two minutes for an engineer</h2>
            <ol className="v3-steps">
              <li>
                <Link to="/map">
                  <b>See the map.</b> All {data.counts.tests.toLocaleString('en-US')} test records by oxygen and pressure, with the cabins NASA plans to fly.
                </Link>
              </li>
              <li>
                <Link to="/lens">
                  <b>Pick your cabin and material.</b> EMBER ranks the investigations that apply and says <i>Measured</i>, <i>Data nearby</i> or{' '}
                  <i>Beyond the evidence</i>, with no invented risk percentage.
                </Link>
              </li>
              <li>
                <Link to="/lens">
                  <b>See the nearest real tests</b> and how far your conditions are from them, axis by axis.
                </Link>
              </li>
              <li>
                <Link to="/ask">
                  <b>Ask a question.</b> Answers cite PSI rows and NASA reports; with no support, EMBER says so.
                </Link>
              </li>
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
