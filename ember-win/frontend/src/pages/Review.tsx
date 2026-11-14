import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { ApplicabilityDecision, ClaimStatus, DecisionStatus, Review, ReviewClaim } from '../api/types';
import { Async, Badge, Conds, Disclaimer, Expand, KV, ModeBadge, VerificationBadge, Val, pct, pretty, useAsync } from '../components/ui';
import { useTestIndex, type TestIndex } from '../lib/testIndex';

export interface ReviewCtx { review: Review; reload: () => void; index: TestIndex }
export const useReview = () => useOutletContext<ReviewCtx>();

function ShellBody({ review, reload, base, tabs }: { review: Review; reload: () => void; base: string; tabs: [string, string][] }) {
  const index = useTestIndex(review);
  return (
    <>
      <div className="row between" style={{ marginBottom: 8 }}>
        <div className="row"><ModeBadge mode={review.mode} /><Badge>Revision {review.revision}</Badge>{review.parent_id && <Badge tone="info">Variant of <Link to={`/r/${encodeURIComponent(review.parent_id)}`}>{review.parent_id}</Link></Badge>}<span className="small dim">{review.created}</span></div>
      </div>
      <h1 style={{ fontSize: 'clamp(1.3rem,3.5vw,1.9rem)' }}>{review.query.question || 'Untitled review'}</h1>
      <nav className="tabs" aria-label="Review sections">
        {tabs.map(([p, l]) => <NavLink key={p} end to={p ? `${base}/${p}` : base} className={({ isActive }) => (isActive ? 'active' : '')}>{l}</NavLink>)}
      </nav>
      <Outlet context={{ review, reload, index } satisfies ReviewCtx} />
    </>
  );
}

export function ReviewShell() {
  const { id = '' } = useParams();
  const r = useAsync(() => api.review(id), [id]);
  const base = `/r/${encodeURIComponent(id)}`;
  const tabs: [string, string][] = [['', 'Overview'], ['insights', 'Fire-safety insights'], ['compare', 'Comparisons'], ['design', 'Design comparison'], ['programme', 'Test programme'], ['replay', 'Data replay'], ['export', 'Export']];
  return (
    <div>
      <Async r={r} label="Loading review">{(review) => <ShellBody review={review} reload={r.reload} base={base} tabs={tabs} />}</Async>
    </div>
  );
}

const CLAIM_TONE: Record<ClaimStatus, 'ok' | 'warn' | 'bad'> = { supported: 'ok', needs_new_comparison: 'warn', not_applicable: 'bad' };
const CLAIM_LABEL: Record<ClaimStatus, string> = { supported: 'Supported', needs_new_comparison: 'Needs new comparison', not_applicable: 'Not applicable' };
const DEC_TONE: Record<DecisionStatus, 'ok' | 'info' | 'bad' | 'warn'> = { direct: 'ok', limited_context: 'info', incompatible: 'bad', insufficient_data: 'warn' };
const TYPE_LABEL: Record<string, string> = { observation: 'Observation', source_interpretation: 'Source interpretation', derived_interpretation: 'Derived interpretation' };

export function DecisionList({ decisions }: { decisions: ApplicabilityDecision[] }) {
  return (
    <>{decisions.map((d) => (
      <div key={d.test_id} className="stack">
        <div className="row"><strong>{d.test_id}</strong><Badge tone={DEC_TONE[d.status]}>{pretty(d.status)}</Badge><span className="small dim">rules {d.rule_version || 'unversioned'}</span></div>
        <ul className="small">{d.grounds.map((g) => (
          <li key={g.rule_id + g.field}><Badge tone={g.effect === 'pass' ? 'ok' : g.effect === 'fail' ? 'bad' : ''}>{g.effect}</Badge> <code>{g.rule_id}</code> {g.field && <span className="dim">({g.field})</span>} {g.text}</li>
        ))}</ul>
        {d.unknown_fields.length > 0 && <p className="small muted">Unknown fields: {d.unknown_fields.map((f) => <Badge key={f}>{f}</Badge>)}</p>}
      </div>
    ))}</>
  );
}

export function ClaimCard({ c, review, index }: { c: ReviewClaim; review: Review; index?: TestIndex }) {
  const decisions = review.tests_considered.filter((t) => c.evidence.includes(t.test_id)).flatMap((t) => t.decisions);
  return (
    <Expand summary={
      <div style={{ flex: 1 }}>
        <div className="row" style={{ marginBottom: 4 }}>
          <Badge tone={CLAIM_TONE[c.status]}>{CLAIM_LABEL[c.status]}</Badge>
          <Badge>{TYPE_LABEL[c.type] ?? pretty(c.type)}</Badge>
        </div>
        <span>{c.text}</span>
      </div>}>
      <p className="muted"><strong>Why: </strong><Val x={c.why} what="reason" /></p>
      <h4>Conditions</h4>
      {Object.keys(c.conditions).length ? <p><Conds c={c.conditions} /></p> : <p className="muted small">No conditions recorded.</p>}
      {c.depends_on_fields.length > 0 && <p className="small muted">Depends on: {c.depends_on_fields.map((f) => <Badge key={f}>{pretty(f)}</Badge>)} <span className="dim">(changing these in a variant recomputes this claim)</span></p>}
      <h4>Source evidence</h4>
      <p className="small">{c.evidence.length ? c.evidence.map((e) => { const t = index?.tests.get(e); return t ? <Link key={e} className="badge" to={`/investigations/${encodeURIComponent(t.inv.id)}/protocol?test=${encodeURIComponent(e)}`} title={t.test.series ?? undefined}>{e}</Link> : <Badge key={e}>{e}</Badge>; }) : <Val x={null} what="evidence" />}</p>
      <h4>Rules applied</h4>
      <p className="small">{c.rule_ids.length ? c.rule_ids.map((r) => <Badge key={r}>{r}</Badge>) : 'none recorded'}</p>
      {decisions.length > 0 && <><h4>Applicability of evidence</h4><DecisionList decisions={decisions} /></>}
    </Expand>
  );
}

