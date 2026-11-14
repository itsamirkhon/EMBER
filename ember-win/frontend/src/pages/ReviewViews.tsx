import type React from 'react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Contrast, QueryConfig, ResearchQuery, TestProgramme, VariantResult, Replay } from '../api/types';
import type { ExportFormat } from '../api/client';
import { ConfigForm } from '../components/ConfigForm';
import { Async, Badge, Conds, Disclaimer, ErrorBanner, Expand, Field, KV, Loading, Sv, Val, download, fmt, pretty, useAsync } from '../components/ui';
import type { TestRecord } from '../api/types';
import type { TestIndex } from '../lib/testIndex';
import { Timeline } from '../components/Timeline';
import { ClaimCard, useReview } from './Review';

// ---- Insights: three separate layers ---------------------------------------
export function Insights() {
  const { review } = useReview();
  if (!review.safety_insights.length) return <p className="muted">No fire-safety insights were produced for this review.</p>;
  return (
    <div className="stack">
      <Disclaimer>Each insight keeps three layers apart. Only the observation comes straight from a recorded test; the other two are reasoning and may not hold outside the stated conditions.</Disclaimer>
      {review.safety_insights.map((i) => (
        <article key={i.id} className="card">
          <div className="row"><h2 style={{ margin: 0 }}>{pretty(i.topic) || 'Insight'}</h2>{i.claim_ids.map((c) => <Badge key={c}>claim {c}</Badge>)}</div>
          <div className="layers" style={{ marginTop: 12 }}>
            <div className="layer obs"><div className="lbl">Observation</div>{i.observation || <Val x={null} />}</div>
            <div className="layer int"><div className="lbl">Interpretation</div>{i.interpretation || <Val x={null} />}</div>
            <div className="layer app"><div className="lbl">Possible application</div>{i.possible_application || <Val x={null} />}</div>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>Conditions: <Conds c={i.conditions} /></p>
          {i.open_questions.length > 0 && <p className="small muted">Open questions: {i.open_questions.map((q) => <Badge key={q}>{q}</Badge>)}</p>}
        </article>
      ))}
    </div>
  );
}

