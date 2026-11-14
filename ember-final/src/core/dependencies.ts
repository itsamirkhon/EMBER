/**
 * Dependency graph builder and live design-variant recalculation engine.
 * Tracks which conclusions and rules depend on thickness, flow direction, O2, pressure, and gravity,
 * and recalculates retained/weakened/invalidated edges + causal impact chains on parameter edits.
 */
import { evaluateApplicability, rankInvestigationsV2 } from './applicability';
import { normalizeGravityRegime } from './queryParser';
import type {
  ApplicabilityDecision,
  CorpusV2,
  ChunkRecord,
  DependencyEdge,
  DesignVariantPatch,
  DesignVariantResult,
  ImpactChainItem,
  InvestigationRankV2,
  ResearchQuery,
  Review,
  RuleId,
  SynthesisClaimItem,
  Test,
} from './types';

const reviewCorpusRegistry = new WeakMap<object, CorpusV2>();

export function registerReviewCorpus(reviewOrPackage: object, corpus: CorpusV2): void {
  reviewCorpusRegistry.set(reviewOrPackage, corpus);
}

const PARAMETER_RULE_MAP: Array<{ param: keyof ResearchQuery; ruleId: RuleId; label: string }> = [
  { param: 'o2Pct', ruleId: 'RULE-JOINT-01', label: 'O2%' },
  { param: 'o2Role', ruleId: 'RULE-GAS-01', label: 'O2 gas role' },
  { param: 'pressureKpa', ruleId: 'RULE-JOINT-01', label: 'Pressure (kPa)' },
  { param: 'flowCmS', ruleId: 'RULE-JOINT-01', label: 'Flow velocity (cm/s)' },
  { param: 'flowDirection', ruleId: 'RULE-PROT-01', label: 'Flow direction' },
  { param: 'flowHistory', ruleId: 'RULE-PROT-01', label: 'Flow history' },
  { param: 'enclosureScale', ruleId: 'RULE-GEOM-01', label: 'Enclosure scale' },
  { param: 'thicknessMm', ruleId: 'RULE-GEOM-01', label: 'Thickness (mm)' },
  { param: 'geometry', ruleId: 'RULE-GEOM-01', label: 'Geometry' },
  { param: 'gravityG', ruleId: 'RULE-GRAV-01', label: 'Gravity (g)' },
  { param: 'material', ruleId: 'RULE-MAT-01', label: 'Material' },
  { param: 'targetEndpoint', ruleId: 'RULE-EP-01', label: 'Target endpoint' },
];

export function buildDependencies(
  conclusions: Array<Pick<SynthesisClaimItem, 'id' | 'text'> & Partial<Pick<SynthesisClaimItem, 'citations'>>>,
  decisions: ApplicabilityDecision[],
  query: ResearchQuery,
  chunks: Array<Pick<ChunkRecord, 'chunkId' | 'testId' | 'inv'>> = [],
): DependencyEdge[] {
  const decisionById = new Map(decisions.map((decision) => [decision.testId, decision]));
  const chunkById = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  return conclusions.flatMap((conclusion) => {
    const citedTestIds = new Set<string>();
    let unresolved = !(conclusion.citations?.length);
    for (const citation of conclusion.citations ?? []) {
      const testId = decisionById.has(citation) ? citation : chunkById.get(citation)?.testId;
      if (testId && decisionById.has(testId)) citedTestIds.add(testId);
      else unresolved = true;
    }
    const scoped = [...citedTestIds].map((id) => decisionById.get(id)!);
    return PARAMETER_RULE_MAP.filter((mapping) => query[mapping.param] !== null && query[mapping.param] !== undefined)
      .map((mapping): DependencyEdge => {
        const rules = scoped.flatMap((decision) => decision.rules.filter((rule) => rule.ruleId === mapping.ruleId));
        const failed = rules.some((rule) => rule.status === 'fail');
        const incomplete = unresolved || scoped.length === 0 || rules.length !== scoped.length;
        const status = failed ? 'invalidated' : incomplete || rules.some((rule) => rule.status === 'conditional') ? 'weakened' : 'retained';
        return {
          id: `dep-${conclusion.id}-${mapping.param}-${mapping.ruleId}`,
          fromParameter: String(mapping.param),
          ruleId: mapping.ruleId,
          affectedTestIds: scoped.map((decision) => decision.testId),
          affectedInvIds: [...new Set(scoped.map((decision) => decision.inv))],
          conclusionId: conclusion.id,
          status,
          reason: incomplete
            ? `${conclusion.id}: unresolved or no cited test-level support; ${mapping.label} transfer remains unverified.`
            : `${conclusion.id}: ${mapping.label} ${status} for its ${scoped.length} cited test(s) via ${mapping.ruleId}. ${rules.map((rule) => rule.reason).join(' ')}`,
        };
      });
  });
}

