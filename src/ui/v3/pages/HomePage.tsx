import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EvidenceMap } from '../EvidenceMap';
import type { SpaceStep } from '../EvidenceSpace';
import { OUTSIDE_PSI, cliffStats, fmt, useCompact } from '../data';
import { Ext, Loading, Term } from '../ui';
import { tourHref } from '../Tour';

const EvidenceSpace = lazy(() => import('../EvidenceSpace'));

/** WebGL is optional. The 2D NASA evidence map is a real, usable fallback. */
function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

const STEPS: { title: string; body: (n: string, o2: string) => string }[] = [
  { title: 'Every flight test', body: (n) => `${n} flight records with reported O₂, pressure and gravity` },
  { title: 'The coverage boundary', body: (_n, o2) => `In PSI, no solid-material flight test reported more than ${o2}% O₂` },
  { title: 'Where crews are going', body: () => 'Moon and Mars scenarios sit past it, at higher oxygen and in real gravity' },
];

/**
 * One product, one decision: choose a scenario, check what NASA actually tested, inspect the source rows.
 * The 3D field is the real PSI record; the readout beside it is computed from the same rows in the browser.
 */
export function HomePage() {
  const { data, error } = useCompact();
  const cliff = useMemo(() => (data ? cliffStats(data.rows) : null), [data]);
  const navigate = useNavigate();
  const [webgl] = useState(hasWebGL);
  const [renderFailed, setRenderFailed] = useState(false);
  const [step, setStep] = useState<SpaceStep>(0);
  const [touched, setTouched] = useState(false);

  // play the three camera stops once, unless the visitor takes over
  useEffect(() => {
    if (touched || step === 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setTimeout(() => setStep((s) => (s + 1) as SpaceStep), step === 0 ? 6500 : 6000);
    return () => clearTimeout(id);
  }, [step, touched]);

  const checkMission = (id: string) => {
    navigate('/lens?mission=' + encodeURIComponent(id));
  };

  const habitat = data?.missions.find((m) => m.id === 'lunar-base');
  const lunar = data?.missions.filter((m) => m.id === 'lunar-base' || m.id === 'lunar-rover') ?? [];
  const lunarO2 = lunar.flatMap((m) => (m.o2Pct === null ? [] : [m.o2Pct]));
  const lunarP = lunar.flatMap((m) => (m.pressureKpa === null ? [] : [m.pressureKpa]));
  const plotted = data ? data.rows.filter((r) => r.gravityMode === 'actual_flight' && r.g !== null && r.o2 !== null && r.kPa !== null && r.kPa <= 120).length : 0;
  const atHabitat =
    data && habitat?.o2Pct != null
      ? data.rows.filter((r) => r.phase === 'solid' && r.gravityMode === 'actual_flight' && r.o2Prov !== 'assumed' && r.o2 !== null && r.o2 >= (habitat.o2Pct as number) - 1).length
      : null;
  const saffire = OUTSIDE_PSI[0];
  const history = data?.history ?? [];

  return (
    <div className="v3-page v3-home">
      <section className="v3-hero3d" aria-label="Interactive NASA PSI evidence visualization">
        {data && cliff ? (
          webgl && !renderFailed ? (
            <Suspense fallback={<div className="v3-hero3d-canvas" />}>
              <EvidenceSpace
                rows={data.rows}
                missions={data.missions}
                cliff={cliff}
                step={step}
                onPickMission={(mission) => checkMission(mission.id)}
                onFail={() => setRenderFailed(true)}
              />
            </Suspense>
          ) : (
            <div className="v3-hero3d-fallback">
              <EvidenceMap
                rows={data.rows}
                investigations={data.investigations}
                missions={data.missions}
                cliff={cliff}
                phase="solid"
                compact
                onPickMission={(mission) => checkMission(mission.id)}
              />
            </div>
          )
        ) : (
          <div className="v3-hero3d-canvas">
            {error ? null : <Loading what="Loading NASA PSI evidence…" />}
          </div>
        )}

        <div className="v3-hero3d-copy">
          <div className="v3-eyebrow">EMBER — Evidence Map for Burn &amp; Extinction Risk</div>
          <h1>
            Lunar cabins will breathe <span className="hl">{lunarO2.length ? `${Math.min(...lunarO2)}–${Math.max(...lunarO2)}%` : '30–34%'}</span> oxygen.
            The flight evidence stops at <span className="hl">{cliff ? `${fmt(cliff.o2Max)}%` : '22.7%'}</span>.
          </h1>
          <p className="v3-hero-lede">
            Choose a spacecraft environment and a material. EMBER checks which NASA <Term k="psi">PSI</Term> fire experiments match the
            conditions, which are only related, and where the record stops.
          </p>
          <div className="v3-row v3-hero-cta">
            <Link to="/lens?mission=lunar-rover&material=PMMA" className="v3-btn v3-btn-primary v3-btn-lg">
              Check your cabin <span aria-hidden="true">↗</span>
            </Link>
            <Link to={tourHref(1)} className="v3-btn v3-btn-lg">
              Judges’ tour · 2 minutes
            </Link>
          </div>
          <p className="v3-hero-disclaimer">A historical evidence check. Not a fire simulation or a safety certification.</p>
          {error && <div role="alert" className="v3-callout v3-callout-warn">NASA evidence data could not load: {error}</div>}
          {webgl && !renderFailed && (
            <div className="v3-hero3d-legend" aria-label="Legend">
              <span><i style={{ background: 'var(--v3-solid)' }} /> Solid material test</span>
              <span><i style={{ background: 'var(--v3-liquid)' }} /> Liquid droplet test</span>
              <span><i style={{ background: 'var(--v3-gas)' }} /> Gas flame test</span>
              <span><i className="puck" /> Mission scenario, not a test</span>
              <span><i className="ring" /> Flight test outside PSI</span>
              <span><i className="wall" /> Solid-flight coverage boundary</span>
              <div className="v3-hero3d-hint">Drag to rotate · click a scenario to check it</div>
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
        {!data && !error && <Loading what="Loading NASA PSI data…" />}

        {data && cliff && (
          <>
            <section className="v3-kpis" aria-label="NASA PSI source records">
              <div><b>{data.counts.investigations}</b><span>NASA PSI investigations with test tables</span></div>
              <div><b>{data.counts.tests.toLocaleString('en-US')}</b><span>indexed test records, each traced to a PSI table row</span></div>
              <div><b>{cliff.solidFlight}</b><span>solid-material flight records with reported oxygen</span></div>
              <div><b>{data.counts.claims}</b><span>claims with a verbatim source quote</span></div>
            </section>

            <section className="v3-section v3-finding" aria-label="The evidence finding">
              <div>
                <div className="v3-eyebrow">A gap in the historical record</div>
                <h2 className="v3-h2">
                  <span className="hl">{fmt(cliff.o2Max)}% O₂</span> is the upper reported oxygen level in this corpus’s solid-material flight-test
                  subset.
                </h2>
              </div>
              <div>
                <p>
                  {cliff.solidFlight} solid-material flight records have reported oxygen. A coverage boundary is not a physical flammability threshold.
                  Explore the underlying observations before interpreting it for a mission.
                </p>
                <Link to="/map" className="v3-textlink">
                  Inspect NASA records <span aria-hidden="true">↗</span>
                </Link>
              </div>
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
                  <h3>What lunar cabin scenarios use</h3>
                  <p>
                    At {lunarP.length ? `${Math.min(...lunarP)}–${Math.max(...lunarP)}` : '56.5–70.3'} kPa and 1/6 g. Rover values are a design
                    scenario, not a vehicle specification. No PSI flight test covers these conditions.
                  </p>
                </li>
              </ol>
              <p className="v3-small v3-muted v3-appendix">
                Why gravity matters: <a href="./intro.html">open the flame chamber</a>, an illustration of the same flame at 1 g and in orbit.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
