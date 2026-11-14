import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Async, ModeBadge, Badge, useAsync } from '../components/ui';

export function SavedReviews() {
  const r = useAsync(() => api.reviews(), []);
  return (
    <div className="stack">
      <h1>Saved reviews</h1>
      <Async r={r} label="Loading reviews">{(items) => items.length === 0 ? <p className="muted">No saved reviews yet. <Link to="/review">Start one.</Link></p> : (
        <div className="stack">{items.map((i) => (
          <article key={i.id} className="card">
            <div className="row"><ModeBadge mode={i.mode} /><Badge>Revision {i.revision}</Badge>{i.endpoint && <Badge tone="accent">{i.endpoint.replace(/_/g, ' ')}</Badge>}{i.parent_id && <Badge tone="info">variant of {i.parent_id}</Badge>}<span className="small dim">{i.created}</span></div>
            <h3 style={{ marginTop: 8 }}><Link to={`/r/${encodeURIComponent(i.id)}`}>{i.question || i.id}</Link></h3>
          </article>))}</div>
      )}</Async>
    </div>
  );
}