function applyVariantPatch(baseQuery: ResearchQuery, patch: DesignVariantPatch): {
  updatedQuery: ResearchQuery;
  changedParams: string[];
} {
  const changedParams: string[] = [];
  const next: ResearchQuery = {
    ...baseQuery,
    unknownFields: [...baseQuery.unknownFields],
    validationWarnings: [...baseQuery.validationWarnings],
  };

  const assign = <K extends keyof DesignVariantPatch & keyof ResearchQuery>(key: K) => {
    if (patch[key] !== undefined && JSON.stringify(patch[key]) !== JSON.stringify(baseQuery[key])) {
      (next as unknown as Record<string, unknown>)[key] = patch[key];
      changedParams.push(String(key));
      if (patch[key] !== null) {
        next.unknownFields = next.unknownFields.filter((f) => f !== String(key));
      } else if (!next.unknownFields.includes(String(key))) {
        next.unknownFields.push(String(key));
      }
    }
  };

  assign('thicknessMm');
  assign('flowDirection');
  assign('flowCmS');
  assign('o2Pct');
  assign('pressureKpa');
  assign('gravityG');
  assign('material');
  assign('geometry');
  assign('o2Role');
  assign('targetEndpoint');
  assign('enclosureScale');

  if (patch.gravityG !== undefined) {
    next.gravityRegime = normalizeGravityRegime(patch.gravityG);
    if (next.gravityRegime === 'partial_gravity' && !next.validationWarnings.some((w) => w.includes('partial-gravity'))) {
      next.validationWarnings.push('Updated gravity enters partial-gravity regime with no flight PSI data.');
    }
  }
  return { updatedQuery: next, changedParams };
}

function verdictRank(v: ApplicabilityDecision['verdict']): number {
  if (v === 'admissible') return 3;
  if (v === 'conditional_support') return 2;
  if (v === 'planned_only') return 1;
  return 0;
}

