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
  { param: 'thicknessMm', ruleId: 'RULE-GEOM-01', label: 'Thickness (mm)' },
  { param: 'geometry', ruleId: 'RULE-GEOM-01', label: 'Geometry' },
  { param: 'gravityG', ruleId: 'RULE-GRAV-01', label: 'Gravity (g)' },
  { param: 'material', ruleId: 'RULE-MAT-01', label: 'Material' },
  { param: 'targetEndpoint', ruleId: 'RULE-EP-01', label: 'Target endpoint' },
];

export function buildDependencies(
  conclusions: Array<Pick<SynthesisClaimItem, 'id' | 'text'>>,
  decisions: ApplicabilityDecision[],
  query: ResearchQuery,
): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const activeTests = decisions.filter((d) => d.verdict === 'admissible' || d.verdict === 'conditional_support');
  const seedTests = activeTests.length > 0 ? activeTests : decisions.slice(0, 12);
  const affectedTestIds = seedTests.map((d) => d.testId);
  const affectedInvIds = [...new Set(seedTests.map((d) => d.inv))];

  const targetConclusions = conclusions.length > 0 ? conclusions : [{ id: 'synthesis-summary', text: 'Overall evidence boundary' }];

  for (const mapping of PARAMETER_RULE_MAP) {
    const val = query[mapping.param];
    if (val === null || val === undefined) continue;

    const failedOrCond = seedTests.filter((d) =>
      d.rules.some((r) => r.ruleId === mapping.ruleId && r.status !== 'pass'),
    );
    const anyFailed = failedOrCond.some((d) => d.rules.some((r) => r.ruleId === mapping.ruleId && r.status === 'fail'));
    const status: DependencyEdge['status'] = anyFailed ? 'invalidated' : failedOrCond.length > 0 ? 'weakened' : 'retained';

    const c = targetConclusions[0];
    edges.push({
      id: `dep-${mapping.param}-${mapping.ruleId}`,
      fromParameter: String(mapping.param),
      ruleId: mapping.ruleId,
      affectedTestIds: failedOrCond.length > 0 ? failedOrCond.map((d) => d.testId) : affectedTestIds,
      affectedInvIds: failedOrCond.length > 0 ? [...new Set(failedOrCond.map((d) => d.inv))] : affectedInvIds,
      conclusionId: c.id,
      status,
      reason:
        failedOrCond.length > 0
          ? `${mapping.label} triggers ${mapping.ruleId} caution/exclusion on ${failedOrCond.length} test(s).`
          : `${mapping.label} verified across ${affectedTestIds.length} supporting test(s) via ${mapping.ruleId}.`,
    });
  }
  return edges;
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

  const updatedEdges = buildDependencies(baseReview.synthesis.observedFact, updatedDecisions, updatedQuery);
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

    if (edge.status === 'invalidated' || (isAffectedByPatch && becameInadmissible.length > 0 && edge.status !== 'retained')) {
      const invEdge: DependencyEdge = { ...edge, status: 'invalidated' };
      invalidatedEdges.push(invEdge);
      impactChains.push({
        changedParameter: changedParams.join(', ') || edge.fromParameter,
        affectedRuleOrEvidence: `${edge.ruleId} (${edge.affectedTestIds.slice(0, 3).join(', ') || edge.affectedInvIds.join(', ')})`,
        conclusionChange: `${becameInadmissible.length} previously usable test(s) became inadmissible: ${edge.reason}`,
        severity: 'invalidated',
      });
    } else if (edge.status === 'weakened' || (isAffectedByPatch && becameConditional.length > 0)) {
      const wEdge: DependencyEdge = { ...edge, status: 'weakened' };
      weakenedEdges.push(wEdge);
      impactChains.push({
        changedParameter: changedParams.join(', ') || edge.fromParameter,
        affectedRuleOrEvidence: `${edge.ruleId} (${edge.affectedInvIds.join(', ')})`,
        conclusionChange: `Support weakened to conditional (${becameConditional.length} downgraded): ${edge.reason}`,
        severity: 'weakened',
      });
    } else {
      retainedEdges.push(edge);
      if (isAffectedByPatch) {
        const netDelta = updatedDecisions.filter((nd) => {
          const od = oldByTest.get(nd.testId);
          return od && verdictRank(nd.verdict) !== verdictRank(od.verdict);
        }).length;
        impactChains.push({
          changedParameter: changedParams.join(', ') || edge.fromParameter,
          affectedRuleOrEvidence: `${edge.ruleId}`,
          conclusionChange:
            becameAdmissible.length > 0
              ? `${becameAdmissible.length} test(s) became admissible under updated parameter.`
              : `Edge retained (${netDelta} verdict shifts across pool).`,
          severity: 'retained',
        });
      }
    }
  }

  // Ensure every changed parameter whose shifts weren't captured by an edge emits an explicit chain
  for (const param of changedParams) {
    if (!impactChains.some((c) => c.changedParameter.includes(param))) {
      const severity: ImpactChainItem['severity'] =
        becameInadmissible.length > 0 ? 'invalidated' : becameConditional.length > 0 ? 'weakened' : 'retained';
      impactChains.push({
        changedParameter: param,
        affectedRuleOrEvidence: 'Applicability pool',
        conclusionChange: `Admissible delta: +${becameAdmissible.length} admissible, +${becameConditional.length} conditional, +${becameInadmissible.length} inadmissible.`,
        severity,
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
