import {comparisonReport} from './comparisonReport';
import { assertQuestionScope } from './questionScope';
/**
 * End-to-end EMBER v2 scientific review orchestrator & export formatters.
 * Pipeline:
 *   parseResearchQuery -> searchHybrid -> evaluatePassageWithJev -> evaluateApplicability/rankInvestigationsV2
 *   -> buildContrasts -> generateSynthesis -> verifySynthesis -> buildDependencies
 *   -> generateCandidateBlocks/optimizeTestProgramme -> predictAllApplicableTargets -> RunEnvelope + Review
 */
import { buildContrasts, evaluateApplicability, rankInvestigationsV2, type ApplicabilityOptions } from './applicability';
import { buildDependencies, registerReviewCorpus } from './dependencies';
import { generateDeterministicSynthesis, generateSynthesis, type GeneratorOptions } from './generator';
import { evaluatePassageWithJevOffline, JEV_PROMPT_VERSION } from './jev';
import { generateCandidateBlocks, optimizeTestProgramme } from './planner';
import { predictAllApplicableTargets } from './prediction';
import { summarizeTestProtocol } from './protocol';
import { parseResearchQuery, type QueryParserOptions } from './queryParser';
import { buildSynthesizedChunksIndex, searchHybrid } from './retrieval';
import type {
  ApplicabilityDecision,
  ChunkRecord,
  ChunksIndex,
  CorpusV2,
  EvidencePackage,
  GeneratedSynthesis,
  Investigation,
  JevPassageDecision,
  ResearchQuery,
  RetrievalHit,
  RetrievalMode,
  Review,
  RunEnvelope,
  SynthesisMode,
  Test,
} from './types';
import { verifySynthesis } from './verifier';

export const ENGINE_VERSION = '2.1.1-ask-evidence';

export interface ReviewInput {
  question: string;
  overrides?: Partial<ResearchQuery>;
  parserOptions?: QueryParserOptions;
  corpus: CorpusV2;
  index?: ChunksIndex;
  budgetRuns?: number;
  retrievalMode?: RetrievalMode;
  retrievalK?: number;
  synthesisMode?: SynthesisMode;
  apiKey?: string;
  proxyUrl?: string;
  model?: string;
  savedSnapshot?: GeneratedSynthesis;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  consumeResponse?: GeneratorOptions['consumeResponse'];
  onProgress?: (stage: 'retrieval' | 'applicability' | 'synthesis' | 'verification') => void;
  /** Async server adapters keep provider credentials out of the scientific core/browser. */
  retrieve?: (query: ResearchQuery, index: ChunksIndex, k: number, mode: RetrievalMode) => Promise<RetrievalHit[]>;
  embeddingModel?: string;
  embeddingDim?: number;
  passageEvaluator?: (query: ResearchQuery, chunk: ChunkRecord) => Promise<JevPassageDecision>;
  ablations?: ApplicabilityOptions['ablations'] & { noJev?: boolean };
}

function collectGaps(
  query: ResearchQuery,
  decisions: ApplicabilityDecision[],
  rankings: ReturnType<typeof rankInvestigationsV2>,
): string[] {
  const gaps: string[] = [];
  if (query.gravityRegime === 'partial_gravity') {
    gaps.push(`No actual partial-gravity (${query.gravityG ?? 'lunar/Mars'} g) tests exist in PSI corpus.`);
  }
  if (decisions.some((d) => d.marginalOverlapButJointMissing)) {
    gaps.push('Unsupported joint (O2, pressure, flow) combination despite 1D marginal range overlap.');
  }
  if ((!query.material || query.targetEndpoint === 'smoke_particle_size') && decisions.some((d) => d.reasonCodes.includes('assumed_provenance_cap'))) {
    gaps.push('Atmospheric O2/pressure for smoke-sizing data (SAME/SAME-R) are assumed, not measured.');
  }
  if (decisions.every((d) => d.verdict !== 'admissible')) {
    gaps.push('Zero fully admissible individual tests satisfy every applicability rule simultaneously.');
  }
  if (rankings.some((r) => r.inv.epistemicStatus === 'planned_only' && r.relevanceScore >= 0.5)) {
    gaps.push('Relevant investigation (FLEX-2) is planned_only with no observed flight test rows.');
  }
  if (query.unknownFields.includes('thicknessMm')) {
    gaps.push('Sample thickness (thicknessMm) is unspecified in query; thin-film vs thick-slab regime remains open.');
  }
  return [...new Set(gaps)];
}

