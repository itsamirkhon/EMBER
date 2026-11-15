import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EvidenceMap } from '../EvidenceMap';
import type { SpaceStep } from '../EvidenceSpace';
import { cliffStats, fmt, useCompact } from '../data';
import { Ext, Loading, Term } from '../ui';

const EvidenceSpace = lazy(() => import('../EvidenceSpace'));

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const STEPS: { title: string; body: (n: string, o2: string) => string; cliff?: boolean }[] = [
  { title: 'Every test NASA flew', body: (n) => `${n} fire tests from NASA flight experiments, all run in orbit near 0 g` },
  { title: 'The evidence cliff', body: (_n, o2) => `Solid materials, the stuff cabins are made of, were never flight-tested above ${o2}% oxygen`, cliff: true },
  { title: 'Where we are going', body: () => 'Moon and Mars cabins sit past the cliff, at higher oxygen and in real gravity' },
];

const Icon = {
  map: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3v18h18" />
      <circle cx="8" cy="14" r="1.5" />
      <circle cx="11" cy="11" r="1.5" />
      <circle cx="9" cy="8" r="1.5" />
      <path d="M15 4v14" strokeDasharray="2 2" />
      <circle cx="19" cy="9" r="2" />
    </svg>
  ),
  cabin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </svg>
  ),
  ask: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.2" />
      <path d="M12 16.5h.01" />
    </svg>
  ),
};

export function HomePage() {
  const { data, error } = useCompact();
  const nav = useNavigate();
  const cliff = useMemo(() => (data ? cliffStats(data.rows) : null), [data]);
  const [webgl] = useState(hasWebGL);
  const [failed, setFailed] = useState(false);
  const [step, setStep] = useState<SpaceStep>(0);
  const [touched, setTouched] = useState(false);

  // play the three steps once on their own, unless the visitor takes over
  useEffect(() => {
    if (touched || step === 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setTimeout(() => setStep((s) => (s + 1) as SpaceStep), step === 0 ? 7000 : 6500);
    return () => clearTimeout(id);
  }, [step, touched]);

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

      <div className="v3-wrap">
        {error && <div className="v3-callout v3-callout-warn v3-section">Could not load data: {error}</div>}
        {!data && !error && <Loading what="Loading NASA PSI data…" />}

        {data && cliff && (
          <>
            <section className="v3-kpis" aria-label="What is in EMBER">
              <div>
                <b>{data.counts.investigations}</b>
                <span>NASA flight experiments</span>
              </div>
              <div>
                <b>{data.counts.tests.toLocaleString('en-US')}</b>
                <span>test records, each traced to a PSI table row</span>
              </div>
              <div>
                <b>{data.counts.claims}</b>
                <span>claims backed by a quote from the source</span>
              </div>
              <div>
                <b>{cliff.solidFlight}</b>
                <span>solid-material flight tests with measured O₂</span>
              </div>
            </section>

            <section className="v3-section">
              <div className="v3-section-head">
                <h2 className="v3-h2">Why oxygen matters</h2>
              </div>
              <div className="v3-timeline3">
                <article>
                  <time>{apollo?.year ?? 1967}</time>
                  <div className="fig">100% O₂</div>
                  <h3>{apollo?.title ?? 'Apollo 1'}</h3>
                  <p>A cabin fire in pure oxygen killed three astronauts on the pad. NASA lowered cabin oxygen and changed materials.</p>
                  {apollo?.sources[0] && <Ext href={apollo.sources[0].url}>{apollo.sources[0].label}</Ext>}
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
                <Link to="/map" className="v3-tool">
                  {Icon.map}
                  <b>Evidence map</b>
                  All {data.counts.tests.toLocaleString('en-US')} tests by oxygen and pressure, next to the cabins NASA plans to fly. Filter by fuel and by
                  experiment.
                  <span className="go">Open the map →</span>
                </Link>
                <Link to="/ask" className="v3-tool">
                  {Icon.ask}
                  <b>Ask EMBER</b>
                  Ask in plain English. Every answer cites a PSI row or NASA report, and says so when the data does not support an answer.
                  <span className="go">Ask a question →</span>
                </Link>
              </div>
            </section>

            <section className="v3-section">
              <div className="v3-section-head">
                <h2 className="v3-h2">Same fire, different rules</h2>
                <p>The same candle at 1 g and in orbit. Without buoyancy the flame turns blue and round. Change gravity, airflow and oxygen yourself.</p>
              </div>
              <div className="v3-stage">
                <iframe src="./intro.html" title="Flame chamber: the same flame at 1 g and in microgravity" loading="lazy" allow="fullscreen" />
                <div className="v3-stage-note">
                  An illustration, not a calculation. The flame shape is procedural; the evidence rows it cites are real PSI records.{' '}
                  <a href="./intro.html" target="_blank" rel="noreferrer">
                    Open full screen ↗
                  </a>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