export function recalculateDesignVariant(
  baseReview: Review,
  variantPatch: DesignVariantPatch,
  corpusOverride?: CorpusV2,
): DesignVariantResult {
  const corpus =
    corpusOverride ??
    reviewCorpusRegistry.get(baseReview) ??
    reviewCorpusRegistry.get(baseReview.evidencePackage);

  const testsPool: Test[] = corpus?.tests ?? baseReview.evidencePackage.evaluatedTests ?? [];
  const invsPool = corpus?.investigations ?? baseReview.evidencePackage.rankings.map((r) => r.inv);
  const invMap = new Map(invsPool.map((i) => [i.id, i]));
  const testsByInv = new Map<string, Test[]>();
  for (const t of testsPool) {
    const arr = testsByInv.get(t.inv);
    if (arr) arr.push(t);
    else testsByInv.set(t.inv, [t]);
  }

  const { updatedQuery, changedParams } = applyVariantPatch(baseReview.query, variantPatch);

  const updatedDecisions: ApplicabilityDecision[] = testsPool.map((t) =>
    evaluateApplicability(updatedQuery, t, {
      investigation: invMap.get(t.inv),
      allInvTests: testsByInv.get(t.inv),
    }),
  );

  const synthCorpus: CorpusV2 = corpus ?? {
    corpusVersion: baseReview.envelope.corpusVersion,
    generatedAt: baseReview.envelope.timestamp,
    investigations: invsPool,
    tests: testsPool,
    claims: [],
    missions: [],
    earth: [],
    history: [],
    sources: [],
    extractionEval: {},
    outcomeAudit: {},
  };

  const updatedRankings: InvestigationRankV2[] = rankInvestigationsV2(updatedQuery, synthCorpus);

  const oldByTest = new Map(baseReview.evidencePackage.applicabilityDecisions.map((d) => [d.testId, d]));
  const becameAdmissible: string[] = [];
  const becameConditional: string[] = [];
  const becameInadmissible: string[] = [];

  for (const nd of updatedDecisions) {
    const od = oldByTest.get(nd.testId);
    if (!od || od.verdict === nd.verdict) continue;
    if (nd.verdict === 'admissible') becameAdmissible.push(nd.testId);
    else if (nd.verdict === 'conditional_support') becameConditional.push(nd.testId);
    else if (nd.verdict === 'inadmissible') becameInadmissible.push(nd.testId);
  }

  const updatedEdges = buildDependencies(
    [...baseReview.synthesis.observedFact, ...baseReview.synthesis.authorInterpretation, ...baseReview.synthesis.engineeringImplication],
    updatedDecisions,
    updatedQuery,
    baseReview.evidencePackage.retrievedHits.map((hit) => hit.chunk),
  );
  // Clearing a condition removes transfer knowledge, not the trace explaining its loss.
  const clearedParameters = changedParams.filter((parameter) => updatedQuery[parameter as keyof ResearchQuery] === null);
  if (clearedParameters.length > 0) {
    const previousEdges = buildDependencies(
      [...baseReview.synthesis.observedFact, ...baseReview.synthesis.authorInterpretation, ...baseReview.synthesis.engineeringImplication],
      updatedDecisions,
      baseReview.query,
      baseReview.evidencePackage.retrievedHits.map((hit) => hit.chunk),
    );
    updatedEdges.push(...previousEdges.filter((edge) => clearedParameters.includes(edge.fromParameter)).map((edge): DependencyEdge => ({
      ...edge,
      status: 'weakened',
      reason: `${edge.conclusionId}: ${edge.fromParameter} was cleared; transfer support for an unspecified condition is unresolved. Historical observations remain unchanged.`,
    })));
  }
  const retainedEdges: DependencyEdge[] = [];
  const weakenedEdges: DependencyEdge[] = [];
  const invalidatedEdges: DependencyEdge[] = [];
  const impactChains: ImpactChainItem[] = [];

  for (const edge of updatedEdges) {
    const isAffectedByPatch = changedParams.some(
      (p) =>
        p === edge.fromParameter ||
        (p === 'gravityG' && edge.ruleId === 'RULE-GRAV-01') ||
        (p === 'thicknessMm' && edge.ruleId === 'RULE-GEOM-01') ||
        (p === 'flowDirection' && edge.ruleId === 'RULE-PROT-01') ||
        ((p === 'o2Pct' || p === 'pressureKpa' || p === 'flowCmS') && edge.ruleId === 'RULE-JOINT-01'),
    );

    const scoped = updatedDecisions.filter((decision) => edge.affectedTestIds.includes(decision.testId));
    const shifted = scoped.filter((decision) => {
      const old = oldByTest.get(decision.testId);
      return old && verdictRank(old.verdict) !== verdictRank(decision.verdict);
    });
    if (edge.status === 'invalidated') invalidatedEdges.push(edge);
    else if (edge.status === 'weakened') weakenedEdges.push(edge);
    else retainedEdges.push(edge);
    if (isAffectedByPatch) {
      impactChains.push({
        changedParameter: changedParams.filter((param) => param === edge.fromParameter || PARAMETER_RULE_MAP.some((mapping) => mapping.param === param && mapping.ruleId === edge.ruleId)).join(', '),
        affectedRuleOrEvidence: `${edge.ruleId} (${edge.affectedTestIds.join(', ') || 'unresolved evidence'})`,
        conclusionChange: `${edge.conclusionId}: applicability ${edge.status}; ${shifted.length} cited test verdict(s) changed. ${edge.reason} This revises transfer support, not the historical observation.`,
        severity: edge.status,
      });
    }
  }

  return {
    baseQuery: baseReview.query,
    updatedQuery,
    patch: variantPatch,
    retainedEdges,
    weakenedEdges,
    invalidatedEdges,
    impactChains,
    updatedDecisions,
    updatedRankings,
    verdictDelta: {
      becameAdmissible,
      becameConditional,
      becameInadmissible,
    },
  };
}
