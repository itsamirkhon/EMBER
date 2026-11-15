import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { AnswerBoundary, CorpusV2, Review } from '../../../core';
import { createReview } from '../../apiClient';
import { useEmber } from '../../context/EmberContext';
import { invColor } from '../EvidenceMap';
import { fmt, fmtG, outcomeText } from '../data';
import { Ext, Loading, PageHead } from '../ui';

type Citation =
  | { id: string; kind: 'test'; inv: string; fuel: string | null; o2: number | null; pressureKpa: number | null; flowCmS: number | null; gravityG: number | null; outcome: string; terminal: string | null; note: string | null; url: string | null; table: string | null; row: number | null }
  | { id: string; kind: 'source'; title: string; text: string; quote: string | null; url: string | null; inv: string | null; status: string }
  | { id: string; kind: 'investigation'; inv: string; name: string; url: string | null };

interface Item { text: string; citations: string[]; provenance: string }

interface Answer {
  id: string;
  scenario: string;
  question: string;
  boundary: AnswerBoundary;
  mode: 'checked_model_text' | 'citations_only' | 'live' | 'in_browser';
  model: string | null;
  observed: Item[];
  interpretation: Item[];
  implication: Item[];
  openQuestions: string[];
  gaps: string[];
  citations: Citation[];
  checks: string[];
}

interface AnswerFile { generatedAt: string; corpusVersion: string; engineVersion: string; retrieval: string; answers: Answer[] }

const BOUNDARY: Record<AnswerBoundary, { label: string; cls: string; help: string }> = {
  sufficient_observed: { label: 'Answered from observed data', cls: 'measured', help: 'Flight records and source statements directly support the answer.' },
  conditional_or_partial: { label: 'Partly answered', cls: 'nearby', help: 'Some support exists, with caveats or for only part of the question.' },
  insufficient_data: { label: 'Not established by the data', cls: 'beyond', help: 'EMBER found no records that support an answer, and says so.' },
  invalid_premise: { label: 'Question premise not supported', cls: 'beyond', help: 'The question assumes something the sources contradict.' },
};

const strip = (t: string) => t.replace(/\s*\[[^\]]+\]/g, '').trim();

/** Turns an in-browser review into the same shape as the pre-computed answers. */
function fromReview(question: string, review: Review, corpus: CorpusV2 | null): Answer {
  const s = review.synthesis;
  const live = s.mode === 'LIVE_AI';
  const items = (list: Review['synthesis']['observedFact']) => list.map((c) => ({ text: strip(c.text), citations: c.citations, provenance: c.provenance }));
  const ids = live
    ? [...new Set([...s.observedFact, ...s.authorInterpretation, ...s.engineeringImplication].flatMap((c) => c.citations))]
    : review.evidencePackage.evidenceChunks.slice(0, 6).map((c) => c.chunkId);
  const claimById = new Map(corpus?.claims.map((c) => [c.id, c]) ?? []);
  const sourceById = new Map(corpus?.sources.map((x) => [x.sourceId, x]) ?? []);
  const testById = new Map(corpus?.tests.map((t) => [t.testId, t]) ?? []);
  const chunkRef = new Map(review.evidencePackage.evidenceChunks.map((c) => [c.chunkId, c]));
  const citations: Citation[] = [];
  for (const id of ids) {
    const tid = id.startsWith('chk-test-') ? id.slice(9) : id;
    const t = testById.get(tid);
    if (t) {
      citations.push({
        id, kind: 'test', inv: t.inv, fuel: t.fuel, o2: t.atmosphere.o2.value, pressureKpa: t.atmosphere.pressure.value, flowCmS: t.flow.initialFlowCmS.value,
        gravityG: t.gravity.gravityG.value, outcome: t.initialOutcome, terminal: t.terminalEvent, note: t.outcomeRaw, url: t.sourceRef.url,
        table: t.sourceRef.locator?.table ?? null, row: t.sourceRef.locator?.row ?? null,
      });
      continue;
    }
    if (id.startsWith('chk-claim-')) {
      const c = claimById.get(id.slice(10));
      if (c) {
        citations.push({ id, kind: 'source', title: `Claim ${c.id} · ${c.inv ?? ''}`, text: c.text, quote: c.sourceRef.quote ?? null, url: c.sourceRef.url, inv: c.inv, status: c.epistemicStatus });
        continue;
      }
    }
    const ref = chunkRef.get(id)?.sourceRef;
    const src = ref ? sourceById.get(ref.sourceId) : undefined;
    citations.push({ id, kind: 'source', title: src?.title ?? ref?.sourceId ?? id, text: ref?.quote ?? '', quote: null, url: ref?.url ?? null, inv: chunkRef.get(id)?.inv ?? null, status: 'observed' });
  }
  return {
    id: review.envelope.runId,
    scenario: 'Your question',
    question,
    boundary: s.answerBoundary,
    mode: live ? 'live' : 'in_browser',
    model: live ? s.modelName ?? null : null,
    observed: live ? items(s.observedFact) : [],
    interpretation: live ? items(s.authorInterpretation) : [],
    implication: live ? items(s.engineeringImplication) : [],
    openQuestions: s.openQuestions.filter((x) => !/^Unspecified query parameter/.test(x)).slice(0, 4),
    gaps: review.evidencePackage.gaps.slice(0, 4),
    citations,
    checks: live && review.verification.passed ? ['citations resolve', 'numbers and units', 'observed vs planned', 'constraints kept', 'lexical support'] : [],
  };
}

