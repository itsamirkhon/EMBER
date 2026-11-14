import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { ParsedQuery, ResearchQuery, RunStatus } from '../api/types';
import { ConfigForm, emptyQuery } from '../components/ConfigForm';
import { Badge, Disclaimer, ErrorBanner, Field, pretty } from '../components/ui';

const EXAMPLE = 'Does thin PMMA sustain flame spread in an oxygen-enriched habitat, and what happens when the flow is reduced?';

export function ReviewNew() {
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedQuery | null>(null);
  const [query, setQuery] = useState<ResearchQuery>(emptyQuery());
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'parse' | 'run' | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [run, setRun] = useState<RunStatus | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const doParse = async () => {
    setBusy('parse'); setErr(null);
    try { const p = await api.parseQuery({ text }); setParsed(p); setQuery({ ...p.query, question: p.query.question || text }); setConfirmed(new Set()); }
    catch (e) { setErr(e); } finally { setBusy(null); }
  };
  const needConfirm = parsed?.confirm ?? [];
  const allConfirmed = needConfirm.every((f) => confirmed.has(f));

  const doRun = async () => {
    setBusy('run'); setErr(null); setRun(null);
    try {
      const key = crypto.randomUUID?.() ?? String(Date.now());
      const created = await api.createReview(query, key);
      for (let i = 0; i < 240 && alive.current; i++) {
        const st = await api.run(created.run_id);
        setRun(st);
        if (st.status === 'done') { nav(`/r/${encodeURIComponent(st.review_id ?? created.review_id)}`); return; }
        if (st.status === 'error') throw new Error(st.error ?? 'The review run failed.');
        await new Promise((r) => setTimeout(r, 700));
      }
    } catch (e) { setErr(e); setBusy(null); }
  };

  return (
    <div className="stack">
      <h1>Review workspace</h1>
      <section className="card">
        <h2>1 · Ask a question</h2>
        <Field id="q" label="Research question" hint="Describe the configuration in your own words. EMBER proposes a structured query you then confirm.">
          <textarea id="q" value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} />
        </Field>
        <div className="row">
          <button className="btn primary" onClick={doParse} disabled={busy !== null || text.trim().length < 3}>{busy === 'parse' ? 'Parsing…' : 'Parse question'}</button>
          <button className="btn" onClick={() => setText(EXAMPLE)}>Use example</button>
          <button className="btn" onClick={() => { setParsed({ query: emptyQuery(text), missing: [], confirm: [] }); setQuery(emptyQuery(text)); setConfirmed(new Set()); }}>Fill in manually</button>
        </div>
      </section>
      <ErrorBanner error={err} />
      {parsed && (
        <section className="card fade-in">
          <h2>2 · Confirm the parsed query</h2>
          <Disclaimer>Blank fields are <strong>unknown</strong>. EMBER will not fill them with defaults; claims that depend on an unknown field are marked accordingly.</Disclaimer>
          <Field id="qq" label="Question"><input id="qq" value={query.question} onChange={(e) => setQuery({ ...query, question: e.target.value })} /></Field>
          <div style={{ height: 12 }} />
          <ConfigForm query={query} onChange={setQuery} />
          {parsed.missing.length > 0 && (
            <p className="small muted" style={{ marginTop: 12 }}>Unknown after parsing: {parsed.missing.map((m) => <Badge key={m}>{pretty(m)}</Badge>)} </p>
          )}
          {needConfirm.length > 0 && (
            <fieldset style={{ border: '1px solid var(--card-border)', borderRadius: 10, marginTop: 12 }}>
              <legend className="small muted">Please confirm what the parser assumed</legend>
              {needConfirm.map((f) => (
                <label key={f} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500, color: 'var(--text)' }}>
                  <input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={confirmed.has(f)}
                    onChange={(e) => { const n = new Set(confirmed); e.target.checked ? n.add(f) : n.delete(f); setConfirmed(n); }} />
                  I confirm <strong>{pretty(f)}</strong>: {String(((query.config as unknown as Record<string, unknown>)[f] ?? (query as unknown as Record<string, unknown>)[f]) ?? 'unknown')}
                </label>
              ))}
            </fieldset>
          )}
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn primary" onClick={doRun} disabled={busy !== null || !allConfirmed || !query.question.trim()}>{busy === 'run' ? 'Running…' : 'Run review'}</button>
            {!allConfirmed && <span className="small dim">Confirm the items above to continue.</span>}
          </div>
          {run && (
            <p role="status" aria-live="polite" className="muted" style={{ marginTop: 12 }}>
              <span className="spinner" aria-hidden /> Run {run.status}{run.stage ? `: ${run.stage}` : ''}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