function selectEvaluatedTests(
  query: ResearchQuery,
  corpus: CorpusV2,
  rankings: ReturnType<typeof rankInvestigationsV2>,
  retrievedHits: RetrievalHit[],
): Test[] {
  const byId = new Map(corpus.tests.map((t) => [t.testId, t]));
  const picked = new Map<string, Test>();

  const explicitIds =
    query.rawQuestion.match(
      /\b(?:BASS-II-[A-Za-z0-9-]+|BASS-[A-Za-z0-9-]+|CFI-G-[A-Za-z0-9-]+|CFI-\d+|Saffire-[IVX]+-S?\d+(?:-\d+)?|EFIELD-[A-Za-z0-9-]+|(?:ACME-)?BRE-[A-Za-z0-9-]+(?:\.\d+)?|SAME-R?-\d+[a-z]?|SPICE-[A-Za-z0-9-]+|FLEX-\d*[A-Za-z0-9-]+|SLICE-[A-Za-z0-9-]+)\b/gi,
    ) ?? [];
  const normExplicit = new Set(explicitIds.map((s) => s.toUpperCase()));
  for (const t of corpus.tests) {
    if (normExplicit.has(t.testId.toUpperCase())) picked.set(t.testId, t);
  }

  for (const h of retrievedHits) {
    if (h.chunk.testId) {
      const t = byId.get(h.chunk.testId);
      if (t) picked.set(t.testId, t);
    }
  }

  if (normExplicit.size > 0 && picked.size >= normExplicit.size && query.targetInvIds?.length) {
    const scopeInvs = new Set(query.targetInvIds);
    for (const t of corpus.tests) {
      if (picked.size >= 80) break;
      if (scopeInvs.has(t.inv)) picked.set(t.testId, t);
    }
    return [...picked.values()];
  }

  const quotas = [120, 80, 50, 30, 20];
  const topRanks = rankings.slice(0, 5);
  for (let i = 0; i < topRanks.length; i++) {
    const invId = topRanks[i].inv.id;
    let added = 0;
    for (const t of corpus.tests) {
      if (t.inv !== invId) continue;
      if (!picked.has(t.testId)) {
        picked.set(t.testId, t);
        added += 1;
      }
      if (added >= quotas[i] || picked.size >= 350) break;
    }
    if (picked.size >= 350) break;
  }

  return picked.size > 0 ? [...picked.values()] : corpus.tests.slice(0, 150);
}

function evaluateCorpusTests(
  query: ResearchQuery,
  corpus: CorpusV2,
  retrievedHits: RetrievalHit[],
  ablations?: ReviewInput['ablations'],
): {
  decisions: ApplicabilityDecision[];
  rankings: ReturnType<typeof rankInvestigationsV2>;
  evaluatedTests: Test[];
} {
  const invMap = new Map(corpus.investigations.map((i) => [i.id, i]));
  const testsByInv = new Map<string, Test[]>();
  for (const t of corpus.tests) {
    const arr = testsByInv.get(t.inv);
    if (arr) arr.push(t);
    else testsByInv.set(t.inv, [t]);
  }
  const rankings = rankInvestigationsV2(query, corpus, { ablations });
  const candidateTests = selectEvaluatedTests(query, corpus, rankings, retrievedHits);
  const decisions = candidateTests.map((t) =>
    evaluateApplicability(query, t, {
      investigation: invMap.get(t.inv),
      allInvTests: testsByInv.get(t.inv),
      ablations,
    }),
  );
  return { decisions, rankings, evaluatedTests: candidateTests };
}

function buildEvidencePackageFromParts(
  query: ResearchQuery,
  retrievedHits: RetrievalHit[],
  jevDecisions: JevPassageDecision[],
  decisions: ApplicabilityDecision[],
  rankings: ReturnType<typeof rankInvestigationsV2>,
  evaluatedTests: Test[],
): EvidencePackage {
  const evidenceChunks = jevDecisions.filter((d) => d.route === 'evidence');
  const contextChunks = jevDecisions.filter((d) => d.route === 'context');
  const conflictChunks = jevDecisions.filter((d) => d.route === 'conflict');
  const contrasts = buildContrasts(query, evaluatedTests);
  const gaps = collectGaps(query, decisions, rankings);

  return {
    query,
    retrievedHits,
    jevDecisions,
    evidenceChunks,
    contextChunks,
    conflictChunks,
    applicabilityDecisions: decisions,
    rankings,
    contrasts,
    gaps,
    evaluatedTests,
  };
}

