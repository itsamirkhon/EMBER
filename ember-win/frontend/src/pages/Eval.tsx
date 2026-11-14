import { Fragment, useState } from 'react';
import { api } from '../api/client';
import type { EvalSummary } from '../api/types';
import { Async, Badge, Disclaimer, Expand, Field, Val, useAsync } from '../components/ui';

const NOT_MEASURED = 'not measured';

/** Renders any evaluation value; anything absent, null or flagged not_measured reads "not measured". */
export function EvalValue({ v }: { v: unknown }) {
  if (v === null || v === undefined || v === 'not_measured' || v === '') return <span className="unknown-val">{NOT_MEASURED}</span>;
  if (typeof v === 'number') return <>{Number.isInteger(v) ? v : v.toFixed(3)}</>;
  if (typeof v === 'string' || typeof v === 'boolean') return <>{String(v)}</>;
  if (Array.isArray(v)) return <>{v.map((x, i) => <div key={i}><EvalValue v={x} /></div>)}</>;
  const o = v as Record<string, unknown>;
  if (o.status === 'not_measured') return <span className="unknown-val">{NOT_MEASURED}</span>;
  return <dl className="kv">{Object.entries(o).map(([k, x]) => <Fragment key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd><EvalValue v={x} /></dd></Fragment>)}</dl>;
}

const SECTIONS = ['retrieval', 'applicability', 'endpoint_support', 'contrast', 'variant', 'false_premise'];
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

function SectionTable({ name, data, split }: { name: string; data: Rec; split: string }) {
  const bySystem = isRec(data[split]) ? (data[split] as Rec) : {};
  const systems = Object.keys(bySystem);
  const cols = [...new Set(systems.flatMap((s) => (isRec(bySystem[s]) ? Object.entries(bySystem[s] as Rec).filter(([, v]) => typeof v === 'number').map(([k]) => k) : [])))];
  if (!systems.length) return null;
  return (
    <section className="card"><h2>{name.replace(/_/g, ' ')}</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>System</th>{cols.map((c) => <th key={c}>{c.replace(/_/g, ' ')}</th>)}</tr></thead>
        <tbody>{systems.map((s) => {
          const v = bySystem[s];
          return <tr key={s}><td><strong>{s}</strong></td>{isRec(v) ? cols.map((c) => <td key={c}><EvalValue v={v[c]} /></td>) : <td colSpan={Math.max(1, cols.length)}><EvalValue v={v} /></td>}</tr>;
        })}</tbody>
      </table></div>
      {systems.map((s) => { const v = bySystem[s]; return isRec(v) && (isRec(v.per_class) || isRec(v.confusion)) ? <Expand key={s} summary={<span>Detail for system {s}</span>}><EvalValue v={{ per_class: v.per_class, confusion: v.confusion }} /></Expand> : null; })}
    </section>
  );
}

