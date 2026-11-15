/**
 * Builds public/data/ask_answers.json: ten pre-computed Ask EMBER answers for the static site.
 *
 * Each answer runs the same scientific core as the app (offline hybrid retrieval, applicability rules,
 * deterministic draft). The prose comes from the live generator (gpt-6-luna) and is kept ONLY when it
 * passes the core's own contract, attribution and verifier checks; otherwise the answer is stored as
 * "citations only" (the matching source records, no model text). Requires OPENAI_API_KEY in .env.
 *
 *   npx tsx scripts/build-ask-answers.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  DEFAULT_SYNTHESIS_MODEL, ENGINE_VERSION, generateSynthesis, runReviewSync, verifySynthesis,
  type ChunkRecord, type ChunksIndex, type CorpusV2, type GeneratedSynthesis, type Review,
} from '../src/core';

const corpus = JSON.parse(readFileSync('public/data/corpus_v2.json', 'utf8')) as CorpusV2;
const index = JSON.parse(readFileSync('public/data/chunks_index.json', 'utf8')) as ChunksIndex;
const env = readFileSync('.env', 'utf8');
const apiKey = env.match(/^OPENAI_API_KEY=(.*)$/m)?.[1]?.trim();
if (!apiKey) throw new Error('OPENAI_API_KEY missing in .env');

export const ASK_QUESTIONS: { id: string; question: string; scenario: string }[] = [
  { id: 'flow-spread', scenario: 'Ventilation', question: 'How does ventilation air flow speed affect flame spread and extinction over thin solid materials such as PMMA and cotton-fiberglass fabric in microgravity?' },
  { id: 'std6001', scenario: 'Material screening', question: 'Do solid materials burn at lower oxygen concentrations in microgravity than the NASA-STD-6001 Test 1 upward flammability test suggests?' },
  { id: 'lunar-rover', scenario: 'Lunar rover', question: 'Will a PMMA cabin lining sustain a flame in a pressurized lunar rover at 30% O2 and 70.3 kPa with 5 cm/s ventilation at lunar gravity?' },
  { id: 'smoke-size', scenario: 'Smoke detection', question: 'How large are the smoke particles produced by overheated spacecraft materials in microgravity, and what does that mean for smoke detector design?' },
  { id: 'n2-suppress', scenario: 'Suppression', question: 'How effective was a nitrogen jet at extinguishing burning solid samples in the BASS microgravity experiments?' },
  { id: 'droplet-loi', scenario: 'Suppression', question: 'Below what oxygen concentration do methanol and heptane droplets stop burning in microgravity, and how do CO2 and helium dilution change that limit?' },
  { id: 'cool-flames', scenario: 'Fundamental', question: 'What are cool flames observed in microgravity droplet combustion experiments, and why do they matter for spacecraft fire safety?' },
  { id: 'saffire', scenario: 'Large-scale fire', question: 'What did the Saffire experiments show about how a large fire grows and spreads over spacecraft materials in low gravity?' },
  { id: 'partial-g', scenario: 'Moon and Mars', question: 'What flight data exist on how flames behave at lunar or Martian gravity, and what can be concluded from microgravity and 1 g tests?' },
  { id: 'smoke-point', scenario: 'Gas flames', question: 'How did the SPICE experiment measure smoke points of gas jet flames in microgravity, and what did it find?' },
];

const chunkById = new Map<string, ChunkRecord>(index.chunks.map((c) => [c.chunkId, c]));
const testById = new Map(corpus.tests.map((t) => [t.testId, t]));
const invById = new Map(corpus.investigations.map((i) => [i.id, i]));

type Citation =
  | { id: string; kind: 'test'; inv: string; fuel: string | null; o2: number | null; pressureKpa: number | null; flowCmS: number | null; gravityG: number | null; outcome: string; terminal: string | null; note: string | null; url: string | null; table: string | null; row: number | null }
  | { id: string; kind: 'source'; title: string; text: string; quote: string | null; url: string | null; inv: string | null; status: string }
  | { id: string; kind: 'investigation'; inv: string; name: string; url: string | null };

function clean(text: string): string {
  return text.replace(/^\[[^\]]*\]\s*/, '').replace(/\s+/g, ' ').trim();
}