function naiveNoJevDecisions(hits: RetrievalHit[]): JevPassageDecision[] {
  return hits.map((h) => ({
    chunkId: h.chunk.chunkId,
    inv: h.chunk.inv,
    testId: h.chunk.testId,
    q1Relevance: {
      answer: 'direct_match',
      probabilities: { direct_match: 0.7, partial_context: 0.2, not_relevant: 0.1 },
      confidence: 0.7,
    },
    q2Observation: {
      answer: 'observed_finding',
      probabilities: { observed_finding: 0.7, planned_or_hypothesis: 0.15, method_or_assumption: 0.15 },
      confidence: 0.7,
    },
    q3Contradiction: {
      answer: 'consistent',
      probabilities: { consistent: 0.8, tension_or_conflict: 0.1, insufficient_to_judge: 0.1 },
      confidence: 0.8,
    },
    route: 'evidence',
    concentrationConfidence: 0.73,
    promptVersion: JEV_PROMPT_VERSION,
    evaluatorMode: 'deterministic_offline',
    latencyMs: 0,
    sourceRef: h.chunk.sourceRef,
  }));
}

function finalizeReview(
  corpus: CorpusV2,
  evidencePackage: EvidencePackage,
  synthesis: GeneratedSynthesis,
  budgetRuns: number,
  retrievalMode: RetrievalMode,
  timings: Omit<RunEnvelope['timingMs'], 'verify' | 'plan' | 'predict' | 'total'>,
  tStart: number,
): Review {
  const tVerify0 = Date.now();
  const verification = verifySynthesis(synthesis, evidencePackage);
  const tVerify1 = Date.now();

  const dependencies = buildDependencies(
    [...synthesis.observedFact,...synthesis.authorInterpretation,...synthesis.engineeringImplication],
    evidencePackage.applicabilityDecisions,
    evidencePackage.query,
    evidencePackage.retrievedHits.map(h=>h.chunk),
  );

  const tPlan0 = Date.now();
  const candidates = generateCandidateBlocks(evidencePackage);
  const testProgramme = optimizeTestProgramme(candidates, budgetRuns);
  const tPlan1 = Date.now();

  const tPred0 = Date.now();
  const predictions = predictAllApplicableTargets(evidencePackage.query, corpus.tests);
  const tPred1 = Date.now();

  const envelope: RunEnvelope = {
    runId: `run-${tStart.toString(36)}-${Math.abs(evidencePackage.query.rawQuestion.length * 97).toString(36)}`,
    timestamp: new Date().toISOString(),
    corpusVersion: corpus.corpusVersion,
    engineVersion: ENGINE_VERSION,
    mode: synthesis.mode,
    jevPromptVersion: evidencePackage.jevDecisions[0]?.promptVersion ?? JEV_PROMPT_VERSION,
    decisionModel: evidencePackage.jevDecisions.find(d => d.model)?.model,
    retrievalMode,
    timingMs: {
      ...timings,
      verify: Math.max(0, tVerify1 - tVerify0),
      plan: Math.max(0, tPlan1 - tPlan0),
      predict: Math.max(0, tPred1 - tPred0),
      total: Math.max(0, tPred1 - tStart),
    },
  };

  const review: Review = {
    query: evidencePackage.query,
    evidencePackage,
    dependencies,
    synthesis,
    verification,
    testProgramme,
    predictions,
    envelope,
  };
  registerReviewCorpus(review, corpus);
  registerReviewCorpus(evidencePackage, corpus);
  return review;
}

