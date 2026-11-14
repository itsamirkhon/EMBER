import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, type Filters } from '../api/client';
import type { InvestigationFull, SourceRef, SummaryEntry } from '../api/types';
import { Timeline } from '../components/Timeline';
import { Async, Badge, Conds, Expand, Field, KV, Quote, Sv, Unknown, Val, VerificationBadge, pretty, useAsync } from '../components/ui';

function uniq(xs: string[]) { return [...new Set(xs)].sort(); }

export function Explorer() {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [f, setF] = useState<Omit<Filters, 'q'>>({});
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  const all = useAsync(() => api.investigations(), []);
  const res = useAsync(() => api.investigations({ ...f, q: dq }), [dq, f.topic, f.material, f.platform, f.family]);
  const opts = (k: 'materials' | 'families') => uniq((all.data?.items ?? []).flatMap((i) => i[k]));
  const platforms = uniq((all.data?.items ?? []).map((i) => i.platform).filter(Boolean));
  const sel = (id: string, label: string, key: keyof typeof f, options: string[]) => (
    <Field id={id} label={label}>
      <select id={id} value={f[key] ?? ''} onChange={(e) => setF({ ...f, [key]: e.target.value || undefined })}>
        <option value="">Any</option>{options.map((o) => <option key={o} value={o}>{pretty(o)}</option>)}
      </select>
    </Field>);
  return (
    <div className="stack">
      <h1>Experiment explorer</h1>
      <section className="card">
        <div className="fields">
          <Field id="search" label="Search"><input id="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. PMMA flame spread" /></Field>
          {sel('f-topic', 'Topic', 'topic', ['prevention', 'detection', 'suppression'])}
          {sel('f-mat', 'Material', 'material', opts('materials'))}
          {sel('f-plat', 'Platform', 'platform', platforms)}
          {sel('f-fam', 'Family', 'family', opts('families'))}
        </div>
      </section>
      <Async r={res} label="Searching">{(d) => (
        <>
          <p className="muted" role="status">{d.items.length} investigation{d.items.length === 1 ? '' : 's'}{dq ? ` for "${dq}"` : ''}</p>
          <div className="grid two">
            {d.items.map((i) => (
              <article className="card" key={i.id}>
                <div className="row"><VerificationBadge v={i.verification} /><Badge tone={i.coverage === 'deep' ? 'ok' : ''}>{i.coverage === 'deep' ? 'Deep extraction' : 'Catalog only'}</Badge><Badge tone="info">{i.status}</Badge></div>
                <h3 style={{ marginTop: 8 }}><Link to={`/investigations/${encodeURIComponent(i.id)}`}>{i.name}</Link></h3>
                <p className="muted small">{i.summary_goal}</p>
                <p className="small">{i.materials.map((m) => <Badge key={m}>{m}</Badge>)} {i.topics.map((m) => <Badge key={m} tone="accent">{m}</Badge>)} <Badge>{i.platform || 'platform unknown'}</Badge></p>
                <dl className="kv small">
                  <dt>Search relevance</dt><dd>{dq ? i.score.toFixed(2) : <span className="dim">no query</span>}{dq && i.why ? <span className="dim"> · {i.why}</span> : null}</dd>
                  <dt>Applicability</dt><dd><span className="dim">depends on your configuration: run a review</span></dd>
                  <dt>Evidence quality</dt><dd>{i.coverage === 'deep' ? `Deep extraction, ${i.n_tests} test records` : 'Catalog only: no structured tests'}; <VerificationBadge v={i.verification} /></dd>
                </dl>
              </article>))}
          </div>
          {!d.items.length && <p className="muted">Nothing matches. Clear a filter or change the search.</p>}
        </>)}</Async>
    </div>
  );
}

const STATUS_NOTE: Record<string, string> = { planned: 'Planned: describes tests that were proposed. No observed results.', observed: 'Observed: results were recorded.', mixed: 'Mixed: some tests planned, some observed.' };

