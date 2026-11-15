import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EvidenceMap } from '../EvidenceMap';
import type { SpaceStep } from '../EvidenceSpace';
import { OUTSIDE_PSI, cliffStats, fmt, useCompact } from '../data';
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

const STEPS: { title: string; body: (n: string, o2: string) => string }[] = [
  { title: 'Every flight test', body: (n) => `${n} records from NASA PSI, every one run in orbit near 0 g` },
  { title: 'The evidence cliff', body: (_n, o2) => `In PSI, no solid material, the stuff cabins are made of, flew above ${o2}% O₂` },
  { title: 'Where crews are going', body: () => 'Moon and Mars cabins sit past the cliff, at higher oxygen and in real gravity' },
];

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
    const id = setTimeout(() => setStep((s) => (s + 1) as SpaceStep), step === 0 ? 6500 : 6000);
    return () => clearTimeout(id);
  }, [step, touched]);

  const habitat = data?.missions.find((m) => m.id === 'lunar-base');
  const lunar = data?.missions.filter((m) => m.id === 'lunar-base' || m.id === 'lunar-rover') ?? [];
  const lunarO2 = lunar.flatMap((m) => (m.o2Pct === null ? [] : [m.o2Pct]));
  const lunarP = lunar.flatMap((m) => (m.pressureKpa === null ? [] : [m.pressureKpa]));
  const plotted = data ? data.rows.filter((r) => r.o2 !== null && r.kPa !== null && r.kPa <= 120).length : 0;
  const atHabitat =
    data && habitat?.o2Pct != null
      ? data.rows.filter((r) => r.phase === 'solid' && r.gravityMode === 'actual_flight' && r.o2Prov !== 'assumed' && r.o2 !== null && r.o2 >= (habitat.o2Pct as number) - 1).length
      : null;
  const saffire = OUTSIDE_PSI[0];
  const history = data?.history ?? [];
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
          <div className="v3-eyebrow">Space Apps 2026 · Flame in Freefall</div>
          <h1>
            Lunar cabins will breathe <span className="hl">{lunarO2.length ? `${Math.min(...lunarO2)}–${Math.max(...lunarO2)}%` : '30–34%'}</span> oxygen.
            The flight evidence stops at <span className="hl">{cliff ? `${fmt(cliff.o2Max)}%` : '22.7%'}</span>.
          </h1>
          <p className="v3-hero-lede">
            EMBER puts every fire experiment in NASA’s <Term k="psi">PSI</Term> database in one model, shows the nearest real tests to your cabin
            and how far away they are, and names the evidence still missing. It never gives a fire-risk percentage.
          </p>
          <div className="v3-row v3-hero-cta">
            <Link to="/lens" className="v3-btn v3-btn-primary v3-btn-lg">
              Check a cabin
            </Link>
            <Link to="/map" className="v3-btn v3-btn-lg">
              Open the evidence map
            </Link>
          </div>
          {webgl && !failed && (
            <div className="v3-hero3d-legend" aria-label="Legend">
              <span><i style={{ background: 'var(--v3-solid)' }} /> Solid material test</span>
              <span><i style={{ background: 'var(--v3-liquid)' }} /> Liquid droplet test</span>
              <span><i style={{ background: 'var(--v3-gas)' }} /> Gas flame test</span>
              <span><i className="puck" /> Planned cabin</span>
              <span><i className="ring" /> Flight test outside PSI</span>
              <span><i className="wall" /> Evidence cliff</span>
              <div className="v3-hero3d-hint">Drag to rotate · click a cabin</div>
            </div>
          )}
        </div>

        {data && cliff && habitat && (
          <aside className="v3-readout" aria-label="Computed from the loaded data">
            <div className="v3-readout-k">Readout · computed from PSI in your browser</div>
            <div className="v3-readout-q">
              Solid cabin material · {habitat.label} · {fmt(habitat.o2Pct)}% O₂ · {fmt(habitat.pressureKpa)} kPa
            </div>
            <dl>
              <div>
                <dt>PSI solid flight tests at this oxygen</dt>
                <dd className="big">{atHabitat ?? '—'}</dd>
              </div>
              <div>
                <dt>Closest in PSI</dt>
                <dd>
                  {fmt(cliff.o2Max)}% O₂ <small>gap {fmt((habitat.o2Pct as number) - cliff.o2Max)} pts</small>
                </dd>
              </div>
              <div>
                <dt>Closest anywhere</dt>
                <dd>
                  <Ext href={saffire.url}>{saffire.label}</Ext> <small>{fmt(saffire.o2)}% · {fmt(saffire.kPa)} kPa · outside PSI</small>
                </dd>
              </div>
            </dl>
          </aside>
        )}

        <div className="v3-hero3d-steps" role="group" aria-label="Walk through the evidence">
          {STEPS.map((s, i) => (
            <button
              key={s.title}
              type="button"
              className="v3-hero3d-step"
              aria-pressed={step === i}
              onClick={() => {
                setTouched(true);
                setStep(i as SpaceStep);
              }}
            >
              <i>0{i + 1}</i>
              <b>{s.title}</b>
              <span>{s.body(plotted.toLocaleString('en-US'), cliff ? fmt(cliff.o2Max) : '22.7')}</span>
            </button>
          ))}
        </div>

      </section>

      <div className="v3-wrap">
        {error && <div className="v3-callout v3-callout-warn v3-section">Could not load data: {error}</div>}
        {!data && !error && <Loading what="Loading NASA PSI data…" />}

        {data && cliff && (
          <>
            <section className="v3-kpis" aria-label="What is in EMBER">
              <div><b>{data.counts.investigations}</b><span>NASA PSI investigations</span></div>
              <div><b>{data.counts.tests.toLocaleString('en-US')}</b><span>test records, each traced to a PSI table row</span></div>
              <div><b>{data.counts.claims}</b><span>claims with a verbatim source quote</span></div>
              <div><b>{cliff.solidFlight}</b><span>solid-material flight tests with reported O₂</span></div>
            </section>

            <section className="v3-section">
              <div className="v3-section-head">
                <h2 className="v3-h2">Three atmospheres</h2>
                <p>How much oxygen a cabin breathes decides how readily its materials burn. The record so far, and where crews go next.</p>
              </div>
              <ol className="v3-atmos">
                <li>
                  <time>{history[0]?.year ?? 1967}</time>
                  <div className="fig">100%</div>
                  <h3>{history[0]?.title ?? 'Apollo 1'}</h3>
                  <p>A cabin fire in pure oxygen killed three astronauts on the pad. NASA lowered cabin oxygen and changed materials.</p>
                  {history[0]?.sources[0] && <Ext href={history[0].sources[0].url}>{history[0].sources[0].label}</Ext>}
                </li>
                <li>
                  <time>Flight record in PSI</time>
                  <div className="fig">{fmt(cliff.o2Min)}–{fmt(cliff.o2Max)}%</div>
                  <h3>What solids have burned in orbit</h3>
                  <p>
                    {cliff.solidFlight} solid-material flight tests with reported oxygen, at {fmt(cliff.kPaMin)}–{fmt(cliff.kPaMax)} kPa where
                    reported, all in <Term k="ug">microgravity</Term>. Outside PSI, Saffire-VI burned one cloth at 31% and 54 kPa in 2024.
                  </p>
                </li>
                <li className="next">
                  <time>Artemis and beyond</time>
                  <div className="fig">{lunarO2.length ? `${Math.min(...lunarO2)}–${Math.max(...lunarO2)}%` : '30–34%'}</div>
                  <h3>What lunar cabins plan</h3>
                  <p>
                    At {lunarP.length ? `${Math.min(...lunarP)}–${Math.max(...lunarP)}` : '56.5–70.3'} kPa and 1/6 g. Rover values are a design
                    scenario, not a vehicle specification. No PSI flight test covers these conditions.
                  </p>
                </li>
              </ol>
            </section>

            <section className="v3-section">
              <div className="v3-section-head">
                <h2 className="v3-h2">Three tools, all in your browser</h2>
                <p>No login, no API key. Every number links back to a PSI row or a NASA report.</p>
              </div>
              <div className="v3-tools">
                <Link to="/lens" className="v3-tool">
                  <span className="n">A</span>
                  <b>Check a cabin</b>
                  Pick the ISS, a lunar rover or your own atmosphere and a material. See the nearest real tests, axis by axis, and the evidence still needed.
                  <span className="go">Check a cabin →</span>
                </Link>
                <Link to="/map" className="v3-tool">
                  <span className="n">B</span>
                  <b>Evidence map</b>
                  All {data.counts.tests.toLocaleString('en-US')} records by oxygen and pressure, next to the cabins planned for the Moon and Mars.
                  <span className="go">Open the map →</span>
                </Link>
                <Link to="/ask" className="v3-tool">
                  <span className="n">C</span>
                  <b>Ask EMBER</b>
                  Ask in plain English. Answers cite PSI rows and NASA reports, and say so when the data does not support an answer.
                  <span className="go">Ask a question →</span>
                </Link>
              </div>
            </section>

            <section className="v3-section">
              <div className="v3-section-head">
                <h2 className="v3-h2">Same fire, different rules</h2>
                <p>The same flame at 1 g and in orbit. Without buoyancy hot gas does not rise, so the flame turns round. Change gravity, airflow and oxygen yourself.</p>
              </div>
              <div className="v3-stage">
                <iframe src="./intro.html?embed=1" title="Flame chamber: the same flame at 1 g and in microgravity" loading="lazy" allow="fullscreen" />
                <div className="v3-stage-note">
                  <span>An illustration, not a calculation. The flame shape is procedural; the evidence rows it cites are real PSI records.</span>
                  <a href="./intro.html" target="_blank" rel="noreferrer">Open full screen ↗</a>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
