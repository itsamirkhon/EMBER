import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { parseResearchQuery, type AnswerBoundary, type CorpusV2, type Review, type SourceRef, type Test, type ResearchQuery } from '../../../core';
import { asksForEffect } from '../../../core/answerEvidence';
import { EvidenceComparison, nearestEvidenceTests } from '../AnswerEvidence';
import type { ReviewProgress } from '../../../core/reviewStream';
import { isResearchQuestion, QUESTION_SCOPE_REPLY } from '../../../core/questionScope';
import { createReview } from '../../apiClient';
import { useEmber } from '../../context/EmberContext';
import { invColor } from '../EvidenceMap';
import { fmt, fmtG, outcomeText, useCompact } from '../data';
import { safeExternalHost } from '../../safeUrl';
import { Ext, Loading, PageHead } from '../ui';

type Citation =
  | { id: string; kind: 'test'; inv: string; fuel: string | null; o2: number | null; pressureKpa: number | null; flowCmS: number | null; gravityG: number | null; outcome: string; terminal: string | null; note: string | null; url: string | null; table: string | null; row: number | null; conditionSources?: { oxygen?: SourceRef; pressure?: SourceRef; observations?: SourceRef } }
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
  tests?: Test[];
  nearby?: boolean;
  query?: ResearchQuery;
  summary?: Item;
  reviewId?: string;
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
export function fromReview(question: string, review: Review, corpus: CorpusV2 | null): Answer {
  const s = review.synthesis;
  // Never present unverified model text as verified scientific evidence.
  const live = s.mode === 'LIVE_AI' && review.verification.passed;
  const items = (list: Review['synthesis']['observedFact']) => list.map((c) => ({ text: strip(c.text), citations: c.citations, provenance: c.provenance }));
  const ids = live
    ? [...new Set([...s.observedFact, ...s.authorInterpretation, ...s.engineeringImplication].flatMap((c) => c.citations))]
    : review.evidencePackage.evidenceChunks.slice(0, 6).map((c) => c.chunkId);
  const claimById = new Map(corpus?.claims.map((c) => [c.id, c]) ?? []);
  const sourceById = new Map(corpus?.sources.map((x) => [x.sourceId, x]) ?? []);
  const pool = corpus?.tests ?? review.evidencePackage.evaluatedTests ?? [];
  const testById = new Map(pool.map((t) => [t.testId, t]));
  const hits = review.evidencePackage.retrievedHits ?? [];
  const citedTests = [...new Map(ids.flatMap(id => {
    const tid = hits.find(h => h.chunk.chunkId === id)?.chunk.testId ?? id.replace(/^chk-test-/, '');
    const test = testById.get(tid);
    return test ? [[test.testId, test] as const] : [];
  })).values()];
  const query = review.query ?? parseResearchQuery(question);
  const nearby = s.answerBoundary === 'insufficient_data' || !live || !citedTests.length;
  const tests = nearby ? nearestEvidenceTests(query, pool) : citedTests;
  for (const t of tests) if (!ids.some(id => id === t.testId || id === `chk-test-${t.testId}`)) ids.push(t.testId);
  const chunkRef = new Map<string, { sourceRef: SourceRef; inv: string | null }>([
    ...hits.map(h => [h.chunk.chunkId, h.chunk] as const),
    ...review.evidencePackage.evidenceChunks.map(c => [c.chunkId, c] as const),
  ]);
  const citations: Citation[] = [];
  for (const id of ids) {
    const tid = id.startsWith('chk-test-') ? id.slice(9) : id;
    const t = testById.get(tid);
    if (t) {
      citations.push({
        id, kind: 'test', inv: t.inv, fuel: t.fuel, o2: t.atmosphere.o2.value, pressureKpa: t.atmosphere.pressure.value, flowCmS: t.flow.initialFlowCmS.value,
        gravityG: t.gravity.gravityG.value, outcome: t.initialOutcome, terminal: t.terminalEvent, note: t.outcomeRaw, url: t.sourceRef.url,
        table: t.sourceRef.locator?.table ?? null, row: t.sourceRef.locator?.row ?? null,
        conditionSources: t.observationSourceRef ? { oxygen: t.atmosphere.o2.sourceRef, pressure: t.atmosphere.pressure.sourceRef, observations: t.observationSourceRef } : undefined,
      });
      continue;
    }
    if (id.startsWith('chk-claim-') || id.startsWith('c-')) {
      const c = claimById.get(id.replace(/^chk-claim-/, ''));
      if (c) {
        citations.push({ id, kind: 'source', title: `Claim ${c.id} · ${c.inv ?? ''}`, text: c.text, quote: c.sourceRef.quote ?? null, url: c.sourceRef.url, inv: c.inv, status: c.epistemicStatus });
        continue;
      }
    }
    const ref = chunkRef.get(id)?.sourceRef;
    if (!ref) continue;
    const src = ref ? sourceById.get(ref.sourceId) : undefined;
    const chunk = hits.find(h => h.chunk.chunkId === id)?.chunk;
    citations.push({ id, kind: 'source', title: src?.title ?? ref.sourceId, text: ref.quote ?? chunk?.text ?? '', quote: null, url: ref.url ?? null, inv: chunkRef.get(id)?.inv ?? null, status: chunk?.epistemicStatus ?? 'unknown' });
  }
  return {
    id: review.envelope.runId,
    scenario: 'Your question',
    question,
    boundary: s.answerBoundary === 'sufficient_observed' && asksForEffect(question) ? 'conditional_or_partial' : s.answerBoundary,
    mode: live ? 'live' : 'in_browser',
    model: live ? s.modelName ?? null : null,
    observed: live ? items(s.observedFact) : [],
    interpretation: live ? items(s.authorInterpretation) : [],
    implication: live ? items(s.engineeringImplication) : [],
    openQuestions: s.openQuestions.filter((x) => !/^Unspecified query parameter/.test(x)).slice(0, 4),
    gaps: review.evidencePackage.gaps.slice(0, 4),
    citations,
    checks: live && review.verification.passed ? ['citations resolve', 'numbers and units', 'observed vs planned', 'constraints kept', 'lexical support'] : [],
    tests, nearby, query,
    summary: live ? items(s.engineeringImplication.length ? s.engineeringImplication.slice(0, 1) : s.observedFact.slice(0, 1))[0] : undefined,
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

export function AnswerView({ a }: { a: Answer }) {
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
            : 'Showing source records: a verified AI explanation was not available for this review.'}
        </span>
      </div>

      {a.boundary === 'insufficient_data' && (
        <p className="v3-callout v3-callout-warn">
          No matching flight records in this corpus establish the outcome at your requested conditions. A yes/no answer would be an extrapolation. Nearby records below are context, not a prediction.
        </p>
      )}

      {a.summary && a.boundary !== 'insufficient_data' && <div className="v3-answer-summary"><h3>Quick answer</h3><p>{a.summary.text} <CiteChips ids={a.summary.citations} index={index} /></p></div>}
      {!a.summary && a.boundary === 'conditional_or_partial' && <p className="v3-callout">The records describe tested conditions, but do not establish a causal response or a general safe setting. Compare their differences below.</p>}
      {a.tests && <EvidenceComparison tests={a.tests} query={a.query ?? parseResearchQuery(a.question)} nearby={a.nearby ?? false} />}

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

      <h3>{hasText ? 'Sources' : 'Source records'}</h3>
      {!a.citations.length && <p className="v3-muted">No source records are available for this review. Try a more specific material or investigation.</p>}
      <ol className="v3-cites">
        {a.citations.map((c, i) => (
          <li key={c.id} id={`cite-${i + 1}`}>
            {c.kind === 'test' ? (
              <>
                <span className="v3-swatch" style={{ background: invColor(c.inv) }} /> <b>{c.inv} · {c.id.replace(/^chk-test-/, '')}</b> — {c.fuel ?? 'material not reported'},{' '}
                {fmt(c.o2)}% O₂, {fmt(c.pressureKpa)} kPa, {c.flowCmS === null ? 'airflow not reported' : `${fmt(c.flowCmS)} cm/s`}, {c.gravityG === null ? 'gravity not reported' : fmtG(c.gravityG)}:{' '}
                <i>{outcomeText(c.outcome, c.terminal)}</i>.
                {c.note && <div className="v3-quote">“{c.note}”</div>}
                <div className="v3-small v3-muted">
                  <Ext href={c.url}>{c.table ?? 'PSI record'}</Ext>
                  {c.row !== null ? `, row ${c.row}` : ''}
                  {c.conditionSources?.oxygen?.locator && <><br />Atmosphere/observations: {c.conditionSources.oxygen.locator.table},
                    {' '}sheet “{c.conditionSources.oxygen.locator.sheet}”, row {c.conditionSources.oxygen.locator.row}
                    {' '}({c.conditionSources.oxygen.locator.cell}; {c.conditionSources.pressure?.locator?.cell}; {c.conditionSources.observations?.locator?.cell}).</>}
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
                  <Ext href={c.url}>{safeExternalHost(c.url) ?? 'source'}</Ext>
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

export function ScopeReplyView({ question }: { question: string }) {
  return (
    <article className="v3-card v3-answer" aria-live="polite">
      <div className="v3-muted v3-small">Your question</div>
      <h2 className="v3-answer-q">{question}</h2>
      <p>{QUESTION_SCOPE_REPLY}</p>
    </article>
  );
}

export function ThinkingAnswer({ question, progress = [] }: { question: string; progress?: ReviewProgress[] }) {
  const stage = progress.filter(e => e.type === 'stage').at(-1);
  const stageText: Record<string, string> = { retrieval: 'Finding relevant NASA records…', applicability: 'Checking experimental conditions…', synthesis: 'Writing and checking source-linked claims…', verification: 'Checking the complete answer…' };
  const claims = progress.filter(e => e.type === 'claim');
  return (
    <div className="v3-card v3-answer v3-thinking" role="status" aria-live="polite">
      <div className="v3-muted v3-small">Your question</div>
      <h2 className="v3-answer-q">{question}</h2>
      <div className="v3-thinking-head">
        <span className="v3-thinking-orb" aria-hidden="true"><span /></span>
        <div>
          <strong>EMBER is thinking<span className="v3-thinking-dots" aria-hidden="true"><i /><i /><i /></span></strong>
          <p>{stage?.type === 'stage' ? stageText[stage.stage] ?? 'Reviewing NASA evidence…' : 'Connecting to the research service…'}</p>
        </div>
      </div>
      {claims.length > 0 ? <><h3>Checked findings · live preview</h3><p className="v3-small v3-muted">Completed claims appear after source checks. The final answer may replace this preview after whole-answer verification.</p><ul>{claims.map(e => <li key={`${e.section}:${e.claim.id}`}>{e.claim.text}</li>)}</ul></> : <div className="v3-thinking-lines" aria-hidden="true"><span /><span /><span /></div>}
    </div>
  );
}

export function AskPage() {
  const [file, setFile] = useState<AnswerFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('lunar-rover');
  const [question, setQuestion] = useState('');
  const [custom, setCustom] = useState<Answer | null>(null);
  const [scopeQuestion, setScopeQuestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [progress, setProgress] = useState<ReviewProgress[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [exampleCorpus, setExampleCorpus] = useState<CorpusV2 | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const { ensureCorpus } = useEmber();
  const { data: compact } = useCompact();

  useEffect(() => {
    fetch('./data/ask_answers.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: AnswerFile) => setFile(d), (e: unknown) => setError(String(e)));
  }, []);
  useEffect(() => () => activeRequest.current?.abort(), []);
  useEffect(() => {
    if (!file) return;
    let active = true;
    void ensureCorpus().then(corpus => { if (active) setExampleCorpus(corpus); }).catch(() => undefined);
    return () => { active = false; };
  }, [file, ensureCorpus]);

  async function ask(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setNote(null);
    setCustom(null);
    setScopeQuestion(null);
    setFailure(null);
    setProgress([]);
    if (!isResearchQuestion(q)) {
      setScopeQuestion(q);
      return;
    }
    if (q.length < 8) {
      setNote('Please add a little more detail about what you would like to know.');
      return;
    }
    setPendingQuestion(q);
    setBusy(true);
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const corpusPromise = ensureCorpus().catch(() => null);
      const { snapshot, meta } = await createReview({ question: q, useLiveAi: true, title: q.slice(0, 72) }, event => {
        setProgress(previous => event.type === 'stage' ? [...previous.filter(e => e.type !== 'stage'), event] : [...previous, event]);
      }, controller.signal);
      const corpus = await corpusPromise;
      if (controller.signal.aborted) throw new Error('Review cancelled');
      setCustom({ ...fromReview(q, snapshot.review, corpus), reviewId: snapshot.reviewId });
      setNote(
        meta.backendSource === 'static_fallback'
          ? 'Live review is unavailable. These records were selected in your browser from the saved NASA corpus.'
          : meta.warnings.length ? snapshot.review.synthesis.fallbackReason === 'verification_failed'
            ? 'The generated explanation did not pass the source checks. Original records and evidence gaps are shown instead.'
            : 'Live synthesis is unavailable for this review. Original records and evidence gaps are shown instead.' : null,
      );
    } catch (err) {
      setFailure(controller.signal.aborted ? 'Review cancelled. The unfinished preview has been cleared.' : `Could not complete the review: ${String(err)}. The unfinished preview has been cleared.`);
    } finally {
      setProgress([]);
      setBusy(false);
      activeRequest.current = null;
    }
  }

  const staleAnswers = Boolean(file && compact && file.corpusVersion !== compact.corpusVersion);
  const saved = staleAnswers ? null : file?.answers.find((a) => a.id === selected);
  const current = useMemo(() => {
    if (custom) return custom;
    if (!saved) return null;
    const query = parseResearchQuery(saved.question);
    const ids = new Set(saved.citations.filter(c => c.kind === 'test').map(c => c.id.replace(/^chk-test-/, '')));
    const cited = exampleCorpus?.tests.filter(t => ids.has(t.testId)) ?? [];
    const nearby = saved.boundary === 'insufficient_data' || !cited.length;
    return { ...saved, query, nearby, tests: exampleCorpus ? (nearby ? nearestEvidenceTests(query, exampleCorpus.tests) : cited) : undefined,
      boundary: saved.boundary === 'sufficient_observed' && asksForEffect(saved.question) ? 'conditional_or_partial' as const : saved.boundary,
      summary: saved.implication[0] ?? saved.observed[0] };
  }, [custom, saved, exampleCorpus]);

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
          disabled={busy}
        />
        <button type="submit" className="v3-btn v3-btn-primary" disabled={busy || !question.trim()}>
          {busy ? 'Thinking…' : 'Ask'}
        </button>
        {busy && <button type="button" className="v3-btn" onClick={() => activeRequest.current?.abort()}>Stop</button>}
      </form>
      {note && <p className="v3-small v3-muted">{note}</p>}

      <div className="v3-split v3-split-ask">
        <nav className="v3-card v3-qlist" aria-label="Example questions">
          <h2 className="v3-h3">Example questions</h2>
          <p className="v3-small v3-muted">Explore saved examples, or ask your own question above for a live review. Saved examples are also available offline.</p>
          {error && <p role="alert" className="v3-small v3-warn-text">Could not load the answers ({error}).</p>}
          {staleAnswers && <p role="alert" className="v3-small v3-warn-text">These cached answers were generated for a different corpus version. They are hidden until regenerated.</p>}
          {!file && !error && <Loading what="Loading…" />}
          {file?.answers.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={busy}
              className="v3-q"
              aria-pressed={!busy && !custom && !scopeQuestion && selected === a.id}
              onClick={() => {
                setCustom(null);
                setScopeQuestion(null);
                setNote(null);
                setFailure(null);
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
          {busy ? <ThinkingAnswer question={pendingQuestion} progress={progress} /> : failure ? <article className="v3-card v3-answer" role="alert"><h2>{pendingQuestion}</h2><p>{failure}</p></article> : scopeQuestion ? <ScopeReplyView question={scopeQuestion} /> : current ? <AnswerView a={current} /> : staleAnswers ? (
            <div className="v3-callout v3-callout-warn" role="alert">Cached answers do not match the current PSI corpus. Ask a question to run a fresh local review, or regenerate the cached answers.</div>
          ) : error ? (
            <div className="v3-callout v3-callout-warn" role="alert">The cached answers are unavailable. You can still ask a new question.</div>
          ) : file ? null : <Loading what="Loading answers…" />}
          {!busy && !scopeQuestion && !failure && <p className="v3-small v3-muted" style={{ marginTop: 12 }}>
            Want every rule decision behind an answer? <Link to={current?.reviewId ? `/reviews/${encodeURIComponent(current.reviewId)}` : '/review'}>Open the full scientific review</Link>.
          </p>}
        </div>
      </div>
    </div>
  );
}
