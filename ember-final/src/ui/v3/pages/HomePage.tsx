import { Link } from 'react-router-dom';
import { cliffStats, fmt, useCompact } from '../data';
import { Ext, Loading } from '../ui';

export function HomePage() {
  const { data, error } = useCompact();
  const cliff = data ? cliffStats(data.rows) : null;
  const lunar = data?.missions.filter((m) => m.id === 'lunar-base' || m.id === 'lunar-rover') ?? [];
  const lunarO2 = lunar.flatMap((m) => m.o2Pct === null ? [] : [m.o2Pct]);
  const lunarP = lunar.flatMap((m) => m.pressureKpa === null ? [] : [m.pressureKpa]);

  return (
    <div className="v3-page">
      <section className="v3-hero">
        <div className="v3-eyebrow">NASA Space Apps 2026 · Flame in Freefall</div>
        <h1>
          NASA’s spaceflight fire evidence, together. <em>And the line where it ends.</em>
        </h1>
        {cliff ? (
          <p className="v3-hero-lede">
            In the reviewed NASA PSI corpus, {cliff.solidFlight} solid-material flight-test records with reported oxygen
            stop at <strong>{fmt(cliff.o2Max)}% O₂</strong>. Where pressure is reported,
            these records lie between {fmt(cliff.kPaMin)} and {fmt(cliff.kPaMax)} kPa where reported.
            {lunarO2.length && lunarP.length ? (
              <> The selected lunar design scenarios use <strong>{Math.min(...lunarO2)}–{Math.max(...lunarO2)}% O₂ at {Math.min(...lunarP)}–{Math.max(...lunarP)} kPa</strong>;
              rover values are exploratory, not a published vehicle specification.</>
            ) : null}
            {' '}EMBER compares these historical records with a scenario. It does not run a new fire test.
          </p>
        ) : (
          <p className="v3-hero-lede">{error ? 'The evidence is currently unavailable.' : 'Loading the evidence…'}</p>
        )}
        <div className="v3-row v3-hero-cta">
          <Link to="/map" className="v3-btn v3-btn-primary">
            Open the evidence map
          </Link>
          <Link to="/lens" className="v3-btn">
            Check historical test coverage
          </Link>
          <Link to="/ask" className="v3-btn v3-btn-ghost">
            Ask EMBER →
          </Link>
        </div>
      </section>

      <section className="v3-stage" aria-labelledby="v3-stage-title">
        <div className="v3-stage-header">
          <div>
            <div className="v3-eyebrow">Interactive concept · 1 g versus microgravity</div>
            <h2 id="v3-stage-title">How gravity changes a flame</h2>
            <p>Compare buoyant flow on Earth with the near-weightless environment of orbit.</p>
          </div>
          <a href="./intro.html" target="_blank" rel="noopener noreferrer" className="v3-btn">
            Explore full presentation ↗
          </a>
        </div>
        <iframe
          src="./intro.html?embed=1"
          title="Interactive 3D chamber: compare fire at Earth gravity and microgravity"
          loading="lazy"
          allow="fullscreen"
        />
        <div className="v3-stage-note">
          <span>Drag to orbit · Conceptual 3D illustration, not a physical simulation or a safety prediction.</span>
          <Link to="/map">Explore the actual NASA flight evidence →</Link>
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
                  <b>See the map.</b> The plotted PSI records with oxygen and pressure data, alongside labeled mission scenarios. Some records lack plottable values.
                </Link>
              </li>
              <li>
                <Link to="/lens">
                  <b>Pick a scenario and material.</b> Explicitly check existing records for <i>Historical match</i>, <i>Related records</i> or{' '}
                  <i>No matching flight test</i>—never a fire-risk percentage or safety certification.
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