function resolveCitation(id: string): Citation | null {
  const test = testById.get(id) ?? (id.startsWith('chk-test-') ? testById.get(id.slice(9)) : undefined);
  if (test) {
    return {
      id, kind: 'test', inv: test.inv, fuel: test.fuel,
      o2: test.atmosphere.o2.value, pressureKpa: test.atmosphere.pressure.value, flowCmS: test.flow.initialFlowCmS.value,
      gravityG: test.gravity.gravityG.value, outcome: test.initialOutcome, terminal: test.terminalEvent, note: test.outcomeRaw,
      url: test.sourceRef.url, table: test.sourceRef.locator?.table ?? null, row: test.sourceRef.locator?.row ?? null,
    };
  }
  const invId = id.startsWith('card:') ? id.slice(5) : invById.has(id) ? id : null;
  if (invId) {
    const inv = invById.get(invId);
    if (inv) return { id, kind: 'investigation', inv: inv.id, name: inv.name, url: inv.psiUrl };
  }
  const ch = chunkById.get(id);
  if (ch) {
    const claimText = ch.text.match(/Claim: (.*)/)?.[1] ?? null;
    const quote = ch.text.match(/Quote: (.*)/)?.[1] ?? ch.sourceRef.quote ?? null;
    return {
      id, kind: 'source', title: ch.sectionHeader ?? id,
      text: claimText ? claimText.trim() : clean(ch.text).slice(0, 420),
      quote: quote ? quote.trim() : null, url: ch.sourceRef.url, inv: ch.inv, status: ch.epistemicStatus,
    };
  }
  return null;
}

/** The source records that carry the answer when no checked model text is available. */
function evidenceOnly(review: Review) {
  const pkg = review.evidencePackage;
  return pkg.evidenceChunks.slice(0, 6).map((d) => d.chunkId);
}

const MAX_ATTEMPTS = Number(process.env.ATTEMPTS ?? 4);
/** ONLY=id1,id2 regenerates just those answers and keeps the rest of the existing file. */
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;

async function liveSynthesis(review: Review): Promise<{ synthesis: GeneratedSynthesis | null; attempts: number; errors: string[] }> {
  const errors: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const s = await generateSynthesis(review.evidencePackage, { apiKey, mode: 'LIVE_AI', strictLive: true } as Parameters<typeof generateSynthesis>[1]);
      const v = verifySynthesis(s, review.evidencePackage);
      if (!v.passed) throw new Error('verifier failed');
      return { synthesis: s, attempts: attempt, errors };
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  return { synthesis: null, attempts: MAX_ATTEMPTS, errors };
}

const previous: { id: string }[] = ONLY ? (JSON.parse(readFileSync('public/data/ask_answers.json', 'utf8')) as { answers: { id: string }[] }).answers : [];
const out: unknown[] = [];
for (const q of ASK_QUESTIONS) {
  if (ONLY && !ONLY.has(q.id)) {
    const keep = previous.find((a) => a.id === q.id);
    if (keep) out.push(keep);
    continue;
  }
  const review = runReviewSync({ question: q.question, corpus, index, parserOptions: { applyEnvironmentDefaults: true } });
  const { synthesis, attempts, errors } = await liveSynthesis(review);
  const s = synthesis ?? review.synthesis;
  const items = (k: 'observedFact' | 'authorInterpretation' | 'engineeringImplication') =>
    synthesis ? s[k].map((c) => ({ text: c.text.replace(/\s*\[[^\]]+\]/g, '').trim(), citations: c.citations, provenance: c.provenance })) : [];
  const citeIds = new Set<string>([
    ...(synthesis ? [...s.observedFact, ...s.authorInterpretation, ...s.engineeringImplication].flatMap((c) => c.citations) : evidenceOnly(review)),
  ]);
  const citations = [...citeIds].map(resolveCitation).filter((c): c is Citation => c !== null);
  const rankings = review.evidencePackage.rankings.slice(0, 5).map((r) => ({
    inv: r.inv.id, name: r.inv.name, relevance: r.relevanceScore, applicability: r.applicabilityScore, quality: r.evidenceQualityScore,
    matching: r.admissibleCount, nearby: r.conditionalCount,
  }));
  out.push({
    id: q.id,
    scenario: q.scenario,
    question: q.question,
    boundary: s.answerBoundary,
    mode: synthesis ? 'checked_model_text' : 'citations_only',
    model: synthesis ? synthesis.modelName ?? DEFAULT_SYNTHESIS_MODEL : null,
    attempts,
    observed: items('observedFact'),
    interpretation: items('authorInterpretation'),
    implication: items('engineeringImplication'),
    openQuestions: s.openQuestions.filter((x) => !/^Unspecified query parameter/.test(x)).slice(0, 4),
    gaps: review.evidencePackage.gaps.slice(0, 4),
    rankings,
    citations,
    checks: synthesis ? ['citations resolve to corpus records', 'numbers and units match cited records', 'observed vs planned kept apart', 'query constraints preserved', 'lexical support for each claim'] : [],
  });
  console.log(`${q.id}: ${synthesis ? `checked model text after ${attempts} attempt(s)` : `citations only (${errors.join(' | ')})`}, boundary ${s.answerBoundary}, ${citations.length} citations`);
}

writeFileSync(
  'public/data/ask_answers.json',
  JSON.stringify({ generatedAt: new Date().toISOString(), corpusVersion: corpus.corpusVersion, engineVersion: ENGINE_VERSION, retrieval: 'offline hybrid (BM25 + TF-IDF/SVD + structured filter)', answers: out }, null, 1),
);