function TestGeometry({ inv }: { inv: InvestigationFull }) {
  if (!inv.test_records.length) return <p className="muted">No structured tests extracted (catalog-level record).</p>;
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>Test</th><th>Material</th><th>Shape</th><th>Thickness</th><th>O2 fraction</th><th>Pressure</th><th>Gravity</th><th>Flow</th><th>Status</th></tr></thead>
      <tbody>{inv.test_records.map((t) => (
        <tr key={t.id}><td><Link to={`/investigations/${encodeURIComponent(inv.id)}/protocol?test=${encodeURIComponent(t.id)}`} title={t.series ?? ''}>{t.id}</Link><div className="small dim">{t.series}</div></td><td><Val x={t.material} /></td><td><Val x={t.geometry.shape && pretty(t.geometry.shape)} /></td><td><Sv v={t.geometry.thickness_mm} /></td>
          <td><Sv v={t.atmosphere.o2_fraction} /></td><td><Sv v={t.atmosphere.pressure_kpa} /></td>
          <td>{pretty(t.gravity.regime)} {t.gravity.actual === false ? <span className="dim small">(simulated)</span> : t.gravity.actual === null ? <span className="dim small">(actual? unknown)</span> : ''}</td>
          <td><Sv v={t.flow.direction} showKind={false} /> <Sv v={t.flow.initial_velocity_cm_s} showKind={false} /></td>
          <td><Badge tone={t.observation_status === 'planned' ? 'warn' : 'ok'}>{t.observation_status}</Badge></td></tr>))}</tbody>
    </table></div>
  );
}

