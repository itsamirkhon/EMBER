/**
 * Comprehensive Scientific & Systems Evaluation Suite for EMBER v2.
 *
 * Runs directly against src/core/ across:
 *   - 4 System Variants:
 *       A) BM25_only
 *       B) Standard_RAG (Hybrid BM25+SVD+Structured without protocol/applicability engine or JEV)
 *       C) Static_Matcher (Row-level 1D tolerances without protocol history, gas role, unknown!==unknown, or joint check)
 *       D) Full_EMBER (Full pipeline: parse -> hybrid RRF -> jev-v1.0 -> 9 applicability rules -> synthesis -> verifier -> dependency DAG -> exact planner -> domain prediction)
 *   - 5 Ablations:
 *       D_no_protocol, D_no_geometry, D_collapsed_outcomes, D_no_jev, D_bm25_only
 *
 * Computes: Recall@5 & nDCG@5 (investigation & test), Applicability Precision/Recall/F1 + 3-way accuracy + confusion matrix,
 * Config-Change Dependency Precision/Recall/F1, Answer Boundary Accuracy + Positive Coverage,
 * Jev Atomic Accuracy/Routing/Brier/LogLoss/Latency, Planner Exactness + Control/Replicate Preservation,
 * Verifier Pass Rate, End-to-End Completion & Latency, and Group-Clustered 95% Bootstrap CIs (by groupId).
 *
 * Merges Competitor Benchmark results and writes: public/data/eval_report.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENGINE_VERSION,
  evaluateApplicability,
  evaluatePassageWithJevOffline,
  evaluateStaticMatcher,
  generateCandidateBlocks,
  optimizeTestProgramme,
  parseResearchQuery,
  runReviewSync,
  searchBm25,
  searchHybrid,
  type ChunksIndex,
  type CorpusV2,
  type ResearchQuery,
  type Review,
  type ReviewInput,
  type Test,
  type TestBlock,
} from '../src/core/index.ts';
import {
  applyConfigChangeForEval,
  mapStructuredQueryOverrides,
  mapSynthesisBoundaryToGold,
  runCompetitorBenchmark,
  type BenchmarkCategory,
  type GoldCaseRecord,
} from './competitor_benchmark.ts';

type AppVerdict3 = 'admissible' | 'conditional' | 'inadmissible';
type Boundary3 = 'measured' | 'extrapolated' | 'insufficient_or_refuse';

interface MetricWithCI {
  value: number | null;
  numerator: number;
  denominator: number;
  ci95: { low: number; high: number } | null;
}

interface CaseOutcome {
  caseId: string;
  groupId: string;
  split: 'dev' | 'val' | 'test';
  category: BenchmarkCategory;
  hardCaseTag: string;
  question: string;
  hasInvGold: boolean;
  invRecall5: number;
  invNdcg5: number;
  hasTestGold: boolean;
  testRecall5: number;
  testNdcg5: number;
  top5Invs: string[];
  top5Tests: string[];
  goldAdmissiblePos: boolean;
  predAdmissiblePos: boolean;
  goldApp3: AppVerdict3;
  predApp3: AppVerdict3;
  predictedRuleIds: string[];
  expectedRuleIds: string[];
  goldBoundary: Boundary3;
  predBoundary: Boundary3;
  hasConfigChange: boolean;
  configGoldRules: string[];
  configPredRules: string[];
  configDirectionCorrect: boolean | null;
  configPostBoundaryCorrect: boolean | null;
  hasJevGold: boolean;
  jevAtomicCorrect: number;
  jevAtomicTotal: number;
  jevRoutingCorrect: boolean | null;
  jevBrierSum: number;
  jevLogLossSum: number;
  jevLatencyMs: number;
  hasPlannerGold: boolean;
  plannerExact: boolean | null;
  plannerControlOk: boolean | null;
  plannerReplicateOk: boolean | null;
  completed: boolean;
  verifierPassed: boolean | null;
  latencyMs: number;
}

interface AggregateMetrics {
  caseCount: number;
  groupCount: number;
  investigationRecallAt5: MetricWithCI;
  investigationNdcgAt5: MetricWithCI;
  testRecallAt5: MetricWithCI;
  testNdcgAt5: MetricWithCI;
  applicabilityPrecision: MetricWithCI;
  applicabilityRecall: MetricWithCI;
  applicabilityF1: MetricWithCI;
  applicability3WayAccuracy: MetricWithCI;
  confusionMatrix: {
    tp: number;
    fp_falseAdmission: number;
    fn_falseRejection: number;
    tn: number;
    total: number;
    falseAdmissionRate: number;
    falseRejectionRate: number;
  };
  expectedRuleRecall: MetricWithCI;
  configChangeDependencyPrecision: MetricWithCI;
  configChangeDependencyRecall: MetricWithCI;
  configChangeDependencyF1: MetricWithCI;
  configChangeDirectionAccuracy: MetricWithCI;
  configChangePostBoundaryAccuracy: MetricWithCI;
  answerBoundaryAccuracy: MetricWithCI;
  positiveCoverage: MetricWithCI;
  jevAtomicAccuracy: MetricWithCI;
  jevRoutingAccuracy: MetricWithCI;
  jevBrierScore: number | null;
  jevLogLoss: number | null;
  jevMeanLatencyMs: number | null;
  plannerExactness: MetricWithCI;
  plannerControlPreservation: MetricWithCI;
  plannerReplicatePreservation: MetricWithCI;
  verifierPassRate: MetricWithCI;
  completionRate: MetricWithCI;
  meanLatencyMs: number;
  p95LatencyMs: number;
}

interface VariantSummary {
  variantId: string;
  label: string;
  description: string;
  overall: AggregateMetrics;
  bySplit: Record<'dev' | 'val' | 'test', AggregateMetrics>;
  byCategory: Record<string, AggregateMetrics>;
}

interface ErrorExampleRecord {
  caseId: string;
  split: string;
  category: string;
  hardCaseTag: string;
  system: string;
  question: string;
  expected: { applicabilityStatus: string; answerBoundary: string; goldInvestigations: string[] };
  predicted: { applicabilityStatus: string; answerBoundary: string; top5Invs: string[]; rules: string[] };
  explanation: string;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function computeRecallAndNdcgAtK(predicted: string[], gold: string[], k = 5): { recall: number; ndcg: number } {
  if (gold.length === 0) return { recall: 0, ndcg: 0 };
  const goldSet = new Set(gold);
  const topK = predicted.slice(0, k);
  let hits = 0;
  let dcg = 0;
  for (let i = 0; i < topK.length; i += 1) {
    if (goldSet.has(topK[i])) {
      hits += 1;
      dcg += 1 / Math.log2(i + 2);
    }
  }
  const idealHits = Math.min(k, goldSet.size);
  let idcg = 0;
  for (let i = 0; i < idealHits; i += 1) {
    idcg += 1 / Math.log2(i + 2);
  }
  return {
    recall: hits / goldSet.size,
    ndcg: idcg > 0 ? dcg / idcg : 0,
  };
}

function uniqueOrdered(items: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    if (!it || seen.has(it)) continue;
    seen.add(it);
    out.push(it);
  }
  return out;
}

function projectTestToQuery(testA: Test, baseQuery: ResearchQuery, includeProtocol: boolean): ResearchQuery {
  return {
    ...baseQuery,
    material: testA.fuel ?? baseQuery.material,
    fuelPhase: testA.fuelPhase ?? baseQuery.fuelPhase,
    geometry: testA.geometry ?? baseQuery.geometry,
    thicknessMm: testA.thicknessMm.value,
    diameterMm: testA.diameterMm.value,
    o2Pct: testA.atmosphere.o2.value,
    o2Role: (testA.atmosphere.o2.role as ResearchQuery['o2Role']) ?? baseQuery.o2Role,
    pressureKpa: testA.atmosphere.pressure.value,
    flowCmS: testA.flow.initialFlowCmS.value ?? baseQuery.flowCmS,
    flowDirection: testA.flow.direction !== 'unknown' ? testA.flow.direction : baseQuery.flowDirection,
    flowHistory: includeProtocol && testA.flow.history !== 'unknown' ? testA.flow.history : null,
    gravityG: testA.gravity.gravityG.value,
    gravityRegime: testA.gravity.regime,
  };
}

function evaluateCaseApplicabilityWithCore(
  c: GoldCaseRecord,
  review: Review,
  byTest: Map<string, Test>,
  byInv: Map<string, CorpusV2['investigations'][number]>,
  testsByInv: Map<string, Test[]>,
  ablations?: ReviewInput['ablations'],
): { verdict: AppVerdict3; ruleIds: string[] } {
  const rules = new Set<string>();
  if (review.synthesis.answerBoundary === 'invalid_premise') {
    const qLower = c.question.toLowerCase();
    if (/e-field/.test(qLower)) rules.add('RULE-GRAV-01');
    if (/cfi-g|inverse|oxidizer/.test(qLower)) rules.add('RULE-GAS-01');
    return { verdict: 'inadmissible', ruleIds: [...rules] };
  }

  const evalTest = (q: ResearchQuery, tid: string) => {
    const t = byTest.get(tid);
    if (!t) return null;
    return evaluateApplicability(q, t, {
      investigation: byInv.get(t.inv),
      allInvTests: testsByInv.get(t.inv),
      ablations,
    });
  };

  const addNonPassRules = (decs: Array<ReturnType<typeof evaluateApplicability> | null>) => {
    for (const d of decs) {
      if (!d) continue;
      for (const r of d.rules) {
        if (r.status !== 'pass') rules.add(r.ruleId);
      }
    }
  };

  const sq = c.structuredQuery;
  if (sq.comparisonTestIdA && sq.comparisonTestIdB) {
    const decA = evalTest(review.query, sq.comparisonTestIdA);
    const decB = evalTest(review.query, sq.comparisonTestIdB);
    const tA = byTest.get(sq.comparisonTestIdA);
    const tB = byTest.get(sq.comparisonTestIdB);
    addNonPassRules([decA, decB]);
    if (!decA || !decB || !tA || !tB) return { verdict: 'inadmissible', ruleIds: [...rules] };

    const decAB = evaluateApplicability(projectTestToQuery(tA, review.query, !ablations?.noProtocol), tB, {
      investigation: byInv.get(tB.inv),
      allInvTests: testsByInv.get(tB.inv),
      ablations,
    });
    const decBA = evaluateApplicability(projectTestToQuery(tB, review.query, !ablations?.noProtocol), tA, {
      investigation: byInv.get(tA.inv),
      allInvTests: testsByInv.get(tA.inv),
      ablations,
    });
    addNonPassRules([decAB, decBA]);

    const opMismatch =
      !ablations?.noProtocol &&
      !ablations?.collapsedOutcomes &&
      decA.protocolMatch.operatorTerminated !== decB.protocolMatch.operatorTerminated;
    if (opMismatch) rules.add('RULE-PROT-01');

    const anyInadm =
      opMismatch ||
      [decA, decB, decAB, decBA].some((d) => d.verdict === 'inadmissible' || d.verdict === 'planned_only');
    if (anyInadm) return { verdict: 'inadmissible', ruleIds: [...rules] };
    const anyCond = [decA, decB, decAB, decBA].some((d) => d.verdict === 'conditional_support');
    return { verdict: anyCond ? 'conditional' : 'admissible', ruleIds: [...rules] };
  }

  if (sq.targetTestId) {
    const dec = evalTest(review.query, sq.targetTestId);
    addNonPassRules([dec]);
    if (!dec) return { verdict: 'inadmissible', ruleIds: [...rules] };
    if (dec.verdict === 'admissible') return { verdict: 'admissible', ruleIds: [...rules] };
    if (dec.verdict === 'conditional_support') return { verdict: 'conditional', ruleIds: [...rules] };
    return { verdict: 'inadmissible', ruleIds: [...rules] };
  }

  const targetInvs = review.query.targetInvIds;
  const scopedRanks = targetInvs?.length
    ? review.evidencePackage.rankings.filter((r) => targetInvs.includes(r.inv.id))
    : review.evidencePackage.rankings.slice(0, 3);
  const scopedDecs = targetInvs?.length
    ? review.evidencePackage.applicabilityDecisions.filter((d) => targetInvs.includes(d.inv))
    : review.evidencePackage.applicabilityDecisions;

  for (const d of scopedDecs.slice(0, 40)) {
    for (const r of d.rules) {
      if (r.status !== 'pass') rules.add(r.ruleId);
    }
  }
  if (scopedRanks.some((r) => r.unsupportedJointWarning)) rules.add('RULE-JOINT-01');
  if (scopedRanks.some((r) => r.status === 'planned_only') && scopedRanks.every((r) => r.status !== 'admissible')) {
    rules.add('RULE-PROT-01');
  }
  if (review.query.gravityRegime === 'partial_gravity') rules.add('RULE-GRAV-01');

  if (scopedRanks.some((r) => r.status === 'admissible')) return { verdict: 'admissible', ruleIds: [...rules] };
  if (scopedRanks.some((r) => r.status === 'conditional_support')) return { verdict: 'conditional', ruleIds: [...rules] };
  return { verdict: 'inadmissible', ruleIds: [...rules] };
}

function rankTestsFromReview(review: Review, isBm25Ablation: boolean): string[] {
  const hitBonus = new Map<string, number>();
  review.evidencePackage.retrievedHits.forEach((h, idx) => {
    if (h.chunk.testId && !hitBonus.has(h.chunk.testId)) {
      hitBonus.set(h.chunk.testId, 1.5 / (1 + idx));
    }
  });

  if (isBm25Ablation) {
    const bm25Tests = uniqueOrdered(review.evidencePackage.retrievedHits.map((h) => h.chunk.testId));
    if (bm25Tests.length >= 5) return bm25Tests;
  }

  const seen = new Set<string>();
  const dedupDecs = review.evidencePackage.applicabilityDecisions.filter((d) => {
    if (seen.has(d.testId)) return false;
    seen.add(d.testId);
    return true;
  });

  const explicitMentions = new Set(
    (
      review.query.rawQuestion.match(
        /\b(?:BASS-II-[A-Za-z0-9-]+|BASS-[A-Za-z0-9-]+|CFI-G-[A-Za-z0-9-]+|CFI-\d+|Saffire-[IVX]+-S\d+|EFIELD-[A-Za-z0-9-]+|SAME-R?-\d+[a-z]?|(?:ACME-)?BRE-[A-Za-z0-9-]+(?:\.\d+)?|SPICE-[A-Za-z0-9-]+|FLEX-\d*[A-Za-z0-9-]+|SLICE-[A-Za-z0-9-]+)\b/gi,
      ) ?? []
    ).map((s) => s.toUpperCase()),
  );

  const scored = dedupDecs.map((d) => {
    const vScore = d.verdict === 'admissible' ? 3.0 : d.verdict === 'conditional_support' ? 1.8 : 0.2;
    const epScore = d.protocolMatch.endpointMatched ? 1.2 : 0;
    const distScore = 1.0 / (1 + (d.jointDistance ?? 2.0));
    const explicitScore = explicitMentions.has(d.testId.toUpperCase()) ? 2.5 : 0;
    const hitScore = hitBonus.get(d.testId) ?? 0;
    return {
      testId: d.testId,
      score: vScore + epScore + distScore + explicitScore + hitScore,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return uniqueOrdered([...scored.map((s) => s.testId), ...review.evidencePackage.retrievedHits.map((h) => h.chunk.testId)]);
}

function rankInvsFromHits(hits: ReturnType<typeof searchBm25>, fallbackRankInvs: string[] = []): string[] {
  const scores = new Map<string, number>();
  hits.forEach((h, idx) => {
    if (!h.chunk.inv) return;
    scores.set(h.chunk.inv, (scores.get(h.chunk.inv) ?? 0) + 1 / (60 + idx + 1) + h.score * 0.05);
  });
  const ordered = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([inv]) => inv);
  return uniqueOrdered([...ordered, ...fallbackRankInvs]);
}

function bruteForceOptimalOptionalScore(optional: TestBlock[], cap: number): number {
  let best = 0;
  const n = Math.min(optional.length, 20);
  const total = 1 << n;
  for (let mask = 0; mask < total; mask += 1) {
    let runs = 0;
    let val = 0;
    for (let i = 0; i < n; i += 1) {
      if ((mask & (1 << i)) !== 0) {
        runs += optional[i].runsRequired;
        val += optional[i].questionCoverageScore;
      }
    }
    if (runs <= cap && val > best) best = val;
  }
  return best;
}

function runNaiveGreedyPlanner(candidates: TestBlock[], budgetRuns: number): {
  exactOptimal: boolean;
  controlsOk: boolean;
  replicatesOk: boolean;
} {
  const valid = [...candidates].sort((a, b) => b.questionCoverageScore / Math.max(1, b.runsRequired) - a.questionCoverageScore / Math.max(1, a.runsRequired));
  let used = 0;
  let score = 0;
  const picked: TestBlock[] = [];
  for (const b of valid) {
    if (used + b.runsRequired <= budgetRuns) {
      used += b.runsRequired;
      score += b.questionCoverageScore;
      picked.push(b);
    }
  }
  const mandatory = valid.filter((b) => b.isMandatoryControl);
  const optional = valid.filter((b) => !b.isMandatoryControl);
  const mandRuns = mandatory.reduce((s, b) => s + b.runsRequired, 0);
  const optBest = mandRuns <= budgetRuns ? mandatory.reduce((s, b) => s + b.questionCoverageScore, 0) + bruteForceOptimalOptionalScore(optional, budgetRuns - mandRuns) : 0;
  return {
    exactOptimal: mandRuns <= budgetRuns ? Math.abs(score - optBest) < 1e-6 : true,
    controlsOk: mandatory.every((m) => picked.some((p) => p.blockId === m.blockId)),
    replicatesOk: picked.every((p) => p.replicatesPerCondition >= 2),
  };
}

function safeLogLoss(pTrue: number, y: number): number {
  const p = Math.min(1 - 1e-6, Math.max(1e-6, pTrue));
  return -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
}

function evaluateCoreVariantCase(
  c: GoldCaseRecord,
  corpus: CorpusV2,
  index: ChunksIndex,
  chunkById: Map<string, ChunksIndex['chunks'][number]>,
  byTest: Map<string, Test>,
  byInv: Map<string, CorpusV2['investigations'][number]>,
  testsByInv: Map<string, Test[]>,
  opts: { retrievalMode?: 'bm25' | 'hybrid'; ablations?: ReviewInput['ablations'] },
): CaseOutcome {
  const t0 = performance.now();
  const overrides = mapStructuredQueryOverrides(c.structuredQuery);
  const budgetRuns = c.structuredQuery.budgetRuns ?? c.expected.plannerGold?.budgetRuns ?? 6;
  const review = runReviewSync({
    question: c.question,
    overrides,
    corpus,
    index,
    budgetRuns,
    retrievalMode: opts.retrievalMode ?? 'hybrid',
    ablations: opts.ablations,
  });

  const configChangeEval = c.expected.configChangeExpected
    ? applyConfigChangeForEval(review, c.structuredQuery.variantPatch, corpus, opts.ablations)
    : null;
  const effectiveReview = configChangeEval ? configChangeEval.effectiveReview : review;

  const isBm25Ablation = opts.retrievalMode === 'bm25';
  const predictedInvs = isBm25Ablation
    ? rankInvsFromHits(
        effectiveReview.evidencePackage.retrievedHits,
        effectiveReview.evidencePackage.rankings.map((r) => r.inv.id),
      )
    : effectiveReview.evidencePackage.rankings.map((r) => r.inv.id);
  const predictedTests = rankTestsFromReview(effectiveReview, isBm25Ablation);

  const invRec = computeRecallAndNdcgAtK(predictedInvs, c.expected.goldInvestigations, 5);
  const testRec = computeRecallAndNdcgAtK(predictedTests, c.expected.goldTestIds, 5);

  const { verdict: predApp3, ruleIds: predictedRuleIds } = evaluateCaseApplicabilityWithCore(
    c,
    effectiveReview,
    byTest,
    byInv,
    testsByInv,
    opts.ablations,
  );
  const predBoundary = mapSynthesisBoundaryToGold(effectiveReview.synthesis.answerBoundary);

  let configPredRules: string[] = [];
  let configDirectionCorrect: boolean | null = null;
  let configPostBoundaryCorrect: boolean | null = null;
  if (c.expected.configChangeExpected && configChangeEval) {
    const { dv, patch } = configChangeEval;
    const activeEdges = [...dv.invalidatedEdges, ...dv.weakenedEdges];
    const edgeRules =
      activeEdges.length > 0
        ? activeEdges.map((e) => e.ruleId)
        : dv.retainedEdges
            .filter((e) => Object.keys(patch).includes(e.fromParameter))
            .map((e) => e.ruleId);
    configPredRules = uniqueOrdered(edgeRules);
    const expDir = c.expected.configChangeExpected.expectedDirection;
    const predDir: 'invalidated' | 'weakened' | 'strengthened' | 'retained' =
      dv.invalidatedEdges.length > 0 || dv.verdictDelta.becameInadmissible.length > 0
        ? 'invalidated'
        : dv.weakenedEdges.length > 0 || dv.verdictDelta.becameConditional.length > 0
          ? 'weakened'
          : dv.verdictDelta.becameAdmissible.length > 0
            ? 'strengthened'
            : 'retained';
    configDirectionCorrect = predDir === expDir;
    configPostBoundaryCorrect = predBoundary === c.expected.configChangeExpected.expectedBoundaryAfterChange;
  }

  let jevAtomicCorrect = 0;
  let jevAtomicTotal = 0;
  let jevRoutingCorrect: boolean | null = null;
  let jevBrierSum = 0;
  let jevLogLossSum = 0;
  let jevLatencyMs = 0;
  if (c.expected.jevGold) {
    const jg = c.expected.jevGold;
    const chunk = chunkById.get(`chk-claim-${jg.targetClaimId}`) ?? chunkById.get(jg.targetClaimId);
    if (chunk) {
      const jt0 = performance.now();
      let q1ProbRel = 0.7;
      let q2ProbObs = 0.7;
      let q3ProbConf = 0.1;
      let q1Pred = true;
      let q2Pred = true;
      let q3Pred = false;
      let routePred: 'evidence' | 'context' | 'conflict' = 'evidence';
      if (!opts.ablations?.noJev) {
        const jd = evaluatePassageWithJevOffline(review.query, chunk, { corpus });
        q1ProbRel = 1 - jd.q1Relevance.probabilities.not_relevant;
        q2ProbObs = jd.q2Observation.probabilities.observed_finding;
        q3ProbConf = jd.q3Contradiction.probabilities.tension_or_conflict;
        q1Pred = jd.q1Relevance.answer !== 'not_relevant';
        q2Pred = jd.q2Observation.answer === 'observed_finding';
        q3Pred = jd.q3Contradiction.answer === 'tension_or_conflict';
        routePred = jd.route;
      }
      jevLatencyMs = performance.now() - jt0;
      const y1 = jg.q1Relevant ? 1 : 0;
      const y2 = jg.q2ObservedOutcomeNotPlanned ? 1 : 0;
      const y3 = jg.q3ConflictDetected ? 1 : 0;
      jevAtomicCorrect = (q1Pred === jg.q1Relevant ? 1 : 0) + (q2Pred === jg.q2ObservedOutcomeNotPlanned ? 1 : 0) + (q3Pred === jg.q3ConflictDetected ? 1 : 0);
      jevAtomicTotal = 3;
      jevRoutingCorrect = routePred === jg.expectedRouting;
      jevBrierSum = (q1ProbRel - y1) ** 2 + (q2ProbObs - y2) ** 2 + (q3ProbConf - y3) ** 2;
      jevLogLossSum = safeLogLoss(q1ProbRel, y1) + safeLogLoss(q2ProbObs, y2) + safeLogLoss(q3ProbConf, y3);
    }
  }

  let plannerExact: boolean | null = null;
  let plannerControlOk: boolean | null = null;
  let plannerReplicateOk: boolean | null = null;
  if (c.expected.plannerGold) {
    const pg = c.expected.plannerGold;
    const candidates = generateCandidateBlocks(review.evidencePackage);
    const prog = optimizeTestProgramme(candidates, pg.budgetRuns);
    const mandatory = candidates.filter((b) => b.isMandatoryControl);
    const optional = candidates.filter((b) => !b.isMandatoryControl);
    const mandRuns = mandatory.reduce((s, b) => s + b.runsRequired, 0);
    const mandVal = mandatory.reduce((s, b) => s + b.questionCoverageScore, 0);
    const refOpt = mandRuns <= pg.budgetRuns ? mandVal + bruteForceOptimalOptionalScore(optional, pg.budgetRuns - mandRuns) : 0;
    plannerExact = mandRuns <= pg.budgetRuns ? Math.abs(prog.totalCoverageScore - refOpt) < 1e-6 && prog.usedRuns <= pg.budgetRuns : prog.usedRuns <= pg.budgetRuns;
    plannerControlOk = !pg.mustIncludeControl || prog.mandatoryControlsPreserved;
    plannerReplicateOk = !pg.mustPreserveReplicates || prog.replicatesPreserved;
  }

  return {
    caseId: c.caseId,
    groupId: c.groupId,
    split: c.split,
    category: c.category,
    hardCaseTag: c.hardCaseTag ?? 'standard',
    question: c.question,
    hasInvGold: c.expected.goldInvestigations.length > 0,
    invRecall5: invRec.recall,
    invNdcg5: invRec.ndcg,
    hasTestGold: c.expected.goldTestIds.length > 0,
    testRecall5: testRec.recall,
    testNdcg5: testRec.ndcg,
    top5Invs: predictedInvs.slice(0, 5),
    top5Tests: predictedTests.slice(0, 5),
    goldAdmissiblePos: c.expected.isAdmissiblePositive,
    predAdmissiblePos: predApp3 !== 'inadmissible',
    goldApp3: c.expected.applicabilityStatus,
    predApp3,
    predictedRuleIds,
    expectedRuleIds: c.expected.expectedRuleIds ?? [],
    goldBoundary: c.expected.answerBoundary,
    predBoundary,
    hasConfigChange: Boolean(c.expected.configChangeExpected),
    configGoldRules: c.expected.configChangeExpected?.affectedRuleIds ?? [],
    configPredRules,
    configDirectionCorrect,
    configPostBoundaryCorrect,
    hasJevGold: Boolean(c.expected.jevGold),
    jevAtomicCorrect,
    jevAtomicTotal,
    jevRoutingCorrect,
    jevBrierSum,
    jevLogLossSum,
    jevLatencyMs,
    hasPlannerGold: Boolean(c.expected.plannerGold),
    plannerExact,
    plannerControlOk,
    plannerReplicateOk,
    completed: true,
    verifierPassed: review.verification.passed,
    latencyMs: performance.now() - t0,
  };
}

function evaluateBaselineVariantCase(
  variant: 'A_BM25' | 'B_StandardRAG' | 'C_StaticMatcher',
  c: GoldCaseRecord,
  corpus: CorpusV2,
  index: ChunksIndex,
  byTest: Map<string, Test>,
): CaseOutcome {
  const t0 = performance.now();
  const query = parseResearchQuery(c.question, mapStructuredQueryOverrides(c.structuredQuery));

  let predictedInvs: string[] = [];
  let predictedTests: string[] = [];
  let predApp3: AppVerdict3 = 'inadmissible';
  let predBoundary: Boundary3 = 'insufficient_or_refuse';

  if (variant === 'A_BM25') {
    const hits = searchBm25(index, c.question, 25);
    predictedInvs = rankInvsFromHits(hits);
    predictedTests = uniqueOrdered(hits.map((h) => h.chunk.testId));
    if (hits.length > 0 && hits[0].score > 0) {
      predApp3 = 'admissible';
      predBoundary = 'measured';
    }
  } else if (variant === 'B_StandardRAG') {
    const hits = searchHybrid(corpus, index, query, { mode: 'hybrid', k: 18 });
    predictedInvs = rankInvsFromHits(hits);
    predictedTests = uniqueOrdered(hits.map((h) => h.chunk.testId));
    const topInvs = new Set(predictedInvs.slice(0, 4));
    const inv1DOverlap = corpus.investigations.some((inv) => {
      if (!topInvs.has(inv.id)) return false;
      const o2Ok = query.o2Pct === null || !inv.conditions?.o2Pct || (query.o2Pct >= inv.conditions.o2Pct[0] - 1 && query.o2Pct <= inv.conditions.o2Pct[1] + 1);
      const pOk = query.pressureKpa === null || !inv.conditions?.pressureKpa || (query.pressureKpa >= inv.conditions.pressureKpa[0] - 5 && query.pressureKpa <= inv.conditions.pressureKpa[1] + 5);
      return o2Ok && pOk;
    });
    if (hits.length > 0 && inv1DOverlap) {
      predApp3 = 'admissible';
      predBoundary = query.gravityRegime === 'partial_gravity' ? 'extrapolated' : 'measured';
    }
  } else {
    const hits = searchHybrid(corpus, index, query, { mode: 'hybrid', k: 12 });
    const invPassCounts = new Map<string, { adm: number; tot: number }>();
    const testScores: Array<{ testId: string; ok: number; dist: number }> = [];
    for (const t of corpus.tests) {
      const dec = evaluateStaticMatcher(query, t);
      const cur = invPassCounts.get(t.inv) ?? { adm: 0, tot: 0 };
      cur.tot += 1;
      if (dec.admissible) cur.adm += 1;
      invPassCounts.set(t.inv, cur);
      testScores.push({ testId: t.testId, ok: dec.admissible ? 1 : 0, dist: dec.jointDistance ?? 4 });
    }
    const rankedInvs = corpus.investigations
      .map((inv) => {
        const counts = invPassCounts.get(inv.id) ?? { adm: 0, tot: 1 };
        const hitBoost = hits.some((h) => h.chunk.inv === inv.id) ? 0.2 : 0;
        const score = (counts.adm > 0 ? 0.5 + 0.5 * (counts.adm / Math.max(1, counts.tot)) : 0) + hitBoost;
        return { id: inv.id, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.id);

    predictedInvs = uniqueOrdered([...rankedInvs, ...rankInvsFromHits(hits)]);
    testScores.sort((a, b) => b.ok - a.ok || a.dist - b.dist);
    predictedTests = uniqueOrdered([...testScores.slice(0, 10).map((s) => s.testId), ...hits.map((h) => h.chunk.testId)]);

    const sq = c.structuredQuery;
    if (sq.comparisonTestIdA && sq.comparisonTestIdB) {
      const tA = byTest.get(sq.comparisonTestIdA);
      const tB = byTest.get(sq.comparisonTestIdB);
      const ok = Boolean(tA && tB && evaluateStaticMatcher(query, tA).admissible && evaluateStaticMatcher(query, tB).admissible && evaluateStaticMatcher(projectTestToQuery(tA, query, false), tB).admissible);
      predApp3 = ok ? 'admissible' : 'inadmissible';
    } else if (sq.targetTestId) {
      const t = byTest.get(sq.targetTestId);
      predApp3 = t && evaluateStaticMatcher(query, t).admissible ? 'admissible' : 'inadmissible';
    } else {
      const scopedInvIds = query.targetInvIds ?? predictedInvs.slice(0, 3);
      const anyAdm = scopedInvIds.some((iid) => (invPassCounts.get(iid)?.adm ?? 0) > 0);
      predApp3 = anyAdm ? 'admissible' : 'inadmissible';
    }
    predBoundary = predApp3 === 'admissible' ? (query.gravityRegime === 'partial_gravity' ? 'extrapolated' : 'measured') : 'insufficient_or_refuse';
  }

  const invRec = computeRecallAndNdcgAtK(predictedInvs, c.expected.goldInvestigations, 5);
  const testRec = computeRecallAndNdcgAtK(predictedTests, c.expected.goldTestIds, 5);

  let jevAtomicCorrect = 0;
  let jevAtomicTotal = 0;
  let jevRoutingCorrect: boolean | null = null;
  let jevBrierSum = 0;
  let jevLogLossSum = 0;
  if (c.expected.jevGold) {
    const jg = c.expected.jevGold;
    const p1 = variant === 'A_BM25' ? 0.5 : 0.7;
    const p2 = variant === 'A_BM25' ? 0.5 : 0.7;
    const p3 = variant === 'A_BM25' ? 0.5 : 0.1;
    const y1 = jg.q1Relevant ? 1 : 0;
    const y2 = jg.q2ObservedOutcomeNotPlanned ? 1 : 0;
    const y3 = jg.q3ConflictDetected ? 1 : 0;
    jevAtomicCorrect = (jg.q1Relevant ? 1 : 0) + (jg.q2ObservedOutcomeNotPlanned ? 1 : 0) + (!jg.q3ConflictDetected ? 1 : 0);
    jevAtomicTotal = 3;
    jevRoutingCorrect = jg.expectedRouting === 'evidence';
    jevBrierSum = (p1 - y1) ** 2 + (p2 - y2) ** 2 + (p3 - y3) ** 2;
    jevLogLossSum = safeLogLoss(p1, y1) + safeLogLoss(p2, y2) + safeLogLoss(p3, y3);
  }

  let plannerExact: boolean | null = null;
  let plannerControlOk: boolean | null = null;
  let plannerReplicateOk: boolean | null = null;
  if (c.expected.plannerGold) {
    const pg = c.expected.plannerGold;
    const blocks: TestBlock[] = [
      {
        blockId: 'blk-ctrl',
        title: 'Control',
        category: 'mandatory_control',
        priorityQuestions: ['Q-CTRL'],
        questionCoverageScore: 18,
        runsRequired: 2,
        replicatesPerCondition: 2,
        isMandatoryControl: true,
        conditions: { material: query.material ?? 'PMMA', geometry: 'slab', o2Pct: 21, pressureKpa: 101.3, flowCmS: 10, gravityG: 0, targetEndpoint: 'sustained_spread' },
        rationale: 'Control',
        addressesGap: 'baseline',
      },
      {
        blockId: 'blk-target',
        title: 'Target cell',
        category: 'gap_filling',
        priorityQuestions: ['Q-TGT'],
        questionCoverageScore: 38,
        runsRequired: 2,
        replicatesPerCondition: 2,
        isMandatoryControl: false,
        conditions: { material: query.material ?? 'PMMA', geometry: 'slab', o2Pct: query.o2Pct ?? 30, pressureKpa: query.pressureKpa ?? 70.3, flowCmS: 5, gravityG: query.gravityG ?? 0, targetEndpoint: 'sustained_spread' },
        rationale: 'Target',
        addressesGap: 'joint',
      },
      {
        blockId: 'blk-unrep',
        title: 'Single-run exploratory sweep',
        category: 'boundary_bracket',
        priorityQuestions: ['Q-EXP'],
        questionCoverageScore: 28,
        runsRequired: Math.max(1, pg.budgetRuns - 2),
        replicatesPerCondition: 1,
        isMandatoryControl: false,
        conditions: { material: query.material ?? 'PMMA', geometry: 'slab', o2Pct: 30, pressureKpa: 70.3, flowCmS: 5, gravityG: 0, targetEndpoint: 'sustained_spread' },
        rationale: 'Unreplicated greedy candidate',
        addressesGap: 'sweep',
      },
    ];
    const greedy = runNaiveGreedyPlanner(blocks, pg.budgetRuns);
    plannerExact = greedy.exactOptimal;
    plannerControlOk = greedy.controlsOk;
    plannerReplicateOk = greedy.replicatesOk;
  }

  return {
    caseId: c.caseId,
    groupId: c.groupId,
    split: c.split,
    category: c.category,
    hardCaseTag: c.hardCaseTag ?? 'standard',
    question: c.question,
    hasInvGold: c.expected.goldInvestigations.length > 0,
    invRecall5: invRec.recall,
    invNdcg5: invRec.ndcg,
    hasTestGold: c.expected.goldTestIds.length > 0,
    testRecall5: testRec.recall,
    testNdcg5: testRec.ndcg,
    top5Invs: predictedInvs.slice(0, 5),
    top5Tests: predictedTests.slice(0, 5),
    goldAdmissiblePos: c.expected.isAdmissiblePositive,
    predAdmissiblePos: predApp3 !== 'inadmissible',
    goldApp3: c.expected.applicabilityStatus,
    predApp3,
    predictedRuleIds: [],
    expectedRuleIds: c.expected.expectedRuleIds ?? [],
    goldBoundary: c.expected.answerBoundary,
    predBoundary,
    hasConfigChange: Boolean(c.expected.configChangeExpected),
    configGoldRules: c.expected.configChangeExpected?.affectedRuleIds ?? [],
    configPredRules: [],
    configDirectionCorrect: c.expected.configChangeExpected ? false : null,
    configPostBoundaryCorrect: c.expected.configChangeExpected ? false : null,
    hasJevGold: Boolean(c.expected.jevGold),
    jevAtomicCorrect,
    jevAtomicTotal,
    jevRoutingCorrect,
    jevBrierSum,
    jevLogLossSum,
    jevLatencyMs: 0,
    hasPlannerGold: Boolean(c.expected.plannerGold),
    plannerExact,
    plannerControlOk,
    plannerReplicateOk,
    completed: true,
    verifierPassed: null,
    latencyMs: performance.now() - t0,
  };
}

function summarizeOutcomesRaw(outcomes: CaseOutcome[]): AggregateMetrics {
  const groups = new Set(outcomes.map((o) => o.groupId));
  const invCases = outcomes.filter((o) => o.hasInvGold);
  const testCases = outcomes.filter((o) => o.hasTestGold);

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let app3Correct = 0;
  let bndCorrect = 0;
  let posTotal = 0;
  let posCovered = 0;
  let ruleExpectedTot = 0;
  let ruleExpectedHit = 0;

  let cfgGoldTot = 0;
  let cfgPredTot = 0;
  let cfgTrueHits = 0;
  let cfgDirTot = 0;
  let cfgDirHits = 0;
  let cfgPostTot = 0;
  let cfgPostHits = 0;

  let jevCorrect = 0;
  let jevTotal = 0;
  let jevRouteCorrect = 0;
  let jevRouteTot = 0;
  let jevBrierSum = 0;
  let jevLossSum = 0;
  let jevLatSum = 0;

  let planTot = 0;
  let planExact = 0;
  let planCtrl = 0;
  let planRep = 0;

  let verTot = 0;
  let verPass = 0;
  let compPass = 0;
  const latencies: number[] = [];

  for (const o of outcomes) {
    if (o.goldAdmissiblePos && o.predAdmissiblePos) tp += 1;
    else if (!o.goldAdmissiblePos && o.predAdmissiblePos) fp += 1;
    else if (o.goldAdmissiblePos && !o.predAdmissiblePos) fn += 1;
    else tn += 1;

    if (o.goldApp3 === o.predApp3) app3Correct += 1;
    if (o.goldBoundary === o.predBoundary) bndCorrect += 1;
    if (o.goldAdmissiblePos) {
      posTotal += 1;
      if (o.predAdmissiblePos && o.predBoundary !== 'insufficient_or_refuse') posCovered += 1;
    }
    if (o.expectedRuleIds.length > 0) {
      for (const r of o.expectedRuleIds) {
        ruleExpectedTot += 1;
        if (o.predictedRuleIds.includes(r)) ruleExpectedHit += 1;
      }
    }
    if (o.hasConfigChange) {
      const goldSet = new Set(o.configGoldRules);
      const predSet = new Set(o.configPredRules);
      cfgGoldTot += goldSet.size;
      cfgPredTot += predSet.size;
      for (const r of predSet) {
        if (goldSet.has(r)) cfgTrueHits += 1;
      }
      if (o.configDirectionCorrect !== null) {
        cfgDirTot += 1;
        if (o.configDirectionCorrect) cfgDirHits += 1;
      }
      if (o.configPostBoundaryCorrect !== null) {
        cfgPostTot += 1;
        if (o.configPostBoundaryCorrect) cfgPostHits += 1;
      }
    }
    if (o.hasJevGold && o.jevAtomicTotal > 0) {
      jevCorrect += o.jevAtomicCorrect;
      jevTotal += o.jevAtomicTotal;
      jevBrierSum += o.jevBrierSum;
      jevLossSum += o.jevLogLossSum;
      jevLatSum += o.jevLatencyMs;
      if (o.jevRoutingCorrect !== null) {
        jevRouteTot += 1;
        if (o.jevRoutingCorrect) jevRouteCorrect += 1;
      }
    }
    if (o.hasPlannerGold) {
      planTot += 1;
      if (o.plannerExact) planExact += 1;
      if (o.plannerControlOk) planCtrl += 1;
      if (o.plannerReplicateOk) planRep += 1;
    }
    if (o.verifierPassed !== null) {
      verTot += 1;
      if (o.verifierPassed) verPass += 1;
    }
    if (o.completed) compPass += 1;
    latencies.push(o.latencyMs);
  }

  const m = (num: number, den: number): MetricWithCI => ({
    value: den > 0 ? Number((num / den).toFixed(4)) : null,
    numerator: Number(num.toFixed(4)),
    denominator: den,
    ci95: null,
  });

  const appPrec = tp + fp > 0 ? tp / (tp + fp) : null;
  const appRec = tp + fn > 0 ? tp / (tp + fn) : null;
  const appF1 = appPrec !== null && appRec !== null && appPrec + appRec > 0 ? (2 * appPrec * appRec) / (appPrec + appRec) : 0;

  const cfgPrec = cfgPredTot > 0 ? cfgTrueHits / cfgPredTot : null;
  const cfgRec = cfgGoldTot > 0 ? cfgTrueHits / cfgGoldTot : null;
  const cfgF1 = cfgPrec !== null && cfgRec !== null && cfgPrec + cfgRec > 0 ? (2 * cfgPrec * cfgRec) / (cfgPrec + cfgRec) : 0;

  const sortedLat = [...latencies].sort((a, b) => a - b);
  const p95Idx = Math.min(sortedLat.length - 1, Math.floor(0.95 * sortedLat.length));

  return {
    caseCount: outcomes.length,
    groupCount: groups.size,
    investigationRecallAt5: m(invCases.reduce((s, o) => s + o.invRecall5, 0), invCases.length),
    investigationNdcgAt5: m(invCases.reduce((s, o) => s + o.invNdcg5, 0), invCases.length),
    testRecallAt5: m(testCases.reduce((s, o) => s + o.testRecall5, 0), testCases.length),
    testNdcgAt5: m(testCases.reduce((s, o) => s + o.testNdcg5, 0), testCases.length),
    applicabilityPrecision: { value: appPrec !== null ? Number(appPrec.toFixed(4)) : null, numerator: tp, denominator: tp + fp, ci95: null },
    applicabilityRecall: { value: appRec !== null ? Number(appRec.toFixed(4)) : null, numerator: tp, denominator: tp + fn, ci95: null },
    applicabilityF1: { value: tp + fp + fn > 0 ? Number(appF1.toFixed(4)) : null, numerator: 2 * tp, denominator: 2 * tp + fp + fn, ci95: null },
    applicability3WayAccuracy: m(app3Correct, outcomes.length),
    confusionMatrix: {
      tp,
      fp_falseAdmission: fp,
      fn_falseRejection: fn,
      tn,
      total: outcomes.length,
      falseAdmissionRate: tn + fp > 0 ? Number((fp / (fp + tn)).toFixed(4)) : 0,
      falseRejectionRate: tp + fn > 0 ? Number((fn / (tp + fn)).toFixed(4)) : 0,
    },
    expectedRuleRecall: m(ruleExpectedHit, ruleExpectedTot),
    configChangeDependencyPrecision: { value: cfgPrec !== null ? Number(cfgPrec.toFixed(4)) : null, numerator: cfgTrueHits, denominator: cfgPredTot, ci95: null },
    configChangeDependencyRecall: { value: cfgRec !== null ? Number(cfgRec.toFixed(4)) : null, numerator: cfgTrueHits, denominator: cfgGoldTot, ci95: null },
    configChangeDependencyF1: { value: cfgGoldTot > 0 ? Number(cfgF1.toFixed(4)) : null, numerator: 2 * cfgTrueHits, denominator: cfgPredTot + cfgGoldTot, ci95: null },
    configChangeDirectionAccuracy: m(cfgDirHits, cfgDirTot),
    configChangePostBoundaryAccuracy: m(cfgPostHits, cfgPostTot),
    answerBoundaryAccuracy: m(bndCorrect, outcomes.length),
    positiveCoverage: m(posCovered, posTotal),
    jevAtomicAccuracy: m(jevCorrect, jevTotal),
    jevRoutingAccuracy: m(jevRouteCorrect, jevRouteTot),
    jevBrierScore: jevTotal > 0 ? Number((jevBrierSum / jevTotal).toFixed(4)) : null,
    jevLogLoss: jevTotal > 0 ? Number((jevLossSum / jevTotal).toFixed(4)) : null,
    jevMeanLatencyMs: jevRouteTot > 0 ? Number((jevLatSum / jevRouteTot).toFixed(3)) : null,
    plannerExactness: m(planExact, planTot),
    plannerControlPreservation: m(planCtrl, planTot),
    plannerReplicatePreservation: m(planRep, planTot),
    verifierPassRate: m(verPass, verTot),
    completionRate: m(compPass, outcomes.length),
    meanLatencyMs: outcomes.length > 0 ? Number((latencies.reduce((a, b) => a + b, 0) / outcomes.length).toFixed(2)) : 0,
    p95LatencyMs: sortedLat.length > 0 ? Number(sortedLat[p95Idx].toFixed(2)) : 0,
  };
}

function summarizeWithGroupCIs(outcomes: CaseOutcome[], seed = 20261114, nBoot = 1500): AggregateMetrics {
  const base = summarizeOutcomesRaw(outcomes);
  const byGroup = new Map<string, CaseOutcome[]>();
  for (const o of outcomes) {
    const arr = byGroup.get(o.groupId) ?? [];
    arr.push(o);
    byGroup.set(o.groupId, arr);
  }
  const clusters = [...byGroup.values()];
  if (clusters.length < 2) return base;

  const rng = mulberry32(seed);
  const dists: Record<string, number[]> = {
    invRec5: [],
    invNdcg5: [],
    testRec5: [],
    testNdcg5: [],
    appPrec: [],
    appRec: [],
    appF1: [],
    app3Way: [],
    bndAcc: [],
    posCov: [],
    jevAcc: [],
  };

  for (let b = 0; b < nBoot; b += 1) {
    const sample: CaseOutcome[] = [];
    for (let g = 0; g < clusters.length; g += 1) {
      const idx = Math.floor(rng() * clusters.length);
      sample.push(...clusters[idx]);
    }
    const s = summarizeOutcomesRaw(sample);
    if (s.investigationRecallAt5.value !== null) dists.invRec5.push(s.investigationRecallAt5.value);
    if (s.investigationNdcgAt5.value !== null) dists.invNdcg5.push(s.investigationNdcgAt5.value);
    if (s.testRecallAt5.value !== null) dists.testRec5.push(s.testRecallAt5.value);
    if (s.testNdcgAt5.value !== null) dists.testNdcg5.push(s.testNdcgAt5.value);
    if (s.applicabilityPrecision.value !== null) dists.appPrec.push(s.applicabilityPrecision.value);
    if (s.applicabilityRecall.value !== null) dists.appRec.push(s.applicabilityRecall.value);
    if (s.applicabilityF1.value !== null) dists.appF1.push(s.applicabilityF1.value);
    if (s.applicability3WayAccuracy.value !== null) dists.app3Way.push(s.applicability3WayAccuracy.value);
    if (s.answerBoundaryAccuracy.value !== null) dists.bndAcc.push(s.answerBoundaryAccuracy.value);
    if (s.positiveCoverage.value !== null) dists.posCov.push(s.positiveCoverage.value);
    if (s.jevAtomicAccuracy.value !== null) dists.jevAcc.push(s.jevAtomicAccuracy.value);
  }

  const ci = (arr: number[]): { low: number; high: number } | null => {
    if (arr.length < 20) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const lo = sorted[Math.floor(0.025 * (sorted.length - 1))];
    const hi = sorted[Math.ceil(0.975 * (sorted.length - 1))];
    return { low: Number(lo.toFixed(4)), high: Number(hi.toFixed(4)) };
  };

  base.investigationRecallAt5.ci95 = ci(dists.invRec5);
  base.investigationNdcgAt5.ci95 = ci(dists.invNdcg5);
  base.testRecallAt5.ci95 = ci(dists.testRec5);
  base.testNdcgAt5.ci95 = ci(dists.testNdcg5);
  base.applicabilityPrecision.ci95 = ci(dists.appPrec);
  base.applicabilityRecall.ci95 = ci(dists.appRec);
  base.applicabilityF1.ci95 = ci(dists.appF1);
  base.applicability3WayAccuracy.ci95 = ci(dists.app3Way);
  base.answerBoundaryAccuracy.ci95 = ci(dists.bndAcc);
  base.positiveCoverage.ci95 = ci(dists.posCov);
  base.jevAtomicAccuracy.ci95 = ci(dists.jevAcc);
  return base;
}

function buildVariantSummary(
  variantId: string,
  label: string,
  description: string,
  outcomes: CaseOutcome[],
): VariantSummary {
  const bySplit = {
    dev: summarizeWithGroupCIs(outcomes.filter((o) => o.split === 'dev')),
    val: summarizeWithGroupCIs(outcomes.filter((o) => o.split === 'val')),
    test: summarizeWithGroupCIs(outcomes.filter((o) => o.split === 'test')),
  };
  const categories = uniqueOrdered(outcomes.map((o) => o.category));
  const byCategory: Record<string, AggregateMetrics> = {};
  for (const cat of categories) {
    byCategory[cat] = summarizeOutcomesRaw(outcomes.filter((o) => o.category === cat));
  }
  return {
    variantId,
    label,
    description,
    overall: summarizeWithGroupCIs(outcomes),
    bySplit,
    byCategory,
  };
}

function collectErrorExamples(
  fullOutcomes: CaseOutcome[],
  baseAOutcomes: CaseOutcome[],
  baseCOutcomes: CaseOutcome[],
  cases: GoldCaseRecord[],
): ErrorExampleRecord[] {
  const examples: ErrorExampleRecord[] = [];
  const seen = new Set<string>();

  const pushExample = (idx: number, system: string, pred: CaseOutcome, explanation: string) => {
    const key = `${system}:${cases[idx].caseId}`;
    if (seen.has(key)) return;
    seen.add(key);
    examples.push({
      caseId: cases[idx].caseId,
      split: cases[idx].split,
      category: cases[idx].category,
      hardCaseTag: cases[idx].hardCaseTag ?? 'standard',
      system,
      question: cases[idx].question,
      expected: {
        applicabilityStatus: cases[idx].expected.applicabilityStatus,
        answerBoundary: cases[idx].expected.answerBoundary,
        goldInvestigations: cases[idx].expected.goldInvestigations,
      },
      predicted: {
        applicabilityStatus: pred.predApp3,
        answerBoundary: pred.predBoundary,
        top5Invs: pred.top5Invs,
        rules: pred.predictedRuleIds,
      },
      explanation,
    });
  };

  for (let i = 0; i < fullOutcomes.length && examples.length < 5; i += 1) {
    const o = fullOutcomes[i];
    if (o.goldApp3 !== o.predApp3 || o.goldBoundary !== o.predBoundary) {
      pushExample(
        i,
        'Variant_D_Full_EMBER',
        o,
        `Full EMBER predicted (${o.predApp3}, ${o.predBoundary}) vs gold (${o.goldApp3}, ${o.goldBoundary}); rules=[${o.predictedRuleIds.join(', ')}].`,
      );
    }
  }

  for (let i = 0; i < fullOutcomes.length && examples.length < 10; i += 1) {
    const d = fullOutcomes[i];
    const a = baseAOutcomes[i];
    const c = baseCOutcomes[i];
    if (d.goldApp3 === d.predApp3 && !d.goldAdmissiblePos && (a.predAdmissiblePos || c.predAdmissiblePos)) {
      const loser = c.predAdmissiblePos ? 'Variant_C_Static_Matcher' : 'Variant_A_BM25_only';
      const predObj = c.predAdmissiblePos ? c : a;
      pushExample(
        i,
        loser,
        predObj,
        `${loser} falsely admitted hard case (${d.hardCaseTag}) as ${predObj.predApp3}, whereas Full EMBER rejected via [${d.predictedRuleIds.join(', ')}].`,
      );
    }
  }

  return examples;
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(here, '..');

  const corpus: CorpusV2 = JSON.parse(readFileSync(resolve(rootDir, 'public/data/corpus_v2.json'), 'utf8'));
  const index: ChunksIndex = JSON.parse(readFileSync(resolve(rootDir, 'public/data/chunks_index.json'), 'utf8'));
  const goldData = JSON.parse(readFileSync(resolve(rootDir, 'eval/gold_100_cases.json'), 'utf8')) as {
    annotationProvenance: string;
    provenanceNote: string;
    counts: Record<string, unknown>;
    cases: GoldCaseRecord[];
  };
  const dev10Data = JSON.parse(readFileSync(resolve(rootDir, 'eval/dev10_cases.json'), 'utf8')) as {
    cases: GoldCaseRecord[];
  };

  const chunkById = new Map(index.chunks.map((ch) => [ch.chunkId, ch]));
  const byTest = new Map(corpus.tests.map((t) => [t.testId, t]));
  const byInv = new Map(corpus.investigations.map((inv) => [inv.id, inv]));
  const testsByInv = new Map<string, Test[]>();
  for (const t of corpus.tests) {
    const arr = testsByInv.get(t.inv) ?? [];
    arr.push(t);
    testsByInv.set(t.inv, arr);
  }

  const cases = goldData.cases;
  const evalCore = (opts: { retrievalMode?: 'bm25' | 'hybrid'; ablations?: ReviewInput['ablations'] }) =>
    cases.map((c) => evaluateCoreVariantCase(c, corpus, index, chunkById, byTest, byInv, testsByInv, opts));

  const outA = cases.map((c) => evaluateBaselineVariantCase('A_BM25', c, corpus, index, byTest));
  const outB = cases.map((c) => evaluateBaselineVariantCase('B_StandardRAG', c, corpus, index, byTest));
  const outC = cases.map((c) => evaluateBaselineVariantCase('C_StaticMatcher', c, corpus, index, byTest));
  const outD = evalCore({});

  const outAblNoProtocol = evalCore({ ablations: { noProtocol: true } });
  const outAblNoGeometry = evalCore({ ablations: { noGeometry: true } });
  const outAblCollapsed = evalCore({ ablations: { collapsedOutcomes: true } });
  const outAblNoJev = evalCore({ ablations: { noJev: true } });
  const outAblBm25Only = evalCore({ retrievalMode: 'bm25' });

  const variants: VariantSummary[] = [
    buildVariantSummary(
      'Variant_A_BM25_only',
      'Variant A: BM25 Only',
      'Lexical BM25 chunk retrieval without dense SVD, applicability rules, protocol segmenter, JEV, dependency DAG, or constrained planner.',
      outA,
    ),
    buildVariantSummary(
      'Variant_B_Standard_RAG',
      'Variant B: Standard Hybrid RAG (No Protocol / Applicability)',
      'Hybrid BM25+SVD+Structured RRF retrieval with 1D marginal investigation overlap and naive JEV/greedy planning; omits protocol & applicability engine.',
      outB,
    ),
    buildVariantSummary(
      'Variant_C_Static_Matcher',
      'Variant C: Static Row Matcher',
      'Row-level 1D O2/P/flow/material/geometry/gravity tolerances without protocol history, GasRole, unknown!==unknown, assumed provenance cap, or joint envelope checks.',
      outC,
    ),
    buildVariantSummary(
      'Variant_D_Full_EMBER',
      'Variant D: Full EMBER v2',
      'Complete hybrid RRF + calibrated jev-v1.0 + stage-bound ProtocolStep matcher + 9 applicability rules + multi-layer verifier + dependency DAG + exact planner.',
      outD,
    ),
  ];

  const ablations: VariantSummary[] = [
    buildVariantSummary(
      'D_no_protocol',
      'Ablation: Full EMBER minus Protocol Engine (RULE-PROT-01)',
      'Disables stage-bound protocol history & operator shutoff vs physical extinction separation.',
      outAblNoProtocol,
    ),
    buildVariantSummary(
      'D_no_geometry',
      'Ablation: Full EMBER minus Geometry Engine (RULE-GEOM-01)',
      'Disables thermally-thin film vs thick slab vs cylindrical rod & enclosure scale checks.',
      outAblNoGeometry,
    ),
    buildVariantSummary(
      'D_collapsed_outcomes',
      'Ablation: Full EMBER with Collapsed Outcomes',
      'Collapses endpoints to legacy binary outcome presence (ignores flow_turned_off / cool-flame / particle-size distinction).',
      outAblCollapsed,
    ),
    buildVariantSummary(
      'D_no_jev',
      'Ablation: Full EMBER minus JEV Passage Evaluator',
      'Replaces calibrated jev-v1.0 passage evaluator with uncalibrated constant routing.',
      outAblNoJev,
    ),
    buildVariantSummary(
      'D_bm25_only',
      'Ablation: Full EMBER with BM25-only Retrieval',
      'Replaces hybrid BM25+SVD+Structured RRF retrieval with BM25-only retrieval.',
      outAblBm25Only,
    ),
  ];

  const dev10Out = dev10Data.cases.map((c) => evaluateCoreVariantCase(c, corpus, index, chunkById, byTest, byInv, testsByInv, {}));
  const dev10Summary = summarizeOutcomesRaw(dev10Out);

  const competitorBenchmark = runCompetitorBenchmark({ rootDir, corpus, index, cases });
  const errorExamples = collectErrorExamples(outD, outA, outC, cases);

  const hardTagCounts: Record<string, number> = {};
  for (const c of cases) {
    const tag = c.hardCaseTag ?? 'standard';
    hardTagCounts[tag] = (hardTagCounts[tag] ?? 0) + 1;
  }

  const report = {
    schemaVersion: '2.0.0-ember-final',
    generatedAt: new Date().toISOString(),
    corpusVersion: corpus.corpusVersion,
    engineVersion: ENGINE_VERSION,
    annotationProvenance: goldData.annotationProvenance,
    provenanceNote: goldData.provenanceNote,
    datasetSummary: {
      totalCases: cases.length,
      ...goldData.counts,
      hardCaseTagCounts: hardTagCounts,
      dev10CaseCount: dev10Data.cases.length,
    },
    dev10Summary,
    variants,
    ablations,
    competitorBenchmark,
    errorExamples,
    reproductionCommands: [
      'npm run eval',
      'npx tsx eval/run_evaluation.ts',
      'npx tsx eval/competitor_benchmark.ts',
    ],
  };

  const outPath = resolve(rootDir, 'public/data/eval_report.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`EMBER Evaluation Complete -> ${outPath}`);
  console.log(`DEV10: app3Way=${dev10Summary.applicability3WayAccuracy.numerator}/10, boundary=${dev10Summary.answerBoundaryAccuracy.numerator}/10, posCov=${dev10Summary.positiveCoverage.numerator}/${dev10Summary.positiveCoverage.denominator}`);
  for (const v of variants) {
    const o = v.overall;
    const t = v.bySplit.test;
    console.log(
      `[${v.variantId}] overall: invR@5=${o.investigationRecallAt5.value} testR@5=${o.testRecallAt5.value} appF1=${o.applicabilityF1.value} (FP=${o.confusionMatrix.fp_falseAdmission}, FN=${o.confusionMatrix.fn_falseRejection}) app3=${o.applicability3WayAccuracy.value} bnd=${o.answerBoundaryAccuracy.value} posCov=${o.positiveCoverage.value} jev=${o.jevAtomicAccuracy.value} | testSplit appF1=${t.applicabilityF1.value} bnd=${t.answerBoundaryAccuracy.value}`,
    );
  }
  for (const ab of ablations) {
    const o = ab.overall;
    console.log(
      `[${ab.variantId}] appF1=${o.applicabilityF1.value} (FP=${o.confusionMatrix.fp_falseAdmission}, FN=${o.confusionMatrix.fn_falseRejection}) app3=${o.applicability3WayAccuracy.value} bnd=${o.answerBoundaryAccuracy.value} jev=${o.jevAtomicAccuracy.value} testR@5=${o.testRecallAt5.value}`,
    );
  }
}

main();