// ---- Comparison workspace ---------------------------------------------------
function ContrastCard({ c, onShow }: { c: Contrast; onShow: () => void }) {
  return (
    <Expand open summary={<div><div className="row"><Badge tone={c.allowed ? 'ok' : 'bad'}>{c.allowed ? 'Allowed contrast' : 'Not allowed'}</Badge><strong>{c.test_a}</strong> vs <strong>{c.test_b}</strong></div><div className="muted">{c.question}</div></div>}>
      <div className="grid three">
        <div><h4>Changed</h4>{c.changed_factors.length ? c.changed_factors.map((f) => <Badge key={f} tone="warn">{f}</Badge>) : <span className="dim small">none recorded</span>}</div>
        <div><h4>Shared</h4>{c.shared.length ? c.shared.map((f) => <Badge key={f} tone="ok">{f}</Badge>) : <span className="dim small">none recorded</span>}</div>
        <div><h4>Unknown</h4>{c.unknown.length ? c.unknown.map((f) => <Badge key={f}>{f}</Badge>) : <span className="dim small">none</span>}</div>
      </div>
      <p style={{ marginTop: 10 }}>{c.statement}</p>
      <p><button className="btn" onClick={() => { onShow(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Show these two in the table</button></p>
      <p className="small dim">Rules: {c.rule_ids.join(', ') || 'none'}. Two tests that differ in one recorded factor show an association only; unrecorded factors may also differ.</p>
    </Expand>
  );
}
const ROWS: [string, (t: TestRecord) => React.ReactNode, (t: TestRecord) => string][] = [
  ['Material', (t) => <Val x={t.material} />, (t) => fmt(t.material)],
  ['Phase', (t) => <Val x={t.phase} />, (t) => fmt(t.phase)],
  ['Shape', (t) => <Val x={t.geometry.shape} />, (t) => fmt(t.geometry.shape)],
  ['Thickness', (t) => <Sv v={t.geometry.thickness_mm} showKind={false} />, (t) => fmt(t.geometry.thickness_mm.value)],
  ['Diameter', (t) => <Sv v={t.geometry.diameter_mm} showKind={false} />, (t) => fmt(t.geometry.diameter_mm.value)],
  ['Substrate', (t) => <Val x={t.substrate_confinement} />, (t) => fmt(t.substrate_confinement)],
  ['O2 fraction', (t) => <Sv v={t.atmosphere.o2_fraction} showKind={false} />, (t) => fmt(t.atmosphere.o2_fraction.value)],
  ['Pressure', (t) => <Sv v={t.atmosphere.pressure_kpa} showKind={false} />, (t) => fmt(t.atmosphere.pressure_kpa.value)],
  ['Gravity', (t) => <>{pretty(t.gravity.regime)}{t.gravity.actual === false && <span className="dim small"> (simulated)</span>}</>, (t) => `${t.gravity.regime}${t.gravity.actual}`],
  ['Flow direction', (t) => <Sv v={t.flow.direction} showKind={false} />, (t) => fmt(t.flow.direction.value)],
  ['Flow velocity', (t) => <Sv v={t.flow.initial_velocity_cm_s} showKind={false} />, (t) => fmt(t.flow.initial_velocity_cm_s.value)],
  ['Flow history', (t) => <Val x={t.flow.history_kind && pretty(t.flow.history_kind)} />, (t) => fmt(t.flow.history_kind)],
  ['Record', (t) => <>{pretty(t.record_type)} · {t.observation_status}</>, (t) => t.record_type + t.observation_status],
  ['Events', (t) => (t.events.length ? t.events.map((e, i) => <div key={i} className="small">{pretty(e.kind)}{e.observed ? '' : ' (not observed)'}</div>) : <Val x={null} />), (t) => t.events.map((e) => e.kind).join()],
];
export function ConditionMatrix({ ids, index }: { ids: string[]; index: TestIndex }) {
  const cols = ids.map((id) => ({ id, rec: index.tests.get(id) })).filter((c) => c.rec);
  if (index.loading) return <Loading label="Loading test conditions" />;
  if (cols.length < 1) return <p className="muted">Test records are not available for these tests.</p>;
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>Condition</th>{cols.map((c) => <th key={c.id} title={c.rec!.test.series ?? ''}>{c.id}</th>)}</tr></thead>
      <tbody>{ROWS.map(([label, render, key]) => {
        const vals = cols.map((c) => key(c.rec!.test));
        const differs = new Set(vals).size > 1;
        return <tr key={label}><th scope="row" style={{ textTransform: 'none', letterSpacing: 0 }}>{label}{differs && <Badge tone="warn">differs</Badge>}</th>{cols.map((c) => <td key={c.id}>{render(c.rec!.test)}</td>)}</tr>;
      })}</tbody>
    </table></div>
  );
}
export function Compare() {
  const { review, index } = useReview();
  const [sel, setSel] = useState<string[]>(() => { const c = review.contrasts[0]; return c ? [c.test_a, c.test_b] : review.tests_considered.slice(0, 3).map((t) => t.test_id); });
  const tests = review.tests_considered;
  const toggle = (id: string) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id].slice(-6));
  return (
    <div className="stack">
      <section className="card"><h2>Conditions and events</h2>
        <p className="muted small">Pick up to six tests. Rows marked <em>differs</em> have different recorded values; "unknown" means the source does not record it, so a difference or similarity cannot be assumed.</p>
        <fieldset style={{ border: '1px solid var(--card-border)', borderRadius: 10, margin: '8px 0 14px' }}>
          <legend className="small muted">Tests to compare</legend>
          <div className="row">{tests.map((t) => <label key={t.test_id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontWeight: 500, color: 'var(--text)' }}><input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={sel.includes(t.test_id)} onChange={() => toggle(t.test_id)} />{t.test_id}</label>)}</div>
        </fieldset>
        <ConditionMatrix ids={sel} index={index} />
      </section>
      <h2>Contrasts</h2>
      {review.contrasts.length ? review.contrasts.map((c) => <ContrastCard key={c.id} c={c} onShow={() => setSel([c.test_a, c.test_b])} />) : <p className="muted">No contrasts were generated.</p>}
    </div>
  );
}