function Entry({ e }: { e: SummaryEntry }) {
  if (!e.items.length && !e.text) return <Unknown />;
  return <>{e.items.length > 1 ? <ul>{e.items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p>{e.items[0] ?? e.text}</p>}<p className="small dim"><VerificationBadge v={e.verification} /> {e.source_refs.map((r) => r.source_id).filter((x, i, a) => a.indexOf(x) === i).join(', ')}</p></>;
}

export function InvestigationPage() {
  const { id = '' } = useParams();
  const r = useAsync(() => api.investigation(id), [id]);
  return (
    <Async r={r} label="Loading investigation">{(inv) => {
      const s = inv.summary;
      const testRefs = inv.test_records.flatMap((t) => [...t.protocol.map((p) => p.source_ref), ...t.events.map((x) => x.source_ref)]).filter((x): x is SourceRef => !!x && !!x.quote);
      const refs = [...testRefs, ...Object.values(s).flatMap((x) => x.source_refs), ...inv.sources]
        .filter((x, i, a) => a.findIndex((y) => y.source_id === x.source_id && y.locator === x.locator && y.quote === x.quote) === i).slice(0, 12);
      const numeric = s.conditions_range.extra.numeric as Record<string, unknown> | undefined;
      return (
        <div className="stack">
          <p><Link to="/explore">← Experiments</Link></p>
          <div className="row"><VerificationBadge v={inv.verification} /><Badge tone="info">{inv.status}</Badge><Badge>{inv.coverage === 'deep' ? 'Deep extraction' : 'Catalog only'}</Badge></div>
          <h1 style={{ fontSize: 'clamp(1.4rem,4vw,2rem)' }}>{inv.name}</h1>
          <div className="banner info"><strong>Planned vs observed</strong>{STATUS_NOTE[inv.status] ?? `Status: ${inv.status}`}</div>
          <div className="grid two">
            <section className="card"><h2>Goal</h2><Entry e={s.goal} /><h2>Method</h2><Entry e={s.method} /></section>
            <section className="card"><h2>Materials</h2><Entry e={s.materials} /><h2>Platform and families</h2><p>{inv.platform || <Unknown />} {inv.families.map((f) => <Badge key={f}>{f}</Badge>)}</p></section>
            <section className="card"><h2>Condition ranges</h2>{!numeric && <Entry e={s.conditions_range} />}
              {numeric && <KV rows={Object.entries(numeric).map(([k, v]) => [pretty(k), <Val x={v} />])} />}
              {s.conditions_range.extra.note ? <p className="small dim">{String(s.conditions_range.extra.note)}</p> : null}</section>
            <section className="card"><h2>Measurements</h2><Entry e={s.measurements} /></section>
          </div>
          <section className="card"><h2>Results {inv.status === 'planned' && <Badge tone="warn">planned: no observed results</Badge>}</h2><Entry e={s.key_results} /></section>
          <section className="card"><h2>Materials and geometry by test</h2><TestGeometry inv={inv} />
            {inv.test_records.length > 0 && <p style={{ marginTop: 12 }}><Link className="btn primary" to={`/investigations/${encodeURIComponent(inv.id)}/protocol`}>View protocol and events</Link></p>}</section>
          <section className="card"><h2>Limitations</h2><Entry e={s.limitations} />{inv.limitations.length > 0 && <ul>{inv.limitations.map((l) => <li key={l}>{l}</li>)}</ul>}</section>
          {inv.claims.length > 0 && <section className="card"><h2>Recorded claims</h2>{inv.claims.map((c) => (
            <Expand key={c.id} summary={<span><Badge>{pretty(c.type)}</Badge> {c.text}</span>}>
              <p><Conds c={c.conditions} /></p>{c.limitations.length > 0 && <ul className="small">{c.limitations.map((l) => <li key={l}>{l}</li>)}</ul>}
              <p className="small">Evidence: {c.evidence.map((e) => <Link key={e} className="badge" to={`/investigations/${encodeURIComponent(inv.id)}/protocol?test=${encodeURIComponent(e)}`}>{e}</Link>)} <VerificationBadge v={c.verification} /></p>
            </Expand>))}</section>}
          <section className="card"><h2>Source fragments</h2>
            {refs.length ? refs.map((x) => <Quote key={x.source_id + x.locator + x.quote} s={x} />) : <Unknown />}
            {inv.text_chunks.map((c) => <Expand key={c.id} summary={<span>Text chunk: {c.section || c.id}</span>}><p className="muted">{c.text}</p></Expand>)}
          </section>
        </div>);
    }}</Async>
  );
}

export function ProtocolPage() {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const r = useAsync(() => api.investigation(id), [id]);
  return (
    <Async r={r} label="Loading protocol">{(inv) => {
      const tid = sp.get('test') ?? inv.test_records[0]?.id;
      const t = inv.test_records.find((x) => x.id === tid);
      return (
        <div className="stack">
          <p><Link to={`/investigations/${encodeURIComponent(id)}`}>← {inv.name}</Link></p>
          <h1 style={{ fontSize: 'clamp(1.4rem,4vw,2rem)' }}>Protocol view</h1>
          {!t ? <p className="muted">This investigation has no structured tests.</p> : (
            <>
              <div style={{ maxWidth: 280 }}><Field id="ptest" label="Test"><select id="ptest" value={t.id} onChange={(e) => setSp({ test: e.target.value })}>{inv.test_records.map((x) => <option key={x.id} value={x.id}>{x.id}</option>)}</select></Field></div>
              <section className="card">
                <KV rows={[['Material', t.material], ['Atmosphere', <><Sv v={t.atmosphere.o2_fraction} /> O2, <Sv v={t.atmosphere.pressure_kpa} /></>], ['Gravity', `${pretty(t.gravity.regime)} (${t.gravity.platform ?? 'platform unknown'})`], ['Flow history', <Val x={t.flow.history_summary} />], ['Record', <>{pretty(t.record_type)} · {t.observation_status}{t.curation_note ? ` · ${t.curation_note}` : ''}</>]]} />
                <h2>Steps and events</h2>
                <p className="small muted">Time is shown only where the source records it.</p>
                <Timeline steps={t.protocol} events={t.events} />
              </section>
              <section className="card"><h2>Measurements</h2>
                {t.measurements.length ? <ul>{t.measurements.map((m) => <li key={m.name}>{m.name}{m.unit ? ` (${m.unit})` : ''}: <Badge>{m.kind === 'unknown' ? 'kind unknown' : m.kind}</Badge> <span className="muted small">{m.description}</span> <span className="dim small">values are not stored in the corpus</span></li>)}</ul> : <Unknown />}</section>
            </>)}
        </div>);
    }}</Async>
  );
}
