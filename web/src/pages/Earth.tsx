import { Link } from 'react-router-dom';
import { useData } from '../data/context';
import { PageHead, SourceLink } from '../components/ui';

export default function Earth() {
  const { earth, investigations } = useData();
  return (
    <>
      <PageHead eyebrow="Module 4.9" title="Back to Earth">
        <p>
          Findings from fire in space that carry over to fire safety on the ground: water-mist extinguishers, smoke detectors, breathing
          apparatus and firefighter protective gear.
        </p>
      </PageHead>
      {earth.length === 0 && <p className="muted">No Earth-application stories in the dataset yet.</p>}
      <div className="grid grid-3">
        {earth.map((e) => (
          <article key={e.id} className="card">
            <h2>{e.title}</h2>
            <p>{e.summary}</p>
            {e.linkedInvestigations.length > 0 && (
              <p className="small">
                From:{' '}
                {e.linkedInvestigations.map((id, i) => (
                  <span key={id}>
                    {i > 0 && ', '}
                    <Link to={`/investigations/${encodeURIComponent(id)}`}>{investigations.find((x) => x.id === id)?.name ?? id}</Link>
                  </span>
                ))}
              </p>
            )}
            <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
              {e.sources.map((s, i) => (
                <li key={i}><SourceLink source={s} /></li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      {investigations.some((i) => i.earthRelevance) && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Earth relevance by investigation</h2>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {investigations.filter((i) => i.earthRelevance).map((i) => (
              <li key={i.id}>
                <Link to={`/investigations/${encodeURIComponent(i.id)}`}>{i.id}</Link>: {i.earthRelevance}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