function CiteChips({ ids, index }: { ids: string[]; index: Map<string, number> }) {
  return (
    <>
      {ids.map((id) =>
        index.has(id) ? (
          <a key={id} href={`#cite-${index.get(id)}`} className="v3-cite" onClick={(e) => { e.preventDefault(); document.getElementById(`cite-${index.get(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>
            {index.get(id)}
          </a>
        ) : null,
      )}
    </>
  );
}

function AnswerView({ a }: { a: Answer }) {
  const index = useMemo(() => new Map(a.citations.map((c, i) => [c.id, i + 1])), [a]);
  const b = BOUNDARY[a.boundary];
  const hasText = a.observed.length + a.interpretation.length + a.implication.length > 0;
  return (
    <article className="v3-card v3-answer" aria-live="polite">
      <div className="v3-muted v3-small">{a.scenario}</div>
      <h2 className="v3-answer-q">{a.question}</h2>
      <div className="v3-row">
        <span className={`v3-status v3-status-${b.cls}`} title={b.help}>{b.label}</span>
        <span className="v3-small v3-muted">
          {a.mode === 'checked_model_text' || a.mode === 'live'
            ? `Text by ${a.model ?? 'the model'}, kept only after EMBER's ${a.checks.length || 5} source checks passed`
            : 'Cited records only: no model text passed EMBER’s checks for this question, so you see the sources themselves'}
        </span>
      </div>

      {a.boundary === 'insufficient_data' && (
        <p className="v3-callout v3-callout-warn">
          EMBER found no flight records that answer this directly. It does not guess. The nearest evidence and the open questions are below.
        </p>
      )}

      {hasText && (
        <div className="v3-answer-body">
          {a.observed.length > 0 && (
            <>
              <h3>What the data shows</h3>
              <ul>
                {a.observed.map((it, i) => (
                  <li key={i}>
                    {it.text} <CiteChips ids={it.citations} index={index} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {a.interpretation.length > 0 && (
            <>
              <h3>What the authors concluded</h3>
              <ul>
                {a.interpretation.map((it, i) => (
                  <li key={i}>
                    {it.text} <CiteChips ids={it.citations} index={index} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {a.implication.length > 0 && (
            <>
              <h3>What it means for design (EMBER’s reading)</h3>
              <ul>
                {a.implication.map((it, i) => (
                  <li key={i}>
                    {it.text} <CiteChips ids={it.citations} index={index} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {(a.openQuestions.length > 0 || a.gaps.length > 0) && (
        <>
          <h3>Still open</h3>
          <ul className="v3-muted">
            {[...new Set([...a.gaps, ...a.openQuestions])].slice(0, 4).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </>
      )}

      <h3>{hasText ? 'Sources' : 'What the sources say'}</h3>
      <ol className="v3-cites">
        {a.citations.map((c, i) => (
          <li key={c.id} id={`cite-${i + 1}`}>
            {c.kind === 'test' ? (
              <>
                <span className="v3-swatch" style={{ background: invColor(c.inv) }} /> <b>{c.inv} · {c.id.replace(/^chk-test-/, '')}</b> — {c.fuel ?? 'material not reported'},{' '}
                {fmt(c.o2)}% O₂, {fmt(c.pressureKpa)} kPa, {c.flowCmS === null ? 'airflow not reported' : `${fmt(c.flowCmS)} cm/s`}, {fmtG(c.gravityG ?? 0)}:{' '}
                <i>{outcomeText(c.outcome, c.terminal)}</i>.
                {c.note && <div className="v3-quote">“{c.note}”</div>}
                <div className="v3-small v3-muted">
                  <Ext href={c.url}>{c.table ?? 'PSI record'}</Ext>
                  {c.row !== null ? `, row ${c.row}` : ''}
                </div>
              </>
            ) : c.kind === 'investigation' ? (
              <>
                <b>{c.inv}</b> — <Ext href={c.url}>{c.name}</Ext>
              </>
            ) : (
              <>
                <b>{c.title}</b>
                {c.text && <div>{c.text}</div>}
                {c.quote && <div className="v3-quote">“{c.quote}”</div>}
                <div className="v3-small v3-muted">
                  <Ext href={c.url}>{c.url ? new URL(c.url).hostname.replace('www.', '') : 'source'}</Ext>
                  {c.status !== 'observed' && <> · {c.status.replace(/_/g, ' ')}</>}
                </div>
              </>
            )}
          </li>
        ))}
      </ol>
    </article>
  );
}

export function AskPage() {
  const [file, setFile] = useState<AnswerFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('lunar-rover');
  const [question, setQuestion] = useState('');
  const [custom, setCustom] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { ensureCorpus } = useEmber();

  useEffect(() => {
    fetch('./data/ask_answers.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: AnswerFile) => setFile(d), (e: unknown) => setError(String(e)));
  }, []);

  async function ask(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (q.length < 8) return;
    setBusy(true);
    setNote(null);
    try {
      const { snapshot, meta } = await createReview({ question: q, useLiveAi: true, title: q.slice(0, 72) });
      const corpus = await ensureCorpus().catch(() => null);
      setCustom(fromReview(q, snapshot.review, corpus));
      setNote(
        meta.backendSource === 'static_fallback'
          ? 'Answered in your browser: no server is attached to this copy of EMBER, so you see the matching cited records rather than model-written text.'
          : meta.warnings[0] ?? null,
      );
    } catch (err) {
      setNote(`Could not run the review: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const current = custom ?? file?.answers.find((a) => a.id === selected) ?? null;

  return (
    <div className="v3-page">
      <PageHead eyebrow="Ask EMBER" title="Ask the NASA record.">
        Answers come only from PSI test rows and NASA reports, with every statement tied to a source. When the data does not support an answer,
        EMBER says so and shows the nearest evidence.
      </PageHead>

      <form className="v3-ask" onSubmit={ask}>
        <input
          type="search"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. How does airflow change flame spread over Nomex in microgravity?"
          aria-label="Your question"
        />
        <button type="submit" className="v3-btn v3-btn-primary" disabled={busy || question.trim().length < 8}>
          {busy ? 'Searching…' : 'Ask'}
        </button>
      </form>
      {note && <p className="v3-small v3-muted">{note}</p>}

      <div className="v3-split v3-split-ask">
        <nav className="v3-card v3-qlist" aria-label="Checked questions">
          <h2 className="v3-h3">Ten checked answers</h2>
          <p className="v3-small v3-muted">Pre-computed for this static site, so they work without a server or API key.</p>
          {error && <p className="v3-small">Could not load the answers ({error}).</p>}
          {!file && !error && <Loading what="Loading…" />}
          {file?.answers.map((a) => (
            <button
              key={a.id}
              type="button"
              className="v3-q"
              aria-pressed={!custom && selected === a.id}
              onClick={() => {
                setCustom(null);
                setSelected(a.id);
              }}
            >
              <span className={`v3-qdot v3-qdot-${BOUNDARY[a.boundary].cls}`} aria-hidden />
              <span>
                <b>{a.scenario}</b>
                <span>{a.question}</span>
              </span>
            </button>
          ))}
          {file && (
            <p className="v3-small v3-muted">
              Corpus {file.corpusVersion}, engine {file.engineVersion}. Retrieval: {file.retrieval}. Generated {new Date(file.generatedAt).toLocaleDateString('en-GB')}.
            </p>
          )}
        </nav>
        <div>
          {current ? <AnswerView a={current} /> : file ? null : <Loading what="Loading answers…" />}
          <p className="v3-small v3-muted" style={{ marginTop: 12 }}>
            Want every rule decision behind an answer? <Link to="/review">Open the full scientific review</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
