import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../data/context';
import { buildDocs, buildIndex, search, supportingHits, type Hit } from '../lib/retrieval';
import { LLM_MODEL, NO_EVIDENCE, parseCitations } from '../lib/citations';
import { PageHead } from '../components/ui';

const EXAMPLES = [
  'At what oxygen level do thin solid materials stop burning in microgravity?',
  'How much CO2 is needed to extinguish a droplet flame?',
  'Are smoke particles in microgravity different from ground smoke?',
  'Does ventilation flow make flames easier or harder to extinguish?',
  'What happens to flammability at reduced pressure with more oxygen?',
];

const KEY_STORE = 'ember.anthropicKey';

function readKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORE) ?? '';
  } catch {
    return '';
  }
}

function HitView({ h }: { h: Hit }) {
  const d = h.doc;
  return (
    <div className="claim">
      <div>
        {d.kind === 'card' ? <em>Investigation card: </em> : null}
        {d.kind === 'card' ? d.quote ?? d.text : d.text}{' '}
        {d.sourceUrl ? (
          <a className="cite" href={d.sourceUrl} target="_blank" rel="noreferrer" title={d.sourceId ?? undefined}>
            {d.id}
          </a>
        ) : (
          <span className="cite">{d.id}</span>
        )}
      </div>
      {d.kind === 'claim' && d.quote && <blockquote>“{d.quote}”</blockquote>}
      <div className="small muted">
        {d.inv && (
          <>
            <Link to={`/investigations/${encodeURIComponent(d.inv)}`}>{d.inv}</Link> ·{' '}
          </>
        )}
        source {d.sourceId ?? 'n/a'} · match score {h.score.toFixed(2)} ({h.matched.join(', ')})
      </div>
    </div>
  );
}

