import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { ErrorBanner } from '../components/ui';

export function loadDemoReviewId(reviews: { id: string; mode: string }[]): string | null {
  return (reviews.find((r) => r.mode === 'saved_example') ?? reviews[0])?.id ?? null;
}

export function Landing() {
  const nav = useNavigate();
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const demo = async () => {
    setBusy(true); setErr(null);
    try {
      const meta = await api.meta().catch(() => null);
      const id = meta?.saved_example_id ?? loadDemoReviewId(await api.reviews());
      if (!id) throw new Error('No saved example review is available on the backend.');
      nav(`/r/${encodeURIComponent(id)}`);
    } catch (e) { setErr(e); setBusy(false); }
  };
  return (
    <>
      <section className="hero fade-in">
        <h1>EMBER <span className="grad">Spacecraft Fire Evidence Lab</span></h1>
        <p className="tag">Know what the evidence supports. Test what matters next.</p>
        <p className="muted">EMBER reads published spacecraft fire-safety experiments, keeps every recorded condition and its source, and tells you which findings apply to your configuration, which do not, and which comparison you would still have to run.</p>
        <div className="row">
          <button className="btn primary" onClick={demo} disabled={busy}>{busy ? 'Opening…' : 'Load demo review'}</button>
          <Link className="btn" to="/review">Start your own review</Link>
          <Link className="btn" to="/explore">Browse experiments</Link>
        </div>
        <div style={{ marginTop: 16 }}><ErrorBanner error={err} /></div>
      </section>
      <section className="card">
        <h2>The central scenario</h2>
        <p className="muted">Thin PMMA in an oxygen-enriched habitat. Three questions in one material, each needing different evidence:</p>
        <div className="scenario">
          <div className="step"><b>1 · Ignition</b>Can it start, under which ignition source and conditions?</div>
          <div className="step"><b>2 · Spread</b>Does flame spread once established, and how does flow assist or oppose it?</div>
          <div className="step"><b>3 · Extinction</b>What happens when flow is reduced: does the flame go out, and how?</div>
        </div>
      </section>
      <div className="grid two">
        <section className="card"><h3>What it will not do</h3>
          <ul className="muted"><li>It never invents numbers: anything not in a cited source is shown as <em>unknown</em>.</li>
            <li>It does not claim a changed parameter caused a changed outcome from two tests.</li>
            <li>It does not simulate fire; the replay view is a data replay.</li></ul></section>
        <section className="card"><h3>How to read results</h3>
          <ul className="muted"><li>Relevance, applicability and evidence quality are separate scores.</li>
            <li>Observation, interpretation and possible application are separate layers.</li>
            <li>Records marked <em>provisional</em> have not been checked against the document.</li></ul></section>
      </div>
    </>
  );
}