export function runReviewSync(input: ReviewInput): Review {
  assertQuestionScope(input.question, input.overrides);
  const t0 = Date.now();
  const retrievalMode: RetrievalMode = input.retrievalMode ?? 'hybrid';
  const budgetRuns = input.budgetRuns ?? 10;

  const tParse0 = Date.now();
  const query = parseResearchQuery(input.question, input.overrides, input.parserOptions);
  const tParse1 = Date.now();

  const effectiveIndex = input.index ?? buildSynthesizedChunksIndex(input.corpus);
  const tRet0 = Date.now();
  const retrievedHits = searchHybrid(input.corpus, effectiveIndex, query, {
    mode: retrievalMode,
    k: input.retrievalK ?? 12,
  });
  const tRet1 = Date.now();

  const tJev0 = Date.now();
  const jevDecisions = input.ablations?.noJev
    ? naiveNoJevDecisions(retrievedHits)
    : retrievedHits.map((h) => evaluatePassageWithJevOffline(query, h.chunk, { corpus: input.corpus }));
  const tJev1 = Date.now();

  const tApp0 = Date.now();
  const { decisions, rankings, evaluatedTests } = evaluateCorpusTests(query, input.corpus, retrievedHits, input.ablations);
  const evidencePackage = buildEvidencePackageFromParts(
    query,
    retrievedHits,
    jevDecisions,
    decisions,
    rankings,
    evaluatedTests,
  );
  const tApp1 = Date.now();

  const tSyn0 = Date.now();
  const synthesis =
    input.synthesisMode === 'SAVED_DEMO_SNAPSHOT' && input.savedSnapshot
      ? { ...input.savedSnapshot, mode: 'SAVED_DEMO_SNAPSHOT' as const }
      : generateDeterministicSynthesis(evidencePackage);
  const tSyn1 = Date.now();

  return finalizeReview(
    input.corpus,
    evidencePackage,
    synthesis,
    budgetRuns,
    retrievalMode,
    {
      parse: Math.max(0, tParse1 - tParse0),
      retrieve: Math.max(0, tRet1 - tRet0),
      jev: Math.max(0, tJev1 - tJev0),
      applicability: Math.max(0, tApp1 - tApp0),
      synthesis: Math.max(0, tSyn1 - tSyn0),
    },
    t0,
  );
}

export async function runReview(input: ReviewInput): Promise<Review> {
  assertQuestionScope(input.question, input.overrides);
  input.onProgress?.('retrieval');
  if (!input.apiKey && !input.proxyUrl && !input.retrieve && !input.passageEvaluator && input.synthesisMode !== 'LIVE_AI') {
    return runReviewSync(input);
  }

  const t0 = Date.now();
  const retrievalMode: RetrievalMode = input.retrievalMode ?? 'hybrid';
  const budgetRuns = input.budgetRuns ?? 10;

  const tParse0 = Date.now();
  const query = parseResearchQuery(input.question, input.overrides, input.parserOptions);
  const tParse1 = Date.now();

  const effectiveIndex = input.index ?? buildSynthesizedChunksIndex(input.corpus);
  const tRet0 = Date.now();
  const retrievedHits = input.retrieve
    ? await input.retrieve(query, effectiveIndex, input.retrievalK ?? 12, retrievalMode)
    : searchHybrid(input.corpus, effectiveIndex, query, {mode: retrievalMode, k: input.retrievalK ?? 12});
  const tRet1 = Date.now();

  const tJev0 = Date.now();
  const jevDecisions = input.ablations?.noJev
    ? naiveNoJevDecisions(retrievedHits)
    : await Promise.all(
        retrievedHits.map((h) =>
          input.passageEvaluator
            ? input.passageEvaluator(query, h.chunk)
            : Promise.resolve(evaluatePassageWithJevOffline(query, h.chunk, {corpus: input.corpus})),
        ),
      );
  const tJev1 = Date.now();

  const tApp0 = Date.now();
  input.onProgress?.('applicability');
  const { decisions, rankings, evaluatedTests } = evaluateCorpusTests(query, input.corpus, retrievedHits, input.ablations);
  const evidencePackage = buildEvidencePackageFromParts(
    query,
    retrievedHits,
    jevDecisions,
    decisions,
    rankings,
    evaluatedTests,
  );
  const tApp1 = Date.now();

  const tSyn0 = Date.now();
  const genOpts: GeneratorOptions = {
    mode: input.synthesisMode,
    apiKey: input.apiKey,
    proxyUrl: input.proxyUrl,
    model: input.model,
    savedSnapshot: input.savedSnapshot,
    fetchImpl: input.fetchImpl,
    signal: input.signal,
    consumeResponse: input.consumeResponse,
  };
  input.onProgress?.('synthesis');
  const synthesis = await generateSynthesis(evidencePackage, genOpts);
  input.onProgress?.('verification');
  const tSyn1 = Date.now();

  const review = finalizeReview(
    input.corpus,
    evidencePackage,
    synthesis,
    budgetRuns,
    retrievalMode,
    {
      parse: Math.max(0, tParse1 - tParse0),
      retrieve: Math.max(0, tRet1 - tRet0),
      jev: Math.max(0, tJev1 - tJev0),
      applicability: Math.max(0, tApp1 - tApp0),
      synthesis: Math.max(0, tSyn1 - tSyn0),
    },
    t0,
  );
  if (retrievalMode === 'hybrid') {
    review.envelope.embeddingModel = input.embeddingModel ?? effectiveIndex.embeddingModel;
    review.envelope.embeddingDim = input.embeddingDim ?? effectiveIndex.embeddingDim;
  }
  return review;
}