export default function Ask() {
  const { claims, investigations } = useData();
  const index = useMemo(() => buildIndex(buildDocs(claims, investigations)), [claims, investigations]);
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState('');
  const [key, setKey] = useState(readKey);
  const [remember, setRemember] = useState(() => readKey() !== '');
  const [llmText, setLlmText] = useState('');
  const [llmState, setLlmState] = useState<'idle' | 'running' | 'done' | 'error' | 'refused'>('idle');
  const [llmError, setLlmError] = useState('');

  const hits = useMemo(() => (asked ? search(index, asked, 10) : []), [index, asked]);
  const support = useMemo(() => supportingHits(hits, asked), [hits, asked]);
  const allowed = useMemo(() => new Set(support.map((h) => h.doc.id)), [support]);

  function submit(e?: FormEvent, q = question) {
    e?.preventDefault();
    setAsked(q.trim());
    setLlmText('');
    setLlmState('idle');
  }

  function saveKey(k: string, rem: boolean) {
    setKey(k);
    try {
      if (rem && k) sessionStorage.setItem(KEY_STORE, k);
      else sessionStorage.removeItem(KEY_STORE);
    } catch {
      /* storage unavailable: key stays in memory only */
    }
  }

  async function runLlm() {
    if (!key || !support.length) return;
    setLlmText('');
    setLlmError('');
    setLlmState('running');
    const { synthesize, describeError } = await import('../lib/llm');
    try {
      const r = await synthesize(key, asked, support.slice(0, 8), (d) => setLlmText((t) => t + d));
      if (r.refused) setLlmState('refused');
      else {
        setLlmText(r.text);
        setLlmState('done');
      }
    } catch (err) {
      setLlmError(describeError(err));
      setLlmState('error');
    }
  }

  const segments = parseCitations(llmText, allowed);
  const badCites = segments.filter((s) => s.cite && !s.valid).length;
  const docById = new Map(support.map((h) => [h.doc.id, h.doc]));

  return (
    <>
      <PageHead eyebrow="Section 5 · AI with receipts" title="Ask EMBER">
        <p>
          Ask a fire-safety question. EMBER searches the claims extracted from PSI investigations and their reports and answers{' '}
          <strong>only</strong> with cited evidence. If nothing in the corpus supports an answer, it says so.
        </p>
      </PageHead>

      <form onSubmit={submit} className="card">
        <label htmlFor="q" className="small muted">Your question</label>
        <div className="row" style={{ marginTop: 4 }}>
          <input id="q" type="search" style={{ flex: 1, minWidth: 220 }} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. How much CO2 extinguishes a droplet flame?" />
          <button type="submit" className="primary" disabled={!question.trim()}>Search evidence</button>
        </div>
        <div className="row small" style={{ marginTop: 8 }}>
          <span className="muted">Try:</span>
          {EXAMPLES.map((x) => (
            <button key={x} type="button" className="chip-btn" onClick={() => { setQuestion(x); submit(undefined, x); }}>
              {x}
            </button>
          ))}
        </div>
      </form>

      {asked && (
        <div className="grid grid-2" style={{ marginTop: 16 }}>
          <section className="card" aria-live="polite">
            <h2>Evidence-only answer</h2>
            {support.length === 0 ? (
              <>
                <p style={{ fontSize: '1.1rem' }}><strong>{NO_EVIDENCE}</strong></p>
                <p className="small muted">
                  No extracted claim matches enough of the question. EMBER does not answer from general knowledge.
                  {hits.length > 0 && ' Weak matches are listed below for transparency, but they do not support an answer.'}
                </p>
                {hits.slice(0, 3).map((h) => (
                  <HitView key={h.doc.id} h={h} />
                ))}
              </>
            ) : (
              <>
                <p className="small muted">
                  {support.length} supporting item{support.length > 1 ? 's' : ''} from{' '}
                  {new Set(support.map((h) => h.doc.inv)).size} investigation(s), ranked by BM25 relevance:
                </p>
                {support.map((h) => (
                  <HitView key={h.doc.id} h={h} />
                ))}
              </>
            )}
          </section>

          <section className="card">
            <h2>Synthesized answer (optional)</h2>
            <p className="small muted">
              Paste your own Anthropic API key to have {LLM_MODEL} write a short answer constrained to the retrieved items above. The key is
              sent only to api.anthropic.com from your browser and kept in memory{remember ? ' and this tab’s sessionStorage' : ''}.
            </p>
            <div className="row">
              <input type="password" aria-label="Anthropic API key" placeholder="sk-ant-…" value={key} onChange={(e) => saveKey(e.target.value, remember)} style={{ flex: 1, minWidth: 200 }} autoComplete="off" />
              <button type="button" className="primary" disabled={!key || !support.length || llmState === 'running'} onClick={runLlm}>
                {llmState === 'running' ? 'Writing…' : 'Synthesize'}
              </button>
            </div>
            <label className="row small" style={{ marginTop: 6 }}>
              <input type="checkbox" checked={remember} onChange={(e) => { setRemember(e.target.checked); saveKey(key, e.target.checked); }} />
              Remember for this tab (sessionStorage)
            </label>
            {!support.length && <p className="small muted" style={{ marginTop: 8 }}>Synthesis is disabled when there is no supporting evidence.</p>}
            {llmState === 'error' && <div className="callout danger small" style={{ marginTop: 10 }}>{llmError}</div>}
            {llmState === 'refused' && <div className="callout small" style={{ marginTop: 10 }}>The model declined to answer this request.</div>}
            {llmText && (
              <div style={{ marginTop: 12 }}>
                <p className="answer">
                  {segments.map((s, i) =>
                    s.cite ? (
                      s.valid ? (
                        <a key={i} className="cite" href={docById.get(s.cite)?.sourceUrl ?? '#'} target="_blank" rel="noreferrer">
                          {s.cite}
                        </a>
                      ) : (
                        <span key={i} className="cite bad" title="Not in the retrieved evidence">{s.cite}?</span>
                      )
                    ) : (
                      <span key={i}>{s.text}</span>
                    ),
                  )}
                </p>
                {llmState === 'done' && (
                  <p className="small muted">
                    {badCites > 0
                      ? `⚠ ${badCites} citation(s) do not match retrieved evidence. Treat those sentences as unsupported.`
                      : segments.some((s) => s.cite)
                        ? 'All citations verified against the retrieved evidence.'
                        : llmText.includes(NO_EVIDENCE)
                          ? 'The model found no supporting evidence.'
                          : '⚠ The answer contains no citations. Treat it as unsupported.'}
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
