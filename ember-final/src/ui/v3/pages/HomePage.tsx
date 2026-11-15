import { Suspense, lazy, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EvidenceFallback } from '../EvidenceFallback';
import { cliffStats, fmt, useCompact } from '../data';
import { Loading } from '../ui';

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

/**
 * One product. One decision:
 * choose a scenario, check what NASA actually tested, inspect the source rows.
 * No duplicated flame iframes, no three-stage marketing story, no fake simulation.
 */
export function HomePage() {
  const { data, error } = useCompact();
  const cliff = useMemo(() => (data ? cliffStats(data.rows) : null), [data]);
  const navigate = useNavigate();
  const [webgl] = useState(hasWebGL);
  const [renderFailed, setRenderFailed] = useState(false);

  const lunarReference = data?.missions.find((mission) => mission.id === 'lunar-base');
  const checkMission = (id: string) => {
    navigate('/lens?mission=' + encodeURIComponent(id));
  };

  return (
    <div className="v3-page v3-focus">
      <section className="v3-focus-hero" aria-labelledby="focus-heading">
        <div className="v3-focus-copy">
          <p className="v3-focus-kicker">NASA SPACE APPS / THE MISSING EXPERIMENT</p>
          <h1 id="focus-heading">The missing <em>flight test.</em></h1>
          <p className="v3-focus-lede">
            NASA’s published lunar exploration-atmosphere reference proposes
            <strong> {lunarReference?.o2Pct ?? 34}% oxygen at {fmt(lunarReference?.pressureKpa ?? 56.5)} kPa</strong>.
            In EMBER’s reviewed NASA PSI corpus, the <strong>{cliff?.solidFlight ?? '261'} solid-material
            flight records</strong> with reported oxygen reach only <strong>{cliff ? fmt(cliff.o2Max) : '22.7'}%</strong>.
            Which historical experiments can actually inform that mission?
          </p>
          <Link to="/lens?mission=lunar-base" className="v3-btn v3-btn-primary v3-btn-lg v3-focus-cta">
            Explore the evidence gap <span aria-hidden="true">↗</span>
          </Link>
          <p className="v3-focus-disclaimer">
            A coverage boundary is not a physical flammability threshold.
            Not a fire simulation or a safety certification.
            {' '}<a href="https://ntrs.nasa.gov/citations/20240003211" target="_blank" rel="noopener noreferrer">NASA atmosphere reference</a>.
          </p>
          {data && (
            <div className="v3-focus-metrics" aria-label="NASA PSI source records">
              <div><b>{data.counts.tests.toLocaleString('en-US')}</b><span>indexed test records</span></div>
              <div><b>{data.counts.investigations}</b><span>NASA PSI investigations</span></div>
            </div>
          )}
          {error && <div role="alert" className="v3-callout v3-callout-warn">NASA evidence data could not load: {error}</div>}
        </div>

        <div className="v3-focus-visual" aria-label="Interactive NASA PSI evidence visualization">
          <div className="v3-focus-visual-top">
            <span>Recorded evidence / {webgl && !renderFailed ? '3D' : '2D'}</span>
            <span>{webgl && !renderFailed ? 'Drag to examine' : '2D evidence view'}</span>
          </div>
          {data && cliff ? (
            webgl && !renderFailed ? (
              <Suspense fallback={<div className="v3-focus-loading"><Loading what="Preparing the evidence field…" /></div>}>
                <EvidenceSpace
                  rows={data.rows}
                  missions={data.missions}
                  cliff={cliff}
                  step={1}
                  onPickMission={(mission) => checkMission(mission.id)}
                  onFail={() => setRenderFailed(true)}
                />
              </Suspense>
            ) : (
              <div className="v3-focus-map-fallback">
                <EvidenceFallback
                  rows={data.rows}
                  missions={data.missions}
                  cliff={cliff}
                />
              </div>
            )
          ) : (
            <div className="v3-focus-loading">
              {error ? '3D evidence unavailable while source data is offline.' : <Loading what="Loading NASA PSI evidence…" />}
            </div>
          )}
          {webgl && !renderFailed && (
            <div className="v3-focus-visual-bottom">
              <span>Points show indexed PSI records with reported plotting dimensions</span>
              <span>Mission markers are scenarios, not flight experiments</span>
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
