import { Suspense, lazy, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EvidenceMap } from '../EvidenceMap';
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

  const checkMission = (id: string) => {
    navigate('/lens?mission=' + encodeURIComponent(id));
  };

  return (
    <div className="v3-page v3-focus">
      <section className="v3-focus-hero" aria-labelledby="focus-heading">
        <div className="v3-focus-copy">
          <p className="v3-focus-kicker">EMBER / NASA PHYSICAL SCIENCES INFORMATICS</p>
          <h1 id="focus-heading">Find the edge of the evidence.</h1>
          <p className="v3-focus-lede">
            Choose a spacecraft environment and a material. EMBER checks which
            NASA fire experiments match the conditions, which are only related,
            and where the record stops.
          </p>
          <Link to="/lens" className="v3-btn v3-btn-primary v3-btn-lg v3-focus-cta">
            Check a mission scenario <span aria-hidden="true">↗</span>
          </Link>
          <p className="v3-focus-disclaimer">
            A historical evidence check. Not a fire simulation or a safety certification.
          </p>
          {data && (
            <div className="v3-focus-metrics" aria-label="NASA PSI source records">
              <div><b>{data.counts.tests.toLocaleString('en-US')}</b><span>indexed test records</span></div>
              <div><b>{data.counts.investigations}</b><span>NASA PSI investigations with test tables</span></div>
            </div>
          )}
          {error && <div role="alert" className="v3-callout v3-callout-warn">NASA evidence data could not load: {error}</div>}
        </div>

        <div className="v3-focus-visual" aria-label="Interactive NASA PSI evidence visualization">
          <div className="v3-focus-visual-top">
            <span>Recorded evidence / 3D</span>
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
            <div className="v3-focus-loading">
              {error ? '3D evidence unavailable while source data is offline.' : <Loading what="Loading NASA PSI evidence…" />}
            </div>
          )}
          <div className="v3-focus-visual-bottom">
            <span>Dots = indexed tests with plottable conditions</span>
            <span>Mission markers = proposed scenarios, not flight tests</span>
          </div>
        </div>
      </section>

      {cliff && (
        <section className="v3-focus-finding" aria-label="The evidence finding">
          <div className="v3-focus-finding-text">
            <span className="v3-focus-kicker">A gap in the historical record</span>
            <h2>
              {fmt(cliff.o2Max)}% O₂ is the upper reported oxygen level
              in this corpus's solid-material flight-test subset.
            </h2>
          </div>
          <div className="v3-focus-finding-side">
            <p>
              {cliff.solidFlight} solid-material flight records have reported oxygen.
              A coverage boundary is not a physical flammability threshold.
              Explore the underlying observations before interpreting it for a mission.
            </p>
            <Link to="/map" className="v3-focus-textlink">
              Inspect NASA records <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