// ---- Design comparison ------------------------------------------------------
export function Design() {
  const { review, index } = useReview();
  const [q, setQ] = useState<ResearchQuery>(review.query);
  const [res, setRes] = useState<VariantResult | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const patch = (): Partial<QueryConfig> => {
    const out: Partial<QueryConfig> = {};
    for (const k of Object.keys(q.config) as (keyof QueryConfig)[]) if (q.config[k] !== review.query.config[k]) (out as Record<string, unknown>)[k] = q.config[k];
    return out;
  };
  const changed = Object.keys(patch());
  const submit = async () => {
    setBusy(true); setErr(null);
    try { setRes(await api.variant(review.id, patch())); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <section className="card">
        <h2>Change a parameter</h2>
        <p className="muted">Edit one configuration parameter and see which claims change. The baseline review is not modified.</p>
        <ConfigForm query={q} onChange={setQ} idPrefix="var" />
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={busy || !changed.length} onClick={submit}>{busy ? 'Recomputing…' : 'Compare variant'}</button>
          <button className="btn" onClick={() => { setQ(review.query); setRes(null); }}>Reset</button>
          <span className="small dim">{changed.length ? `Changed: ${changed.map(pretty).join(', ')}` : 'No parameter changed yet.'}</span>
        </div>
        {changed.length > 1 && <Disclaimer tone="warn">More than one parameter changed; the diff cannot attribute a conclusion change to a single parameter.</Disclaimer>}
      </section>
      <ErrorBanner error={err} />
      {res && (
        <section className="card fade-in">
          <h2>What changed</h2>
          {res.diff.length > 0 && <p className="muted" role="status">{res.diff.length} claim{res.diff.length === 1 ? '' : 's'} changed: {res.diff.filter((d) => !d.after).length} no longer apply, {res.diff.filter((d) => d.after).length} changed status.</p>}
          {res.diff.length === 0 ? <p className="muted">No claim changed for this variant.</p> : res.diff.map((d) => {
            const c = res.review.claims.find((x) => x.id === d.claim_id) ?? review.claims.find((x) => x.id === d.claim_id);
            return (
              <div className="diff" key={d.claim_id}>
                <div><span className="lab">Changed parameter</span><strong>{pretty(d.changed_parameter) || 'unknown'}</strong></div><div className="arrow" aria-hidden>→</div>
                <div><span className="lab">Affected basis</span>{d.reason || <Val x={null} />}<div className="small dim">claim {d.claim_id}{c ? `: ${c.text}` : ''}</div></div><div className="arrow" aria-hidden>→</div>
                <div><span className="lab">Changed conclusion</span><Badge>{pretty(d.before ?? 'none')}</Badge> to <Badge tone="info">{d.after ? pretty(d.after) : 'no longer applies'}</Badge></div>
              </div>);
          })}
          <p className="small dim">Variant {res.variant_id}. Differences are changes in what the cited evidence supports, not predictions of physical outcomes. <Link to={`/r/${encodeURIComponent(res.review.id)}`}>Open variant review</Link></p>
          <h3>Variant claims</h3>
          {res.review.claims.map((c) => <ClaimCard key={c.id} c={c} review={res.review} index={index} />)}
        </section>
      )}
    </div>
  );
}

// ---- Test programme ---------------------------------------------------------
export function Programme() {
  const { review } = useReview();
  const [budget, setBudget] = useState(8);
  const [must, setMust] = useState<Set<string>>(new Set());
  const [prog, setProg] = useState<TestProgramme | null>(review.programme);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr(null);
    try { setProg(await api.programme(review.id, budget, [...must])); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const qtext = (id: string) => review.open_questions.find((q) => q.id === id)?.text ?? id;
  return (
    <div className="stack">
      <section className="card">
        <h2>Plan a test programme</h2>
        <p className="muted">Given a run budget, choose controlled blocks that address your open questions. Every block has a control and at least two replicates.</p>
        <div style={{ maxWidth: 220 }}><Field id="budget" label="Budget (runs)"><input id="budget" type="number" min={1} step={1} value={budget} onChange={(e) => setBudget(Math.max(1, Math.floor(Number(e.target.value) || 1)))} /></Field></div>
        {review.open_questions.length > 0 && (
          <fieldset style={{ border: '1px solid var(--card-border)', borderRadius: 10, margin: '12px 0' }}>
            <legend className="small muted">Must cover (optional)</legend>
            {review.open_questions.map((q) => (
              <label key={q.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500, color: 'var(--text)' }}>
                <input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={must.has(q.id)} onChange={(e) => { const n = new Set(must); e.target.checked ? n.add(q.id) : n.delete(q.id); setMust(n); }} />{q.id}: {q.text}
              </label>))}
          </fieldset>)}
        <button className="btn primary" onClick={go} disabled={busy}>{busy ? 'Planning…' : 'Build programme'}</button>
      </section>
      <ErrorBanner error={err} />
      {prog && (
        <section className="card fade-in">
          <div className="row between"><h2 style={{ margin: 0 }}>Programme</h2><Badge tone="info" >{prog.method === 'exact' ? 'Exact optimum' : 'Greedy heuristic (not guaranteed optimal)'}</Badge></div>
          <p className="muted">Uses {prog.runs_used} of {prog.budget_runs} runs. {prog.note}</p>
          <div className="bar" role="img" aria-label={`${prog.runs_used} of ${prog.budget_runs} runs used`}><span style={{ width: `${Math.min(100, (prog.runs_used / Math.max(1, prog.budget_runs)) * 100)}%` }} /></div>
          <div className="grid two" style={{ marginTop: 14 }}>
            <div><h3>Selected / covered questions</h3><ul>{prog.covered.map((q) => <li key={q}><Badge tone="ok">covered</Badge> {qtext(q)}</li>)}{!prog.covered.length && <li className="muted">None</li>}</ul></div>
            <div><h3>Uncovered questions</h3><ul>{prog.uncovered.map((q) => <li key={q}><Badge tone="warn">uncovered</Badge> {qtext(q)}</li>)}{!prog.uncovered.length && <li className="muted">None</li>}</ul></div>
          </div>
          <p className="small dim">Coverage counts which open questions get a block. It does not estimate how much would be learned.</p>
          <h3>Blocks</h3>
          {prog.blocks.map((b) => (
            <Expand key={b.id} open summary={<span><strong>{pretty(b.endpoint)}</strong>: {qtext(b.question_id)} <Badge>{b.runs} runs</Badge></span>}>
              <KV rows={[['Target', <Val x={b.target} />], ['Control', <Val x={b.control} />], ['Held fixed', <Val x={b.fixed} />], ['Changed', <Val x={b.changed} />],
                ['Endpoint', pretty(b.endpoint)], ['Measurements', b.measurements.join(', ') || <Val x={null} />], ['Replicates', `${b.replicates} (${b.replicate_rationale || 'no rationale given'})`],
                ['Equipment', b.equipment.join(', ') || <Val x={null} />], ['Assumptions', b.assumptions.join('; ') || 'none stated']]} />
            </Expand>))}
        </section>)}
    </div>
  );
}

// ---- Export -----------------------------------------------------------------
const FORMATS: { f: ExportFormat; label: string; ext: string; type: string; note: string }[] = [
  { f: 'report', label: 'Report', ext: 'md', type: 'text/markdown', note: 'Readable Markdown report' },
  { f: 'json', label: 'JSON', ext: 'json', type: 'application/json', note: 'Complete review record' },
  { f: 'csv', label: 'CSV', ext: 'csv', type: 'text/csv', note: 'Flat table of tests' },
  { f: 'dataset', label: 'Dataset', ext: 'csv', type: 'text/csv', note: 'Units, roles, provenance, blanks and group IDs; will not merge incompatible endpoint families' },
];
function Revisions({ id }: { id: string }) {
  const r = useAsync(() => api.revisions(id), [id]);
  return (
    <section className="card"><h3>Revision history</h3>
      <Async r={r} label="Loading revisions">{(items) => items.length ? <ul>{items.map((x) => <li key={x.revision}>Revision {x.revision} · {x.created} · {x.reason}</li>)}</ul> : <p className="muted">No revisions recorded.</p>}</Async>
    </section>
  );
}
export function ExportPage() {
  const { review } = useReview();
  const [err, setErr] = useState<unknown>(null);
  const [preview, setPreview] = useState<{ f: string; text: string } | null>(null);
  const get = async (x: typeof FORMATS[number], save: boolean) => {
    setErr(null);
    try { const t = await api.exportText(review.id, x.f); if (save) download(`ember-${review.id}.${x.ext}`, t, x.type); else setPreview({ f: x.label, text: t }); } catch (e) { setErr(e); }
  };
  return (
    <div className="stack">
      <ErrorBanner error={err} />
      <div className="grid two">
        {FORMATS.map((x) => (
          <section className="card" key={x.f}>
            <h3>{x.label}</h3><p className="muted small">{x.note}</p>
            <div className="row">
              <a className="btn primary" href={api.exportUrl(review.id, x.f)} download={`ember-${review.id}.${x.ext}`} onClick={(e) => { if (import.meta.env.VITE_MOCK === '1') { e.preventDefault(); void get(x, true); } }}>Download</a>
              <button className="btn" onClick={() => get(x, false)}>Preview</button>
            </div>
          </section>))}
      </div>
      {preview && <section className="card"><h3>{preview.f} preview</h3><pre style={{ overflow: 'auto', maxHeight: 360, whiteSpace: 'pre-wrap' }} className="mono">{preview.text.slice(0, 8000)}</pre></section>}
      <Revisions id={review.id} />
      <p><Link to="/reviews">Reopen saved reviews</Link></p>
    </div>
  );
}

// ---- Data replay ------------------------------------------------------------
function ReplaySvg({ r }: { r: Replay }) {
  const segs = [...r.segments].sort((a, b) => a.order - b.order);
  const W = Math.max(520, segs.length * 130), H = 130;
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={W} height={H} role="img" aria-label="Ordered protocol steps. Spacing is by step order, not by elapsed time.">
        <line x1="30" y1="50" x2={W - 30} y2="50" stroke="var(--card-border)" strokeWidth="3" />
        {segs.map((s, i) => {
          const x = 30 + (i * (W - 60)) / Math.max(1, segs.length - 1);
          return (
            <g key={s.order}>
              <circle cx={x} cy="50" r="9" fill={s.time_s === null ? 'var(--text-3)' : 'var(--accent)'} />
              <text x={x} y="26" textAnchor="middle" style={{ fontWeight: 700 }}>{s.time_s === null ? 'time unknown' : `${s.time_s} s`}</text>
              <text x={x} y="78" textAnchor="middle">{pretty(s.kind)}</text>
              <text x={x} y="94" textAnchor="middle">{s.label.length > 22 ? s.label.slice(0, 21) + '…' : s.label}</text>
            </g>);
        })}
      </svg>
    </div>
  );
}
export function ReplayPage() {
  const { review } = useReview();
  const { id = '' } = useParams();
  const ids = review.tests_considered.map((t) => t.test_id);
  const [test, setTest] = useState(ids[0] ?? '');
  const r = useAsync(() => (test ? api.replay(id, test) : Promise.reject(new Error('No tests in this review.'))), [id, test]);
  return (
    <div className="stack">
      <Disclaimer><strong>Data replay, not a physics simulation.</strong> This view steps through recorded protocol steps and events. It does not compute flame behaviour.</Disclaimer>
      <div style={{ maxWidth: 280 }}><Field id="rt" label="Test"><select id="rt" value={test} onChange={(e) => setTest(e.target.value)}>{ids.map((i) => <option key={i}>{i}</option>)}</select></Field></div>
      {test ? <Async r={r} label="Loading replay">{(rp) => (
        <>
          <section className="card"><h3>Ordered steps</h3><ReplaySvg r={rp} /><p className="small dim">Positions follow step order; spacing does not represent elapsed time.</p></section>
          <section className="card"><h3>Events</h3><Timeline steps={[]} events={rp.events} /></section>
          <p className="small dim">{rp.disclaimer}</p>
        </>)}</Async> : <Loading label="No tests" />}
    </div>
  );
}