export function EvalBody({ d }: { d: EvalSummary }) {
  const [split, setSplit] = useState('all');
  const { status, ...rest } = d;
  const metrics = Array.isArray(rest.metrics) ? (rest.metrics as Rec[]) : [];
  const systems = isRec(rest.systems) ? (rest.systems as Rec) : null;
  const gold = isRec(rest.gold) ? (rest.gold as Rec) : null;
  const caveats = Array.isArray(rest.caveats) ? (rest.caveats as unknown[]).map(String) : [];
  const sections = SECTIONS.filter((k) => isRec(rest[k]));
  return (
    <div className="stack">
      <Disclaimer tone="warn"><strong>Preliminary team evaluation.</strong> {typeof rest.label === 'string' ? <>The backend labels this: "{rest.label}". </> : null}Results come from the project team's own checks on a small corpus. They are not an independent benchmark and do not establish accuracy in general.</Disclaimer>
      <div className="row"><Badge tone={status === 'measured' ? 'ok' : 'warn'}>{status === 'measured' ? 'Measured' : 'Not measured'}</Badge>{typeof rest.generated === 'string' && <span className="small dim">generated {rest.generated}</span>}
        {gold && <span className="small dim">{String(gold.n_cases)} gold cases</span>}</div>
      {status === 'not_measured' && <p className="muted">No evaluation has been measured yet. Cells below read "{NOT_MEASURED}" rather than a number.</p>}
      {caveats.length > 0 && <section className="card"><h2>Caveats</h2><ul>{caveats.map((c, i) => <li key={i}>{c}</li>)}</ul></section>}
      {systems && <section className="card"><h2>Systems compared</h2><KVList o={systems} /></section>}
      {sections.length > 0 && (
        <div style={{ maxWidth: 240 }}><Field id="split" label="Case split"><select id="split" value={split} onChange={(e) => setSplit(e.target.value)}>{['all', 'dev', 'validation', 'test'].map((x) => <option key={x}>{x}</option>)}</select></Field></div>)}
      {sections.map((k) => <SectionTable key={k} name={k} data={rest[k] as Rec} split={split} />)}
      {metrics.length > 0 && (
        <section className="card"><h2>Metrics</h2>
          <div className="table-wrap"><table><thead><tr><th>Metric</th><th>Value</th></tr></thead>
            <tbody>{metrics.map((m, i) => (
              <tr key={i}><td>{String(m.name ?? m.id ?? `metric ${i + 1}`)}</td>
                <td>{m.status === 'not_measured' || m.value === undefined || m.value === null ? <span className="unknown-val">{NOT_MEASURED}</span> : <EvalValue v={m.value} />}</td></tr>))}</tbody></table></div>
        </section>)}
      {gold && <Expand summary={<strong>Gold set composition</strong>}><EvalValue v={gold} /></Expand>}
      {Array.isArray(rest.failures_D) && <p className="small muted">Failures of the full engine on gold cases: {(rest.failures_D as unknown[]).length === 0 ? 'none recorded' : (rest.failures_D as unknown[]).length}.</p>}
    </div>
  );
}
function KVList({ o }: { o: Rec }) {
  return <dl className="kv">{Object.entries(o).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment>)}</dl>;
}

export function EvalPage() {
  const ev = useAsync(() => api.evalSummary(), []);
  const meta = useAsync(() => api.meta(), []);
  const rules = useAsync(() => api.rules(), []);
  return (
    <div className="stack">
      <h1>Evaluation and coverage</h1>
      <Async r={ev} label="Loading evaluation">{(d) => <EvalBody d={d} />}</Async>
      <Async r={rules} label="Loading rules">{(d) => (
        <section className="card"><h2>Rules ({d.rules_version})</h2>
          <p className="small muted">Applicability rules the engine applies. Rules marked heuristic are judgement calls, not established science.</p>
          {d.rules.map((r) => <Expand key={r.id} summary={<span><code>{r.id}</code> {r.title} <Badge tone={r.severity === 'gate' ? 'bad' : ''}>{r.severity}</Badge>{r.heuristic && <Badge tone="warn">heuristic</Badge>}</span>}><p className="muted">{r.description}</p></Expand>)}
        </section>)}</Async>
      <Async r={meta} label="Loading coverage">{(m) => (
        <section className="card"><h2>Corpus coverage</h2>
          <div className="grid two">
            <div><h3>Deep extraction ({m.coverage.deep.length})</h3><p className="small muted">Tests, protocol steps and events extracted.</p>{m.coverage.deep.map((i) => <Badge key={i} tone="ok">{i}</Badge>)}{!m.coverage.deep.length && <Val x={null} />}</div>
            <div><h3>Catalog only ({m.coverage.catalog.length})</h3><p className="small muted">Metadata and text only; no structured tests.</p>{m.coverage.catalog.map((i) => <Badge key={i}>{i}</Badge>)}</div>
          </div>
          <p className="small dim" style={{ marginTop: 10 }}>Optional branches: JEV {m.flags.jev ? 'on' : 'off'}, dense retrieval {m.flags.dense ? 'on' : 'off'}, live AI {m.flags.live_ai ? 'on' : 'off'}.</p>
        </section>)}</Async>
    </div>
  );
}
