/**
 * Common-Data capability benchmark & Whole-Product scope comparison for EMBER v2
 * against external Space Apps peer systems (FlameBound, MicroFire Atlas, Fotia, HEARTH).
 *
 * Epistemic discipline:
 * - Never fabricates execution metrics for external systems absent from the local workspace.
 * - Classifies every (system, caseId) pair explicitly into one of:
 *   'evaluated' | 'outside_claimed_scope' | 'not_run' | 'runtime_error' | 'ambiguous_gold'.
 * - Optional external endpoints/CLIs can be bound via environment variables
 *   (COMPETITOR_FLAMEBOUND_CMD, COMPETITOR_MICROFIRE_ATLAS_CMD, COMPETITOR_FOTIA_CMD, COMPETITOR_HEARTH_CMD).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENGINE_VERSION,
  determineAnswerBoundary,
  evaluateApplicability,
  evaluateStaticMatcher,
  parseResearchQuery,
  rankInvestigationsV2,
  recalculateDesignVariant,
  runReviewSync,
  searchBm25,
  searchHybrid,
  type ChunksIndex,
  type CorpusV2,
  type DesignVariantPatch,
  type DesignVariantResult,
  type ResearchQuery,
  type Review,
  type ReviewInput,
} from '../src/core/index.ts';

export type BenchmarkCaseStatus =
  | 'evaluated'
  | 'outside_claimed_scope'
  | 'not_run'
  | 'runtime_error'
  | 'ambiguous_gold';

export type BenchmarkCategory =
  | 'investigation_selection'
  | 'summary'
  | 'comparability'
  | 'protocol_outcome'
  | 'config_change'
  | 'insufficient_or_invalid_premise'
  | 'full_review';

export interface GoldCaseRecord {
  caseId: string;
  groupId: string;
  split: 'dev' | 'val' | 'test';
  category: BenchmarkCategory;
  hardCaseTag?: string;
  question: string;
  structuredQuery: {
    missionId?: string | null;
    habitableEnvironment?: string | null;
    safetyTask?: string | null;
    targetEndpoint?: ResearchQuery['targetEndpoint'];
    fuelPhase?: ResearchQuery['fuelPhase'];
    material?: string | null;
    geometry?: string | null;
    thicknessMm?: number | null;
    diameterMm?: number | null;
    o2Pct?: number | null;
    o2Role?: ResearchQuery['o2Role'] | null;
    pressureKpa?: number | null;
    flowCmS?: number | [number, number] | null;
    flowDirection?: ResearchQuery['flowDirection'];
    flowHistory?: ResearchQuery['flowHistory'];
    gravityG?: number | null;
    gravityMode?: ResearchQuery['requestedMode'] | null;
    diluent?: string | null;
    comparisonTestIdA?: string | null;
    comparisonTestIdB?: string | null;
    targetTestId?: string | null;
    variantPatch?: Record<string, unknown> | null;
    budgetRuns?: number | null;
  };
  referencedTestIds?: string[];
  referencedInvestigations?: string[];
  expected: {
    goldInvestigations: string[];
    goldTestIds: string[];
    applicabilityStatus: 'admissible' | 'conditional' | 'inadmissible';
    isAdmissiblePositive: boolean;
    expectedRuleIds?: string[];
    answerBoundary: 'measured' | 'extrapolated' | 'insufficient_or_refuse';
    configChangeExpected?: {
      changedParameter: string;
      affectedRuleIds: string[];
      expectedDirection: 'invalidated' | 'weakened' | 'strengthened' | 'retained';
      expectedBoundaryAfterChange: 'measured' | 'extrapolated' | 'insufficient_or_refuse';
    };
    jevGold?: {
      targetClaimId: string;
      q1Relevant: boolean;
      q2ObservedOutcomeNotPlanned: boolean;
      q3ConflictDetected: boolean;
      expectedRouting: 'evidence' | 'context' | 'conflict';
    };
    plannerGold?: {
      budgetRuns: number;
      mustIncludeControl: boolean;
      mustPreserveReplicates: boolean;
    };
  };
}

export interface CapabilityAxisSpec {
  id: string;
  label: string;
  emberSupported: boolean;
  competitorClaimedScope: Record<'FlameBound' | 'MicroFire Atlas' | 'Fotia' | 'HEARTH', 'in_scope_external' | 'partial_scope' | 'outside_claimed_scope'>;
  evidenceNote: string;
}

export interface CompetitorSystemSpec {
  systemId: 'EMBER_v2' | 'FlameBound' | 'MicroFire Atlas' | 'Fotia' | 'HEARTH';
  displayName: string;
  kind: 'local_evaluated_engine' | 'external_peer_system';
  archetypeDescription: string;
  localArtifactPresent: boolean;
  envCmdVar: string | null;
  claimedInScopeCategories: BenchmarkCategory[];
  outsideScopeReasons: Partial<Record<BenchmarkCategory, string>>;
}

export interface PerCaseCompetitorRecord {
  caseId: string;
  category: BenchmarkCategory;
  hardCaseTag: string | null;
  status: BenchmarkCaseStatus;
  scopeReason: string;
  applicabilityCorrect: boolean | null;
  boundaryCorrect: boolean | null;
  latencyMs: number | null;
  errorMessage: string | null;
}

export interface CompetitorSystemSummary {
  systemId: string;
  displayName: string;
  kind: 'local_evaluated_engine' | 'external_peer_system' | 'common_data_proxy_baseline';
  totalCases: number;
  statusCounts: Record<BenchmarkCaseStatus, number>;
  evaluatedAccuracy: {
    applicability3Way: { value: number | null; numerator: number; denominator: number };
    positiveCoverage: { value: number | null; numerator: number; denominator: number };
    falseAdmissionRate: { value: number | null; numerator: number; denominator: number };
    answerBoundaryAccuracy: { value: number | null; numerator: number; denominator: number };
  };
  meanLatencyMs: number | null;
  executionNote: string;
  perCase: PerCaseCompetitorRecord[];
}

export interface CompetitorBenchmarkReport {
  schemaVersion: string;
  generatedAt: string;
  corpusVersion: string;
  engineVersion: string;
  totalCases: number;
  capabilityMatrix: CapabilityAxisSpec[];
  wholeProductSystems: CompetitorSystemSummary[];
  commonDataExecutedComparison: CompetitorSystemSummary[];
  epistemicHonestyStatement: string;
}

const CAPABILITY_MATRIX: CapabilityAxisSpec[] = [
  {
    id: 'psi_discovery',
    label: 'Multi-investigation PSI discovery & metadata filtering',
    emberSupported: true,
    competitorClaimedScope: {
      FlameBound: 'in_scope_external',
      'MicroFire Atlas': 'in_scope_external',
      Fotia: 'in_scope_external',
      HEARTH: 'in_scope_external',
    },
    evidenceNote: 'Standard PSI exploration workflow shared across hackathon submissions; only EMBER v2 has executable local adapter unless external CLI env hooks are provided.',
  },
  {
    id: 'stage_protocol',
    label: 'Stage-bound protocol segment matching (operator shutoff vs physical extinction, cool flame)',
    emberSupported: true,
    competitorClaimedScope: {
      FlameBound: 'outside_claimed_scope',
      'MicroFire Atlas': 'outside_claimed_scope',
      Fotia: 'outside_claimed_scope',
      HEARTH: 'outside_claimed_scope',
    },
    evidenceNote: 'Requires row-level ProtocolSteps + Events separating initial spread from flow_shutoff/cool-flame stages.',
  },
  {
    id: 'gas_role_isolation',
    label: 'Mandatory GasRole separation (ambient cabin vs oxidizer_stream inverse burner O2)',
    emberSupported: true,
    competitorClaimedScope: {
      FlameBound: 'outside_claimed_scope',
      'MicroFire Atlas': 'partial_scope',
      Fotia: 'outside_claimed_scope',
      HEARTH: 'outside_claimed_scope',
    },
    evidenceNote: 'Prevents ACME-CFI-G 85% O2 burner stream data from validating ambient cabin atmospheres.',
  },
  {
    id: 'partial_g_gate',
    label: 'Gravity mode separation (actual_flight vs simulated_analogue E-FIELD vs 1g)',
    emberSupported: true,
    competitorClaimedScope: {
      FlameBound: 'partial_scope',
      'MicroFire Atlas': 'partial_scope',
      Fotia: 'outside_claimed_scope',
      HEARTH: 'partial_scope',
    },
    evidenceNote: 'Enforces explicit zero partial-g PSI coverage and blocks ACME E-FIELD lunar transfer claims.',
  },
  {
    id: 'joint_envelope',
    label: 'Joint multi-dimensional (O2, P, flow) coverage vs 1D marginal range warning',
    emberSupported: true,
    competitorClaimedScope: {
      FlameBound: 'outside_claimed_scope',
      'MicroFire Atlas': 'outside_claimed_scope',
      Fotia: 'outside_claimed_scope',
      HEARTH: 'outside_claimed_scope',
    },
    evidenceNote: 'Detects empty multi-dimensional regions inside overlapping 1D min/max parameter bounds.',
  },
  {
    id: 'unknown_not_equal',
    label: 'RULE-UNK-01 strict unknown !== unknown discipline',
    emberSupported: true,
    competitorClaimedScope: {
      FlameBound: 'outside_claimed_scope',
      'MicroFire Atlas': 'outside_claimed_scope',
      Fotia: 'outside_claimed_scope',
      HEARTH: 'outside_claimed_scope',
    },
    evidenceNote: 'Prevents null-null test fields (e.g., Saffire-III S1 vs S2, unknown thickness) from falsely matching.',
  },
  {
    id: 'conflict_preserving_jev',
    label: 'Calibrated atomic JEV conflict-preserving passage routing (jev-v1.0)',
    emberSupported: true,
    competitorClaimedScope: {
      FlameBound: 'outside_claimed_scope',
      'MicroFire Atlas': 'outside_claimed_scope',
      Fotia: 'partial_scope',
      HEARTH: 'outside_claimed_scope',
    },
    evidenceNote: 'Evaluates Q1/Q2/Q3 separately with calibrated probabilities and never drops contradictions.',
  },
  {
    id: 'config_dependency_dag',
    label: 'Live design-variant dependency DAG recalculation (thickness/flow/atmosphere)',
    emberSupported: true,
    competitorClaimedScope: {
      FlameBound: 'outside_claimed_scope',
      'MicroFire Atlas': 'outside_claimed_scope',
      Fotia: 'outside_claimed_scope',
      HEARTH: 'outside_claimed_scope',
    },
    evidenceNote: 'Propagates parameter patches across rules to emit retained/weakened/invalidated edges and impact chains.',
  },
  {
    id: 'exact_test_planner',
    label: 'Exact branch-and-bound test programme planner preserving controls & replicates',
    emberSupported: true,
    competitorClaimedScope: {
      FlameBound: 'outside_claimed_scope',
      'MicroFire Atlas': 'outside_claimed_scope',
      Fotia: 'outside_claimed_scope',
      HEARTH: 'partial_scope',
    },
    evidenceNote: 'Optimizes coverage score under mandatory control and >=2 replicate constraints.',
  },
  {
    id: 'domain_gated_predictor',
    label: 'Group-CV domain-gated single-endpoint numeric predictor',
    emberSupported: true,
    competitorClaimedScope: {
      FlameBound: 'partial_scope',
      'MicroFire Atlas': 'outside_claimed_scope',
      Fotia: 'outside_claimed_scope',
      HEARTH: 'partial_scope',
    },
    evidenceNote: 'Refuses out-of-domain or below-baseline numeric predictions instead of extrapolating unconstrained.',
  },
];

const EXTERNAL_SPECS: CompetitorSystemSpec[] = [
  {
    systemId: 'FlameBound',
    displayName: 'FlameBound',
    kind: 'external_peer_system',
    archetypeDescription: 'External NASA Space Apps flammability-envelope threshold screening concept (no local artifact in workspace).',
    localArtifactPresent: false,
    envCmdVar: 'COMPETITOR_FLAMEBOUND_CMD',
    claimedInScopeCategories: ['investigation_selection', 'summary', 'insufficient_or_invalid_premise'],
    outsideScopeReasons: {
      comparability: 'No stage-bound pairwise comparability, operator-shutoff vs physical extinction separation, or unknown!==unknown rule.',
      protocol_outcome: 'Does not parse stage-bound ProtocolSteps or separate cool-flame segment 2 continuation.',
      config_change: 'Does not maintain a rule dependency DAG for live design-variant recalculation.',
      full_review: 'Does not combine conflict-preserving JEV, dependency propagation, and exact replicate-preserving planner.',
    },
  },
  {
    systemId: 'MicroFire Atlas',
    displayName: 'MicroFire Atlas',
    kind: 'external_peer_system',
    archetypeDescription: 'External NASA Space Apps interactive PSI experiment atlas & faceted explorer concept (no local artifact in workspace).',
    localArtifactPresent: false,
    envCmdVar: 'COMPETITOR_MICROFIRE_ATLAS_CMD',
    claimedInScopeCategories: ['investigation_selection', 'summary'],
    outsideScopeReasons: {
      comparability: 'Faceted atlas filters single rows without pairwise protocol-history or unknown!==unknown enforcement.',
      protocol_outcome: 'Exploratory summary view without stage-level flow_turned_off vs extinguished_at_reduced_flow matching.',
      config_change: 'No causal rule dependency graph or variant impact-chain recalculation.',
      insufficient_or_invalid_premise: 'No formal answer-boundary refusal engine gating planned_only or oxidizer_stream premises.',
      full_review: 'Does not integrate verification checks or constrained experiment optimization.',
    },
  },
  {
    systemId: 'Fotia',
    displayName: 'Fotia',
    kind: 'external_peer_system',
    archetypeDescription: 'External NASA Space Apps RAG-oriented fire-safety Q&A assistant concept (no local artifact in workspace).',
    localArtifactPresent: false,
    envCmdVar: 'COMPETITOR_FOTIA_CMD',
    claimedInScopeCategories: ['investigation_selection', 'summary', 'insufficient_or_invalid_premise'],
    outsideScopeReasons: {
      comparability: 'Unstructured RAG synthesis lacks formal pairwise admissibility rules across test tables.',
      protocol_outcome: 'No programmatic ProtocolStep intervention parser distinguishing FT vs SE or cool flames.',
      config_change: 'No deterministic rule dependency graph recalculating on structured parameter patches.',
      full_review: 'No exact branch-and-bound test-programme planner or domain-gated grouped-CV numeric model.',
    },
  },
  {
    systemId: 'HEARTH',
    displayName: 'HEARTH',
    kind: 'external_peer_system',
    archetypeDescription: 'External NASA Space Apps habitat atmosphere & spacecraft fire-risk planner concept (no local artifact in workspace).',
    localArtifactPresent: false,
    envCmdVar: 'COMPETITOR_HEARTH_CMD',
    claimedInScopeCategories: ['investigation_selection', 'summary', 'insufficient_or_invalid_premise'],
    outsideScopeReasons: {
      comparability: 'Habitat-level screening does not enforce test-level protocol-segment or unknown!==unknown comparability.',
      protocol_outcome: 'Does not isolate stage-bound protocol interventions (flow_shutoff, n2_jet_applied, cool-flame step).',
      config_change: 'Does not expose rule-level dependency chains across geometry/protocol/joint envelopes.',
      full_review: 'Lacks exact constrained test-programme branch-and-bound optimizer with replicate guarantees and verified PSI synthesis.',
    },
  },
];

export function mapStructuredQueryOverrides(sq: GoldCaseRecord['structuredQuery']): Partial<ResearchQuery> {
  const ov: Partial<ResearchQuery> = {};
  if (sq.habitableEnvironment) ov.habitableEnvironment = sq.habitableEnvironment as ResearchQuery['habitableEnvironment'];
  if (sq.safetyTask) {
    ov.safetyTask = (sq.safetyTask === 'smoke_point' ? 'general_comparison' : sq.safetyTask) as ResearchQuery['safetyTask'];
  }
  if (sq.targetEndpoint !== undefined && sq.targetEndpoint !== null) ov.targetEndpoint = sq.targetEndpoint;
  if (sq.fuelPhase !== undefined && sq.fuelPhase !== null) ov.fuelPhase = sq.fuelPhase;
  if (sq.material !== undefined && sq.material !== null) ov.material = sq.material;
  if (sq.geometry !== undefined && sq.geometry !== null) ov.geometry = sq.geometry;
  if (sq.thicknessMm !== undefined && sq.thicknessMm !== null) ov.thicknessMm = sq.thicknessMm;
  if (sq.diameterMm !== undefined && sq.diameterMm !== null) ov.diameterMm = sq.diameterMm;
  if (sq.o2Pct !== undefined && sq.o2Pct !== null) ov.o2Pct = sq.o2Pct;
  if (sq.o2Role !== undefined && sq.o2Role !== null) ov.o2Role = sq.o2Role;
  if (sq.pressureKpa !== undefined && sq.pressureKpa !== null) ov.pressureKpa = sq.pressureKpa;
  if (sq.flowCmS !== undefined && sq.flowCmS !== null) ov.flowCmS = sq.flowCmS;
  if (sq.flowDirection !== undefined && sq.flowDirection !== null) ov.flowDirection = sq.flowDirection;
  if (sq.flowHistory !== undefined && sq.flowHistory !== null) ov.flowHistory = sq.flowHistory;
  if (sq.gravityG !== undefined && sq.gravityG !== null) ov.gravityG = sq.gravityG;
  if (sq.gravityMode !== undefined && sq.gravityMode !== null) ov.requestedMode = sq.gravityMode;
  return ov;
}

export function mapVariantPatch(raw: Record<string, unknown> | null | undefined): DesignVariantPatch {
  if (!raw) return {};
  const patch: DesignVariantPatch = {};
  if ('thicknessMm' in raw) patch.thicknessMm = raw.thicknessMm as number | null;
  if ('geometry' in raw) patch.geometry = raw.geometry as string | null;
  if ('flowDirection' in raw) patch.flowDirection = raw.flowDirection as DesignVariantPatch['flowDirection'];
  if ('flowCmS' in raw) patch.flowCmS = raw.flowCmS as number | [number, number] | null;
  if ('o2Pct' in raw) patch.o2Pct = raw.o2Pct as number | null;
  if ('pressureKpa' in raw) patch.pressureKpa = raw.pressureKpa as number | null;
  if ('gravityG' in raw) patch.gravityG = raw.gravityG as number | null;
  if ('material' in raw) patch.material = raw.material as string | null;
  if ('o2Role' in raw) patch.o2Role = raw.o2Role as DesignVariantPatch['o2Role'];
  if ('targetEndpoint' in raw) patch.targetEndpoint = raw.targetEndpoint as DesignVariantPatch['targetEndpoint'];
  if ('enclosureScale' in raw) patch.enclosureScale = raw.enclosureScale as DesignVariantPatch['enclosureScale'];
  return patch;
}

export function applyConfigChangeForEval(
  review: Review,
  patchRaw: Record<string, unknown> | null | undefined,
  corpus: CorpusV2,
  ablations?: ReviewInput['ablations'],
): { dv: DesignVariantResult; effectiveReview: Review; patch: DesignVariantPatch } {
  const patch = mapVariantPatch(patchRaw);
  const dv = recalculateDesignVariant(review, patch, corpus);
  const hasAppAblation = Boolean(ablations?.noProtocol || ablations?.noGeometry || ablations?.collapsedOutcomes);
  let postRankings = dv.updatedRankings;
  let postDecisions = dv.updatedDecisions;
  if (hasAppAblation) {
    const byInv = new Map(corpus.investigations.map((i) => [i.id, i]));
    const testsByInv = new Map<string, CorpusV2['tests']>();
    for (const t of corpus.tests) {
      const arr = testsByInv.get(t.inv);
      if (arr) arr.push(t);
      else testsByInv.set(t.inv, [t]);
    }
    postRankings = rankInvestigationsV2(dv.updatedQuery, corpus, { ablations });
    postDecisions = corpus.tests.map((t) =>
      evaluateApplicability(dv.updatedQuery, t, {
        investigation: byInv.get(t.inv),
        allInvTests: testsByInv.get(t.inv),
        ablations,
      }),
    );
  }
  const postPkg = {
    ...review.evidencePackage,
    query: dv.updatedQuery,
    applicabilityDecisions: postDecisions,
    rankings: postRankings,
  };
  const postBoundaryRaw = determineAnswerBoundary(postPkg);
  const effectiveReview: Review = {
    ...review,
    query: dv.updatedQuery,
    evidencePackage: postPkg,
    synthesis: { ...review.synthesis, answerBoundary: postBoundaryRaw },
  };
  return { dv, effectiveReview, patch };
}

export function mapSynthesisBoundaryToGold(b: string): 'measured' | 'extrapolated' | 'insufficient_or_refuse' {
  if (b === 'sufficient_observed') return 'measured';
  if (b === 'conditional_or_partial') return 'extrapolated';
  return 'insufficient_or_refuse';
}

function emptyStatusCounts(): Record<BenchmarkCaseStatus, number> {
  return {
    evaluated: 0,
    outside_claimed_scope: 0,
    not_run: 0,
    runtime_error: 0,
    ambiguous_gold: 0,
  };
}

function validateCaseGold(c: GoldCaseRecord): string | null {
  if (!c.expected || !c.expected.applicabilityStatus || !c.expected.answerBoundary) {
    return 'Missing expected applicabilityStatus or answerBoundary.';
  }
  return null;
}

function evaluateEmberCaseForCompetitorSuite(
  c: GoldCaseRecord,
  corpus: CorpusV2,
  index: ChunksIndex,
): PerCaseCompetitorRecord {
  const goldIssue = validateCaseGold(c);
  if (goldIssue) {
    return {
      caseId: c.caseId,
      category: c.category,
      hardCaseTag: c.hardCaseTag ?? null,
      status: 'ambiguous_gold',
      scopeReason: goldIssue,
      applicabilityCorrect: null,
      boundaryCorrect: null,
      latencyMs: null,
      errorMessage: null,
    };
  }
  try {
    const t0 = performance.now();
    const review = runReviewSync({
      question: c.question,
      overrides: mapStructuredQueryOverrides(c.structuredQuery),
      corpus,
      index,
      budgetRuns: c.structuredQuery.budgetRuns ?? c.expected.plannerGold?.budgetRuns ?? 6,
    });
    const effectiveReview = c.expected.configChangeExpected
      ? applyConfigChangeForEval(review, c.structuredQuery.variantPatch, corpus).effectiveReview
      : review;
    const verdict = inferCaseApplicabilityVerdict(c, effectiveReview, corpus);
    const predBoundary = mapSynthesisBoundaryToGold(effectiveReview.synthesis.answerBoundary);
    const latencyMs = Number((performance.now() - t0).toFixed(2));
    return {
      caseId: c.caseId,
      category: c.category,
      hardCaseTag: c.hardCaseTag ?? null,
      status: 'evaluated',
      scopeReason: 'Executed live against src/core/ runReviewSync + applicability engine.',
      applicabilityCorrect: verdict === c.expected.applicabilityStatus,
      boundaryCorrect: predBoundary === c.expected.answerBoundary,
      latencyMs,
      errorMessage: null,
    };
  } catch (err) {
    return {
      caseId: c.caseId,
      category: c.category,
      hardCaseTag: c.hardCaseTag ?? null,
      status: 'runtime_error',
      scopeReason: 'Execution error in local engine.',
      applicabilityCorrect: null,
      boundaryCorrect: null,
      latencyMs: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

export function inferCaseApplicabilityVerdict(
  c: GoldCaseRecord,
  review: ReturnType<typeof runReviewSync>,
  corpus: CorpusV2,
): 'admissible' | 'conditional' | 'inadmissible' {
  if (review.synthesis.answerBoundary === 'invalid_premise') return 'inadmissible';

  const byTest = new Map(corpus.tests.map((t) => [t.testId, t]));
  const byInv = new Map(corpus.investigations.map((i) => [i.id, i]));
  const testsByInv = new Map<string, CorpusV2['tests']>();
  for (const t of corpus.tests) {
    const arr = testsByInv.get(t.inv) ?? [];
    arr.push(t);
    testsByInv.set(t.inv, arr);
  }

  const evalSingle = (testId: string) => {
    const t = byTest.get(testId);
    if (!t) return null;
    const dec = review.evidencePackage.applicabilityDecisions.find((d) => d.testId === testId);
    if (dec) return dec;
    return evaluateApplicability(review.query, t, {
      investigation: byInv.get(t.inv),
      allInvTests: testsByInv.get(t.inv),
    });
  };

  const sq = c.structuredQuery;
  if (sq.comparisonTestIdA && sq.comparisonTestIdB) {
    const decA = evalSingle(sq.comparisonTestIdA);
    const decB = evalSingle(sq.comparisonTestIdB);
    const tA = byTest.get(sq.comparisonTestIdA);
    const tB = byTest.get(sq.comparisonTestIdB);
    if (!decA || !decB || !tA || !tB) return 'inadmissible';
    if (decA.verdict === 'inadmissible' || decB.verdict === 'inadmissible') return 'inadmissible';
    if (decA.verdict === 'planned_only' || decB.verdict === 'planned_only') return 'inadmissible';
    if (decA.protocolMatch.operatorTerminated !== decB.protocolMatch.operatorTerminated) return 'inadmissible';
    const refQuery: ResearchQuery = {
      ...review.query,
      material: tA.fuel ?? review.query.material,
      fuelPhase: tA.fuelPhase ?? review.query.fuelPhase,
      geometry: tA.geometry ?? review.query.geometry,
      thicknessMm: tA.thicknessMm.value,
      diameterMm: tA.diameterMm.value,
      o2Pct: tA.atmosphere.o2.value,
      o2Role: (tA.atmosphere.o2.role as ResearchQuery['o2Role']) ?? review.query.o2Role,
      pressureKpa: tA.atmosphere.pressure.value,
      flowDirection: tA.flow.direction !== 'unknown' ? tA.flow.direction : review.query.flowDirection,
      flowHistory: tA.flow.history !== 'unknown' ? tA.flow.history : review.query.flowHistory,
      gravityG: tA.gravity.gravityG.value,
      gravityRegime: tA.gravity.regime,
    };
    const pairAB = evaluateApplicability(refQuery, tB, {
      investigation: byInv.get(tB.inv),
      allInvTests: testsByInv.get(tB.inv),
    });
    if (pairAB.verdict === 'inadmissible' || pairAB.verdict === 'planned_only') return 'inadmissible';
    if (
      decA.verdict === 'conditional_support' ||
      decB.verdict === 'conditional_support' ||
      pairAB.verdict === 'conditional_support'
    ) {
      return 'conditional';
    }
    return 'admissible';
  }

  if (sq.targetTestId) {
    const dec = evalSingle(sq.targetTestId);
    if (!dec) return 'inadmissible';
    if (dec.verdict === 'admissible') return 'admissible';
    if (dec.verdict === 'conditional_support') return 'conditional';
    return 'inadmissible';
  }

  const scopedRanks = review.query.targetInvIds?.length
    ? review.evidencePackage.rankings.filter((r) => review.query.targetInvIds!.includes(r.inv.id))
    : review.evidencePackage.rankings.slice(0, 3);

  if (scopedRanks.some((r) => r.status === 'admissible')) return 'admissible';
  if (scopedRanks.some((r) => r.status === 'conditional_support')) return 'conditional';
  return 'inadmissible';
}

function summarizePerCase(
  systemId: string,
  displayName: string,
  kind: CompetitorSystemSummary['kind'],
  executionNote: string,
  cases: GoldCaseRecord[],
  perCase: PerCaseCompetitorRecord[],
): CompetitorSystemSummary {
  const statusCounts = emptyStatusCounts();
  let appCorrect = 0;
  let bndCorrect = 0;
  let evalCount = 0;
  let posTotal = 0;
  let posCovered = 0;
  let negTotal = 0;
  let falseAdm = 0;
  const latencies: number[] = [];

  for (let i = 0; i < perCase.length; i += 1) {
    const rec = perCase[i];
    const gold = cases[i];
    statusCounts[rec.status] += 1;
    if (rec.status !== 'evaluated') continue;
    evalCount += 1;
    if (rec.latencyMs !== null) latencies.push(rec.latencyMs);
    if (rec.applicabilityCorrect) appCorrect += 1;
    if (rec.boundaryCorrect) bndCorrect += 1;

    if (gold.expected.isAdmissiblePositive) {
      posTotal += 1;
      if (rec.applicabilityCorrect || rec.boundaryCorrect) {
        posCovered += 1;
      }
    } else {
      negTotal += 1;
      if (rec.applicabilityCorrect === false) falseAdm += 1;
    }
  }

  return {
    systemId,
    displayName,
    kind,
    totalCases: cases.length,
    statusCounts,
    evaluatedAccuracy: {
      applicability3Way: {
        value: evalCount > 0 ? Number((appCorrect / evalCount).toFixed(4)) : null,
        numerator: appCorrect,
        denominator: evalCount,
      },
      positiveCoverage: {
        value: evalCount > 0 && posTotal > 0 ? Number((posCovered / posTotal).toFixed(4)) : null,
        numerator: posCovered,
        denominator: evalCount > 0 ? posTotal : 0,
      },
      falseAdmissionRate: {
        value: evalCount > 0 && negTotal > 0 ? Number((falseAdm / negTotal).toFixed(4)) : null,
        numerator: falseAdm,
        denominator: evalCount > 0 ? negTotal : 0,
      },
      answerBoundaryAccuracy: {
        value: evalCount > 0 ? Number((bndCorrect / evalCount).toFixed(4)) : null,
        numerator: bndCorrect,
        denominator: evalCount,
      },
    },
    meanLatencyMs: latencies.length > 0 ? Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)) : null,
    executionNote,
    perCase,
  };
}

function tryRunExternalHook(cmd: string, c: GoldCaseRecord): PerCaseCompetitorRecord | null {
  try {
    const t0 = performance.now();
    const out = execFileSync(cmd, [JSON.stringify({ caseId: c.caseId, question: c.question, structuredQuery: c.structuredQuery })], {
      encoding: 'utf8',
      timeout: 15000,
    });
    const parsed = JSON.parse(out) as { applicabilityStatus?: string; answerBoundary?: string };
    return {
      caseId: c.caseId,
      category: c.category,
      hardCaseTag: c.hardCaseTag ?? null,
      status: 'evaluated',
      scopeReason: `Executed external adapter hook (${cmd}).`,
      applicabilityCorrect: parsed.applicabilityStatus ? parsed.applicabilityStatus === c.expected.applicabilityStatus : null,
      boundaryCorrect: parsed.answerBoundary ? parsed.answerBoundary === c.expected.answerBoundary : null,
      latencyMs: Number((performance.now() - t0).toFixed(2)),
      errorMessage: null,
    };
  } catch (err) {
    return {
      caseId: c.caseId,
      category: c.category,
      hardCaseTag: c.hardCaseTag ?? null,
      status: 'runtime_error',
      scopeReason: `External hook failed (${cmd}).`,
      applicabilityCorrect: null,
      boundaryCorrect: null,
      latencyMs: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

function evaluateExternalPeerSystem(spec: CompetitorSystemSpec, cases: GoldCaseRecord[]): CompetitorSystemSummary {
  const hookCmd = spec.envCmdVar ? process.env[spec.envCmdVar] : undefined;
  const perCase: PerCaseCompetitorRecord[] = cases.map((c) => {
    const goldIssue = validateCaseGold(c);
    if (goldIssue) {
      return {
        caseId: c.caseId,
        category: c.category,
        hardCaseTag: c.hardCaseTag ?? null,
        status: 'ambiguous_gold',
        scopeReason: goldIssue,
        applicabilityCorrect: null,
        boundaryCorrect: null,
        latencyMs: null,
        errorMessage: null,
      };
    }

    const outReason = spec.outsideScopeReasons[c.category];
    const isHardOutOfScope =
      Boolean(outReason) ||
      (c.hardCaseTag !== undefined &&
        c.hardCaseTag !== 'standard' &&
        c.hardCaseTag !== 'positive_admissible_control' &&
        !spec.claimedInScopeCategories.includes(c.category));

    if (outReason || isHardOutOfScope) {
      return {
        caseId: c.caseId,
        category: c.category,
        hardCaseTag: c.hardCaseTag ?? null,
        status: 'outside_claimed_scope',
        scopeReason: outReason ?? `Hard-case check (${c.hardCaseTag}) lies outside ${spec.displayName} documented capabilities.`,
        applicabilityCorrect: null,
        boundaryCorrect: null,
        latencyMs: null,
        errorMessage: null,
      };
    }

    if (hookCmd) {
      const hookResult = tryRunExternalHook(hookCmd, c);
      if (hookResult) return hookResult;
    }

    return {
      caseId: c.caseId,
      category: c.category,
      hardCaseTag: c.hardCaseTag ?? null,
      status: 'not_run',
      scopeReason: `In nominal scope (${c.category}), but no local executable or ${spec.envCmdVar} hook is present in workspace.`,
      applicabilityCorrect: null,
      boundaryCorrect: null,
      latencyMs: null,
      errorMessage: null,
    };
  });

  const note = hookCmd
    ? `External hook ${hookCmd} configured for in-scope cases.`
    : `Not executed locally: ${spec.displayName} binary/endpoint not present in repository; metrics not fabricated (status=not_run / outside_claimed_scope).`;

  return summarizePerCase(spec.systemId, spec.displayName, 'external_peer_system', note, cases, perCase);
}

function evaluateCommonDataProxyAdapter(
  adapterId: 'BM25_CommonData_Adapter' | 'RAG_CommonData_Adapter' | 'StaticMatcher_CommonData_Adapter',
  displayName: string,
  cases: GoldCaseRecord[],
  corpus: CorpusV2,
  index: ChunksIndex,
): CompetitorSystemSummary {
  const byTest = new Map(corpus.tests.map((t) => [t.testId, t]));
  const perCase: PerCaseCompetitorRecord[] = cases.map((c) => {
    const t0 = performance.now();
    const q = parseResearchQuery(c.question, mapStructuredQueryOverrides(c.structuredQuery));

    let predApp: 'admissible' | 'conditional' | 'inadmissible' = 'inadmissible';
    let predBnd: 'measured' | 'extrapolated' | 'insufficient_or_refuse' = 'insufficient_or_refuse';

    if (adapterId === 'BM25_CommonData_Adapter') {
      const hits = searchBm25(index, c.question, 10);
      if (hits.length > 0 && hits[0].score > 0) {
        predApp = 'admissible';
        predBnd = 'measured';
      }
    } else if (adapterId === 'RAG_CommonData_Adapter') {
      const hits = searchHybrid(corpus, index, q, { mode: 'hybrid', k: 12 });
      const topInvs = new Set(hits.map((h) => h.chunk.inv).filter(Boolean));
      const invMatch = corpus.investigations.some((inv) => {
        if (!topInvs.has(inv.id)) return false;
        const o2Ok =
          q.o2Pct === null ||
          !inv.conditions?.o2Pct ||
          (q.o2Pct >= inv.conditions.o2Pct[0] - 1 && q.o2Pct <= inv.conditions.o2Pct[1] + 1);
        const pOk =
          q.pressureKpa === null ||
          !inv.conditions?.pressureKpa ||
          (q.pressureKpa >= inv.conditions.pressureKpa[0] - 5 && q.pressureKpa <= inv.conditions.pressureKpa[1] + 5);
        return o2Ok && pOk;
      });
      if (hits.length > 0 && invMatch) {
        predApp = 'admissible';
        predBnd = q.gravityRegime === 'partial_gravity' ? 'extrapolated' : 'measured';
      }
    } else {
      const sq = c.structuredQuery;
      const targetIds = [sq.comparisonTestIdA, sq.comparisonTestIdB, sq.targetTestId].filter((x): x is string => Boolean(x));
      if (targetIds.length > 0) {
        const allOk = targetIds.every((id) => {
          const t = byTest.get(id);
          return t ? evaluateStaticMatcher(q, t).admissible : false;
        });
        predApp = allOk ? 'admissible' : 'inadmissible';
        predBnd = allOk ? (q.gravityRegime === 'partial_gravity' ? 'extrapolated' : 'measured') : 'insufficient_or_refuse';
      } else {
        const matches = corpus.tests.filter((t) => evaluateStaticMatcher(q, t).admissible);
        predApp = matches.length > 0 ? 'admissible' : 'inadmissible';
        predBnd = matches.length > 0 ? (q.gravityRegime === 'partial_gravity' ? 'extrapolated' : 'measured') : 'insufficient_or_refuse';
      }
    }

    return {
      caseId: c.caseId,
      category: c.category,
      hardCaseTag: c.hardCaseTag ?? null,
      status: 'evaluated',
      scopeReason: `Executed Common-Data capability adapter (${adapterId}) on corpus_v2.json.`,
      applicabilityCorrect: predApp === c.expected.applicabilityStatus,
      boundaryCorrect: predBnd === c.expected.answerBoundary,
      latencyMs: Number((performance.now() - t0).toFixed(2)),
      errorMessage: null,
    };
  });

  return summarizePerCase(
    adapterId,
    displayName,
    'common_data_proxy_baseline',
    `Executable Common-Data capability adapter running on identical NASA PSI corpus_v2.json (${cases.length} cases).`,
    cases,
    perCase,
  );
}

export function runCompetitorBenchmark(opts?: {
  rootDir?: string;
  corpus?: CorpusV2;
  index?: ChunksIndex;
  cases?: GoldCaseRecord[];
}): CompetitorBenchmarkReport {
  const here = dirname(fileURLToPath(import.meta.url));
  const rootDir = opts?.rootDir ?? resolve(here, '..');
  const corpus: CorpusV2 = opts?.corpus ?? JSON.parse(readFileSync(resolve(rootDir, 'public/data/corpus_v2.json'), 'utf8'));
  const index: ChunksIndex = opts?.index ?? JSON.parse(readFileSync(resolve(rootDir, 'public/data/chunks_index.json'), 'utf8'));
  const goldFile = JSON.parse(readFileSync(resolve(rootDir, 'eval/gold_100_cases.json'), 'utf8')) as { cases: GoldCaseRecord[] };
  const cases = opts?.cases ?? goldFile.cases;

  const emberPerCase = cases.map((c) => evaluateEmberCaseForCompetitorSuite(c, corpus, index));
  const emberSummary = summarizePerCase(
    'EMBER_v2',
    'EMBER v2 (Full Protocol & Applicability Engine)',
    'local_evaluated_engine',
    `Executed locally via src/core/ runReviewSync + evaluateApplicability on corpus_v2.json (${cases.length} cases).`,
    cases,
    emberPerCase,
  );

  const externalSummaries = EXTERNAL_SPECS.map((spec) => evaluateExternalPeerSystem(spec, cases));
  const commonDataProxies = [
    emberSummary,
    evaluateCommonDataProxyAdapter('BM25_CommonData_Adapter', 'Common-Data Adapter: BM25 Lexical Search', cases, corpus, index),
    evaluateCommonDataProxyAdapter('RAG_CommonData_Adapter', 'Common-Data Adapter: Standard Hybrid RAG (1D Ranges)', cases, corpus, index),
    evaluateCommonDataProxyAdapter('StaticMatcher_CommonData_Adapter', 'Common-Data Adapter: Static Row Matcher', cases, corpus, index),
  ];

  return {
    schemaVersion: '2.0.0-ember-final',
    generatedAt: new Date().toISOString(),
    corpusVersion: corpus.corpusVersion,
    engineVersion: ENGINE_VERSION,
    totalCases: cases.length,
    capabilityMatrix: CAPABILITY_MATRIX,
    wholeProductSystems: [emberSummary, ...externalSummaries],
    commonDataExecutedComparison: commonDataProxies,
    epistemicHonestyStatement:
      'External peer systems (FlameBound, MicroFire Atlas, Fotia, HEARTH) have no executable artifacts inside this workspace and therefore report 0 fabricated runs (classified as outside_claimed_scope or not_run unless external CLI hooks are configured). Quantitative cross-system deltas on identical NASA PSI data are reported strictly from executable Common-Data capability adapters alongside EMBER v2.',
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(here, '..');
  const report = runCompetitorBenchmark({ rootDir });

  const reportPath = resolve(rootDir, 'public/data/eval_report.json');
  mkdirSync(dirname(reportPath), { recursive: true });
  let merged: Record<string, unknown> = {};
  if (existsSync(reportPath)) {
    try {
      merged = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, unknown>;
    } catch {
      merged = {};
    }
  }
  merged.competitorBenchmark = report;
  writeFileSync(reportPath, JSON.stringify(merged, null, 2));

  console.log(`Competitor benchmark complete (${report.totalCases} cases).`);
  for (const s of report.wholeProductSystems) {
    console.log(
      `[WholeProduct] ${s.systemId}: evaluated=${s.statusCounts.evaluated}, outside_scope=${s.statusCounts.outside_claimed_scope}, not_run=${s.statusCounts.not_run}, app3Way=${s.evaluatedAccuracy.applicability3Way.value}`,
    );
  }
  for (const c of report.commonDataExecutedComparison) {
    console.log(
      `[CommonData] ${c.systemId}: app3Way=${c.evaluatedAccuracy.applicability3Way.numerator}/${c.evaluatedAccuracy.applicability3Way.denominator} (${c.evaluatedAccuracy.applicability3Way.value}), boundary=${c.evaluatedAccuracy.answerBoundaryAccuracy.value}, falseAdm=${c.evaluatedAccuracy.falseAdmissionRate.numerator}/${c.evaluatedAccuracy.falseAdmissionRate.denominator}`,
    );
  }
}