// ---------------------------------------------------------------------------
// Export Formatters

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportTestsCsv(tests: Test[], investigations: Investigation[]): string {
  const invById = new Map(investigations.map((i) => [i.id, i]));
  const cols = [
    'inv', 'psi', 'doi', 'testId', 'groupId', 'fuel', 'fuelPhase', 'geometry',
    'thicknessMm', 'diameterMm', 'o2Pct', 'o2Role', 'pressureKpa', 'flowCmS',
    'flowDirection', 'flowHistory', 'gravityG', 'gravityRegime', 'gravityMode',
    'initialOutcome', 'terminalEvent', 'spreadRateMmS', 'burningRateMm2S',
    'particleSizeNm', 'smokePointLengthMm', 'sourceId',
  ] as const;

  const lines = [cols.join(',')];
  for (const t of tests) {
    const inv = invById.get(t.inv);
    const row: Record<(typeof cols)[number], unknown> = {
      inv: t.inv,
      psi: inv?.psi ?? null,
      doi: inv?.doi ?? null,
      testId: t.testId,
      groupId: t.groupId,
      fuel: t.fuel,
      fuelPhase: t.fuelPhase,
      geometry: t.geometry,
      thicknessMm: t.thicknessMm.value,
      diameterMm: t.diameterMm.value,
      o2Pct: t.atmosphere.o2.value,
      o2Role: t.atmosphere.o2.role,
      pressureKpa: t.atmosphere.pressure.value,
      flowCmS: t.flow.initialFlowCmS.value,
      flowDirection: t.flow.direction,
      flowHistory: t.flow.history,
      gravityG: t.gravity.gravityG.value,
      gravityRegime: t.gravity.regime,
      gravityMode: t.gravity.mode,
      initialOutcome: t.initialOutcome,
      terminalEvent: t.terminalEvent,
      spreadRateMmS: t.spreadRateMmS.value,
      burningRateMm2S: t.burningRateMm2S.value,
      particleSizeNm: t.particleSizeNm.value,
      smokePointLengthMm: t.smokePointLengthMm.value,
      sourceId: t.sourceRef?.sourceId ?? null,
    };
    lines.push(cols.map((c) => csvEscape(row[c])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/**
 * Modeling-ready CSV explicitly preserving groupId (replicate grouping), provenance,
 * gas role, gravity mode, and stage-bound protocol summary so downstream ML splits never leak replicates.
 */
export function exportModelingCsv(tests: Test[], investigations: Investigation[]): string {
  const invById = new Map(investigations.map((i) => [i.id, i]));
  const cols = [
    'testId', 'inv', 'groupId', 'seriesId', 'sampleId', 'epistemicStatus',
    'fuel', 'fuelPhase', 'geometry', 'thicknessMm', 'diameterMm', 'widthCm',
    'o2Pct', 'o2Role', 'o2Provenance', 'pressureKpa', 'pressureProvenance',
    'diluent', 'diluentPct', 'initialFlowCmS', 'flowDirection', 'flowHistory',
    'gravityG', 'gravityRegime', 'gravityPlatform', 'gravityMode',
    'initialOutcome', 'terminalEvent', 'protocolSegmentCount', 'protocolSummary',
    'spreadRateMmS', 'burningRateMm2S', 'particleSizeNm', 'smokePointLengthMm',
    'sourceId', 'sourceUrl', 'locator',
  ] as const;

  const lines = [cols.join(',')];
  for (const t of tests) {
    const inv = invById.get(t.inv);
    const row: Record<(typeof cols)[number], unknown> = {
      testId: t.testId,
      inv: t.inv,
      groupId: t.groupId,
      seriesId: t.seriesId,
      sampleId: t.sampleId,
      epistemicStatus: inv?.epistemicStatus ?? 'observed',
      fuel: t.fuel,
      fuelPhase: t.fuelPhase,
      geometry: t.geometry,
      thicknessMm: t.thicknessMm.value,
      diameterMm: t.diameterMm.value,
      widthCm: t.widthCm.value,
      o2Pct: t.atmosphere.o2.value,
      o2Role: t.atmosphere.o2.role,
      o2Provenance: t.atmosphere.o2.provenance,
      pressureKpa: t.atmosphere.pressure.value,
      pressureProvenance: t.atmosphere.pressure.provenance,
      diluent: t.atmosphere.diluent,
      diluentPct: t.atmosphere.diluentPct.value,
      initialFlowCmS: t.flow.initialFlowCmS.value,
      flowDirection: t.flow.direction,
      flowHistory: t.flow.history,
      gravityG: t.gravity.gravityG.value,
      gravityRegime: t.gravity.regime,
      gravityPlatform: t.gravity.platform,
      gravityMode: t.gravity.mode,
      initialOutcome: t.initialOutcome,
      terminalEvent: t.terminalEvent,
      protocolSegmentCount: t.segments.length,
      protocolSummary: summarizeTestProtocol(t),
      spreadRateMmS: t.spreadRateMmS.value,
      burningRateMm2S: t.burningRateMm2S.value,
      particleSizeNm: t.particleSizeNm.value,
      smokePointLengthMm: t.smokePointLengthMm.value,
      sourceId: t.sourceRef?.sourceId ?? null,
      sourceUrl: t.sourceRef?.url ?? null,
      locator: t.sourceRef?.locator ?? null,
    };
    lines.push(cols.map((c) => csvEscape(row[c])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

export function exportReviewMarkdown(review: Review): string {
  const { query, synthesis, verification, testProgramme, evidencePackage } = review;
  const lines: string[] = [
    `# EMBER Review: ${query.rawQuestion}`,
    `Engine: ${review.envelope.engineVersion}; corpus: ${review.envelope.corpusVersion}; synthesis: ${synthesis.modelName??synthesis.mode}. Programmatic verifier pass is not independent scientific validation.`,
    `- Mode: \`${synthesis.mode}\` | Answer Boundary: \`${synthesis.answerBoundary}\` | Verification: \`${verification.passed ? 'PASS' : 'FLAGGED'}\``,
    '',
    '## Observed Facts',
    ...(synthesis.observedFact.length > 0 ? synthesis.observedFact.map((f) => `- ${f.text}`) : ['- None satisfying all admissibility criteria.']),
    '',
    '## Author Interpretations & Planned Context',
    ...(synthesis.authorInterpretation.length > 0 ? synthesis.authorInterpretation.map((a) => `- ${a.text}`) : ['- None.']),
    '',
    '## Engineering Implications',
    ...synthesis.engineeringImplication.map((e) => `- ${e.text}`),
    '',
    '## Applicability Conditions & Exclusions',
    ...(synthesis.applicabilityConditions.length > 0 ? synthesis.applicabilityConditions.map((c) => `- ${c}`) : ['- None.']),
    '',
    ...comparisonReport(evidencePackage.contrasts),
    '',
    '## Preserved Conflicts & Tensions',
    ...(synthesis.conflictsPreserved.length > 0
      ? synthesis.conflictsPreserved.map((c) => `- [${c.chunkId}] (${c.inv ?? 'n/a'}): ${c.summary}`)
      : ['- None detected.']),
    '',
    `## Top Ranked Investigations (${evidencePackage.rankings.length})`,
    ...evidencePackage.rankings.slice(0, 5).map(
      (r) =>
        `- **${r.inv.id}** (${r.status}): relevance=${r.relevanceScore}, applicability=${r.applicabilityScore}, quality=${r.evidenceQualityScore}`,
    ),
    '',
    `## Planned Test Programme (${testProgramme.usedRuns}/${testProgramme.budgetRuns} runs, coverage=${testProgramme.totalCoverageScore})`,
    ...testProgramme.selectedBlocks.map((b) => `- ${b.blockId}: ${b.title} (${b.runsRequired} runs, ${b.replicatesPerCondition} reps)`),
    '',
    '## Open Questions',
    ...(synthesis.openQuestions.length > 0 ? synthesis.openQuestions.map((q) => `- ${q}`) : ['- None.']),
  ];
  return lines.join('\n') + '\n';
}

export function exportReviewJson(review: Review): string {
  const cleanReview: Review = {
    ...review,
    evidencePackage: {
      ...review.evidencePackage,
      evaluatedTests: undefined,
    },
  };
  return JSON.stringify(cleanReview, null, 2);
}

export const exportFormatters = {
  markdown: exportReviewMarkdown,
  json: exportReviewJson,
  csv: exportTestsCsv,
  modeling_csv: exportModelingCsv,
};
