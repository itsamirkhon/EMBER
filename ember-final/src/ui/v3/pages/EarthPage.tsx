import { Link } from 'react-router-dom';
import { invColor } from '../EvidenceMap';
import { useCompact } from '../data';
import { Ext, Loading, PageHead } from '../ui';

export function EarthPage() {
  const { data, error } = useCompact();
  return (
    <div className="v3-page">
      <PageHead eyebrow="Back to Earth" title="Fire research in orbit protects people on the ground.">
        Smoke detectors, firefighter gear, water-mist extinguishers and fire models for mines, submarines and aircraft trace back to the same
        NASA programmes. Each story links to the investigations behind it.
      </PageHead>
      {error && <div className="v3-callout v3-callout-warn">Could not load data: {error}</div>}
      {!data && !error && <Loading what="Loading…" />}
      {data && (
        <>
          <div className="v3-grid-3">
            {data.earth.map((e) => (
              <article key={e.id} className="v3-card v3-story">
                <h3>{e.title}</h3>
                <p className="v3-muted">{e.summary}</p>
                {e.quote && <p className="v3-quote">“{e.quote}”</p>}
                <div className="v3-row v3-small">
                  {e.linkedInvestigations.length ? (
                    e.linkedInvestigations.map((id) => (
                      <Link key={id} to={`/investigations/${encodeURIComponent(id)}`} className="v3-tag">
                        <span className="v3-swatch" style={{ background: invColor(id) }} /> {id}
                      </Link>
                    ))
                  ) : (
                    <span className="v3-muted">{e.linkNote ?? 'Spacecraft technology heritage'}</span>
                  )}
                </div>
                <div className="v3-small">
                  {e.sources.map((s) => (
                    <div key={s.url}>
                      <Ext href={s.url}>{s.label}</Ext>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>

          <section className="v3-section">
            <h2 className="v3-h2">The fires that shaped the rules</h2>
            <ol className="v3-timeline">
              {data.history.map((h) => (
                <li key={h.id}>
                  <div className="v3-timeline-year">{h.year}</div>
                  <div>
                    <h3>{h.title}</h3>
                    <p className="v3-muted">{h.summary}</p>
                    {h.lesson && <p>{h.lesson}</p>}
                    <div className="v3-small">
                      {h.sources.map((s) => (
                        <span key={s.url}>
                          <Ext href={s.url}>{s.label}</Ext>{' '}
                        </span>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