export function Overview() {
  const { review, index } = useReview();
  const ex = review.explanation;
  const supported = review.claims.filter((c) => c.status === 'supported').length;
  return (
    <div className="stack">
      {review.warnings.map((w) => <Disclaimer key={w} tone="warn">{w}</Disclaimer>)}
      <section className="card">
        <h2>Summary</h2>
        {ex ? <><p><strong>{ex.summary}</strong></p>{ex.paragraphs.map((t, i) => <p key={i}>{t}</p>)}{ex.warnings.map((w) => <Disclaimer key={w} tone="warn">{w}</Disclaimer>)}</> : <p>No explanation text was returned.</p>}
        <p className="small dim">Generated: <Val x={review.manifest.generator} />{ex?.model ? ` (${ex.model})` : ''} · {review.mode === 'live_ai' ? 'AI-written from the evidence package' : review.mode === 'saved_example' ? 'stored example' : 'built by rules, no AI model'}</p>
        <KV rows={[
          ['Environment', <Val x={review.query.environment && pretty(review.query.environment)} />], ['Endpoint', <Val x={review.query.endpoint && pretty(review.query.endpoint)} />],
          ['Material', <Val x={review.query.config.material} />], ['O2 fraction', <Val x={review.query.config.o2_fraction} />],
          ['Gravity', <Val x={review.query.config.gravity_regime} />], ['Flow', <Val x={review.query.config.flow_direction} />],
        ]} />
      </section>
      <section>
        <h2>Claims <span className="small dim">({supported} of {review.claims.length} supported for this configuration)</span></h2>
        {review.claims.length ? review.claims.map((c) => <ClaimCard key={c.id} c={c} review={review} index={index} />) : <p className="muted">No claims produced.</p>}
      </section>
      <section className="card">
        <h2>Ranked investigations</h2>
        <p className="small muted">Three separate judgements: <strong>relevance</strong> to the question, <strong>applicability</strong> to your configuration, and <strong>evidence quality</strong>. They are not combined into one score.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>Investigation</th><th>Relevance</th><th>Applicability</th><th>Evidence quality</th><th>Record</th></tr></thead>
          <tbody>{review.ranking.map((r) => (
            <tr key={r.investigation_id}>
              <td><Link to={`/investigations/${encodeURIComponent(r.investigation_id)}`}>{index.invs.get(r.investigation_id)?.name ?? r.investigation_id}</Link><div className="small dim">{r.why}</div></td>
              <td style={{ minWidth: 110 }}><div className="meter" style={{ gridTemplateColumns: '1fr 40px' }}><div className="bar"><span style={{ width: pct(Math.min(1, r.relevance)) }} /></div>{pct(r.relevance)}</div></td>
              <td className="small">{Object.entries(r.applicability_summary).map(([k, n]) => <div key={k}><Badge tone={DEC_TONE[k as DecisionStatus] ?? ''}>{pretty(k)}</Badge> {n}</div>)}</td>
              <td className="small"><Badge tone={r.quality.level === 'high' ? 'ok' : r.quality.level === 'low' ? 'warn' : 'info'}>{r.quality.level} quality</Badge><div className="dim">{r.quality.factors.join('; ') || r.quality.note}</div></td>
              <td><VerificationBadge v={r.quality.verification} /></td>
            </tr>))}</tbody>
        </table></div>
      </section>
      <section className="card">
        <h2>Tests considered</h2>
        {review.tests_considered.map((t) => (
          <Expand key={t.test_id} summary={<span><strong>{t.test_id}</strong> <span className="dim small">endpoint: {t.endpoint_support || 'unknown'}</span> {t.decisions.map((d) => <Badge key={d.test_id + d.status} tone={DEC_TONE[d.status]}>{pretty(d.status)}</Badge>)}</span>}>
            <DecisionList decisions={t.decisions} />
          </Expand>))}
      </section>
      <div className="grid two">
        <section className="card"><h2>Limitations</h2><ul>{review.limitations.map((l) => <li key={l}>{l}</li>)}{!review.limitations.length && <li className="muted">None listed (this does not mean none exist).</li>}</ul></section>
        <section className="card"><h2>Open questions</h2><ul>{review.open_questions.map((q) => <li key={q.id}><Badge>{pretty(q.kind)}</Badge> {q.text}{q.field && <span className="dim small"> ({q.field})</span>}</li>)}{!review.open_questions.length && <li className="muted">None.</li>}</ul>
          {review.conflicts.length > 0 && <Disclaimer tone="warn">{review.conflicts.length} conflict(s) between sources were reported.</Disclaimer>}</section>
      </div>
      <section className="card"><h3>Provenance</h3>
        <KV rows={Object.entries(review.manifest).map(([k, v]) => [k, <span className="mono"><Val x={v} /></span>])} />
      </section>
    </div>
  );
}
