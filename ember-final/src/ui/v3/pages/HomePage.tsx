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
  { title: 'Every test in PSI', body: (n) => `${n} fire tests from NASA PSI investigations with test tables, all run in orbit near 0 g` },
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
  const lunarO2 = lunar.map((m) => m.o2Pct ?? 0);
  const lunarP = lunar.map((m) => m.pressureKpa ?? 0);
  const plotted = data ? data.rows.filter((r) => r.o2 !== null && r.kPa !== null && r.kPa <= 120).length : 0;
  const apollo = data?.history[0];
  const pick = (id: string) => nav(`/lens?mission=${encodeURIComponent(id)}`);

  return (
    <div className="v3-page v3-home">
      <section className="v3-hero3d" aria-label="The evidence in 3D">
        {data && cliff ? (
          webgl && !failed ? (
            <Suspense fallback={<div className="v3-hero3d-canvas" />}>
              <EvidenceSpace rows={data.rows} missions={data.missions} cliff={cliff} step={step} onPickMission={(m) => pick(m.id)} onFail={() => setFailed(true)} />
            </Suspense>
          ) : (
            <div className="v3-hero3d-fallback">
              <EvidenceMap rows={data.rows} investigations={data.investigations} missions={data.missions} cliff={cliff} phase="solid" compact onPickMission={(m) => pick(m.id)} />
            </div>
          )
        ) : (
          <div className="v3-hero3d-canvas" />
        )}

        <div className="v3-hero3d-copy">
          <div className="v3-eyebrow">NASA Space Apps 2026 · Flame in Freefall</div>
          <h1>
            No NASA flight test has burned a solid material above <span className="cliff">{cliff ? `${fmt(cliff.o2Max)}%` : '22.7%'}</span> oxygen
          </h1>
          <p className="v3-hero-lede">
            Lunar cabins are planned at{' '}
            <strong>
              {lunar.length ? `${Math.min(...lunarO2)}–${Math.max(...lunarO2)}%` : '30–34%'} <Term k="o2">O₂</Term>
            </strong>{' '}
            and{' '}
            <strong>
              {lunar.length ? `${Math.min(...lunarP)}–${Math.max(...lunarP)}` : '56.5–70.3'} <Term k="kpa">kPa</Term>
            </strong>
            . EMBER puts the fire experiments in NASA’s <Term k="psi">PSI</Term> database that have test tables in one place and shows where the evidence ends for your cabin.
          </p>
          <div className="v3-row v3-hero-cta">
            <Link to="/lens" className="v3-btn v3-btn-primary v3-btn-lg">
              Check a cabin
            </Link>
            <Link to="/map" className="v3-btn v3-btn-lg">
              Open the evidence map
            </Link>
          </div>
        </div>

        <div className="v3-hero3d-steps" role="group" aria-label="Walk through the evidence">
          {STEPS.map((s, i) => (
            <button
              key={s.title}
              type="button"
              className={`v3-hero3d-step${s.cliff ? ' cliff' : ''}`}
              aria-pressed={step === i}
              onClick={() => {
                setTouched(true);
                setStep(i as SpaceStep);
              }}
            >
              <i>{i + 1}</i>
              <b>{s.title}</b>
              <span>{s.body(plotted.toLocaleString('en-US'), cliff ? fmt(cliff.o2Max) : '22.7')}</span>
            </button>
          ))}
        </div>

        {webgl && !failed && (
          <div className="v3-hero3d-legend" aria-label="Legend">
            <span>
              <i style={{ background: 'var(--v3-solid)' }} /> Solid material test
            </span>
            <span>
              <i style={{ background: 'var(--v3-liquid)' }} /> Liquid droplet test
            </span>
            <span>
              <i style={{ background: 'var(--v3-gas)' }} /> Gas flame test
            </span>
            <span>
              <i className="ring" /> Planned cabin
            </span>
            <span>
              <i className="wall" /> Evidence cliff
            </span>
            <div className="v3-hero3d-hint">Drag to rotate · click a cabin</div>
          </div>
        )}
      </section>

      <div className="v3-wrap">
        {error && <div className="v3-callout v3-callout-warn v3-section">Could not load data: {error}</div>}
        {!data && !error && <Loading what="Loading NASA PSI data…" />}

        {data && cliff && (
          <>
            <section className="v3-kpis" aria-label="What is in EMBER">
              <div>
                <b>{data.counts.investigations}</b>
                <span>PSI investigations with test tables</span>
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
                <article>
                  <time>ISS era</time>
                  <div className="fig">
                    {fmt(cliff.o2Min)}–{fmt(cliff.o2Max)}%
                  </div>
                  <h3>What has been flight-tested</h3>
                  <p>
                    {cliff.solidFlight} solid-material flight tests with measured oxygen, all near sea-level pressure ({Math.round(cliff.kPaMin)}–
                    {Math.round(cliff.kPaMax)} kPa) and all in <Term k="ug">microgravity</Term>.
                  </p>
                </article>
                <article className="now">
                  <time>Artemis and beyond</time>
                  <div className="fig">
                    {lunar.length ? `${Math.min(...lunarO2)}–${Math.max(...lunarO2)}%` : '30–34%'}
                  </div>
                  <h3>What lunar cabins plan</h3>
                  <p>
                    Higher oxygen at lower pressure, in 1/6 g. No solid-material flight test overlaps these conditions. That gap is what EMBER makes
                    visible.
                  </p>
                </article>
              </div>
            </section>

            <section className="v3-section">
              <div className="v3-section-head">
                <h2 className="v3-h2">What you can do here</h2>
                <p>Three tools, all running in your browser on NASA data. No login, no API key.</p>
              </div>
              <div className="v3-tools">
                <Link to="/lens" className="v3-tool">
                  {Icon.cabin}
                  <b>Check a cabin</b>
                  Pick the ISS, a lunar rover or your own atmosphere and a material. EMBER answers Measured, Data nearby or Beyond the evidence, and lists
                  the nearest real tests.
                  <span className="go">Check a cabin →</span>
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

            <section className="v3-section v3-earth-link">
              <div>
                <h2 className="v3-h2">Back to Earth</h2>
                <p>Smoke detectors, firefighter gear and water-mist extinguishers trace back to the same NASA fire research.</p>
              </div>
              <Link to="/earth" className="v3-btn">
                See what it gave us →
              </Link>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
