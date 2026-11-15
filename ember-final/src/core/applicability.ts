import {compareTests} from './comparison';
import {normalizeMaterialName} from './materials';
export {normalizeMaterialName} from './materials';
/**
 * Applicability engine:
 * 1. Baseline C: evaluateStaticMatcher(query, test) — naive row-level check without protocol/provenance/joint checks.
 * 2. Full EMBER: evaluateApplicability(query, test, opts) — 9 scientific admissibility rules.
 * 3. buildContrasts(...) — descriptive side-by-side contrasts with explicit causal warnings.
 * 4. rankInvestigationsV2(...) — separates relevanceScore, applicabilityScore, and evidenceQualityScore.
 */
import { matchProtocolSegment } from './protocol';
import type {
  ApplicabilityDecision,
  ApplicabilityVerdict,
  ComparisonResult,
  CorpusV2,
  EnclosureScale,
  Investigation,
  InvestigationRankV2,
  MatchedProtocolSegment,
  ResearchQuery,
  RuleEvaluation,
  Test,
} from './types';

const JOINT_SCALES = { o2Pct: 3, pressureKpa: 15, flowCmS: 8 } as const;
const JOINT_IN_DOMAIN_THRESHOLD = 1.5;

export interface ApplicabilityOptions {
  investigation?: Investigation;
  allInvTests?: Test[];
  ablations?: {
    noProtocol?: boolean;
    noGeometry?: boolean;
    collapsedOutcomes?: boolean;
  };
}


export function materialsCompatible(qMat: string | null, tMat: string | null): boolean {
  if (!qMat) return true;
  if (!tMat) return false;
  const a = normalizeMaterialName(qMat);
  const b = normalizeMaterialName(tMat);
  if (a === b) return true;
  if (a === 'n-alkane' && (b === 'n-dodecane' || b === 'heptane' || b === 'dodecane-blend')) return true;
  if (a === 'n-dodecane' && b === 'dodecane-blend') return true;
  return false;
}

export type GeometryRegime =
  | 'thin_film'
  | 'intermediate_slab'
  | 'thick_slab'
  | 'rod_cylinder'
  | 'fabric'
  | 'droplet'
  | 'burner_jet'
  | 'unknown';

export function classifyGeometryRegime(
  geometry: string | null,
  thicknessMm: number | null,
  diameterMm: number | null,
  fuelPhase: string | null,
): GeometryRegime {
  const g = (geometry ?? '').toLowerCase();
  if (/droplet/.test(g) || fuelPhase === 'liquid') return 'droplet';
  if (/burner|jet|nozzle/.test(g) || fuelPhase === 'gas') return 'burner_jet';
  if (/rod|cylinder|sphere|candle/.test(g)) return 'rod_cylinder';
  if (/fabric|sibal|nomex/.test(g)) return 'fabric';
  if (thicknessMm !== null) {
    if (thicknessMm <= 0.5) return 'thin_film';
    if (thicknessMm < 2.0) return 'intermediate_slab';
    return 'thick_slab';
  }
  if (/thin\s*film|\bfilm\b/.test(g)) return 'thin_film';
  if (/slab|sheet/.test(g)) return 'intermediate_slab';
  if (diameterMm !== null && fuelPhase === 'solid') return 'rod_cylinder';
  return 'unknown';
}

export function inferTestEnclosureScale(test: Test): EnclosureScale {
  if (/^saffire/i.test(test.inv)) return 'large_enclosure';
  if (/^(bass|bass-ii|spice|slice)$/i.test(test.inv)) return 'small_duct';
  return 'chamber';
}

function gapToValue(qv: number | [number, number], tv: number): number {
  if (Array.isArray(qv)) {
    const lo = Math.min(qv[0], qv[1]);
    const hi = Math.max(qv[0], qv[1]);
    if (tv < lo) return lo - tv;
    if (tv > hi) return tv - hi;
    return 0;
  }
  return Math.abs(qv - tv);
}

/** Normalized units added for a dimension the test does not report: unknown is not "near". */
const JOINT_UNKNOWN_PENALTY = 1;

function testJointDistance(query: ResearchQuery, test: Test): number | null {
  const diffs: number[] = [];
  let known = 0;
  if (query.o2Pct !== null) {
    const tv = test.atmosphere.o2.value;
    if (tv === null) diffs.push(JOINT_UNKNOWN_PENALTY);
    else {
      known += 1;
      diffs.push((query.o2Pct - tv) / JOINT_SCALES.o2Pct);
    }
  }
  if (query.pressureKpa !== null) {
    const tv = test.atmosphere.pressure.value;
    if (tv === null) diffs.push(JOINT_UNKNOWN_PENALTY);
    else {
      known += 1;
      diffs.push((query.pressureKpa - tv) / JOINT_SCALES.pressureKpa);
    }
  }
  if (query.flowCmS !== null) {
    const flows: number[] = [];
    if (test.flow.initialFlowCmS.value !== null) flows.push(test.flow.initialFlowCmS.value);
    if (test.flow.sequenceCmS) flows.push(...test.flow.sequenceCmS);
    if (flows.length === 0) diffs.push(JOINT_UNKNOWN_PENALTY);
    else {
      known += 1;
      const minFlowGap = Math.min(...flows.map((f) => gapToValue(query.flowCmS!, f)));
      diffs.push(minFlowGap / JOINT_SCALES.flowCmS);
    }
  }
  if (diffs.length === 0) return 0;
  // No reported condition at all: the distance is undefined, not small.
  if (known === 0) return null;
  return Math.sqrt(diffs.reduce((s, z) => s + z * z, 0));
}

function checkRuleEp01(query: ResearchQuery, test: Test, collapsedOutcomes: boolean): RuleEvaluation {
  if (collapsedOutcomes) {
    const hasAnyOutcome = test.initialOutcome !== 'unknown' || test.spreadRateMmS.value !== null || test.burningRateMm2S.value !== null;
    return hasAnyOutcome
      ? { ruleId: 'RULE-EP-01', status: 'pass', reason: 'Collapsed outcome available.' }
      : { ruleId: 'RULE-EP-01', status: 'fail', reason: 'No outcome recorded.' };
  }
  if (query.targetEndpoint === 'smoke_particle_size' || (query.targetEndpoint === null && query.safetyTask === 'smoke_detection')) {
    return test.particleSizeNm.value !== null || test.events.some((e) => e.endpoint === 'smoke_particle_size')
      ? { ruleId: 'RULE-EP-01', status: 'pass', reason: 'Reports smoke particle size.' }
      : { ruleId: 'RULE-EP-01', status: 'fail', reason: 'Does not measure smoke particle size.' };
  }
  if (query.targetEndpoint === 'smoke_point_length') {
    return test.smokePointLengthMm.value !== null || test.events.some((e) => e.endpoint === 'smoke_point_length')
      ? { ruleId: 'RULE-EP-01', status: 'pass', reason: 'Reports smoke-point flame length.' }
      : { ruleId: 'RULE-EP-01', status: 'fail', reason: 'Does not measure smoke-point length.' };
  }
  if (query.targetEndpoint === 'burning_rate_constant') {
    return test.burningRateMm2S.value !== null || test.events.some((e) => e.endpoint === 'burning_rate_constant')
      ? { ruleId: 'RULE-EP-01', status: 'pass', reason: 'Reports droplet burning-rate constant.' }
      : { ruleId: 'RULE-EP-01', status: 'fail', reason: 'Does not measure droplet burning-rate constant.' };
  }
  if (test.initialOutcome === 'not_applicable') {
    return { ruleId: 'RULE-EP-01', status: 'fail', reason: 'Test is marked not_applicable for flammability endpoints.' };
  }
  if ((test.inv === 'SAME' || test.inv === 'SAME-R') && query.safetyTask !== 'smoke_detection') {
    return {
      ruleId: 'RULE-EP-01',
      status: 'fail',
      reason: 'SAME/SAME-R heated samples below ignition for smoke particle sizing (not flammability/ignition).',
    };
  }
  if (test.initialOutcome === 'unknown' && test.events.length === 0) {
    return { ruleId: 'RULE-EP-01', status: 'fail', reason: 'No observed endpoint outcome recorded.' };
  }
  return { ruleId: 'RULE-EP-01', status: 'pass', reason: 'Endpoint compatible with test observations.' };
}

function checkRuleMat01(query: ResearchQuery, test: Test): RuleEvaluation {
  if (query.fuelPhase && test.fuelPhase && query.fuelPhase !== test.fuelPhase) {
    return {
      ruleId: 'RULE-MAT-01',
      status: 'fail',
      reason: `Fuel phase mismatch: query requires ${query.fuelPhase}, test uses ${test.fuelPhase}.`,
    };
  }
  if (query.material && !materialsCompatible(query.material, test.fuel)) {
    return {
      ruleId: 'RULE-MAT-01',
      status: 'fail',
      reason: `Material mismatch: query specifies ${query.material}, test used ${test.fuel ?? 'unknown'}.`,
    };
  }
  if (query.material && normalizeMaterialName(query.material) === 'n-dodecane' && normalizeMaterialName(test.fuel) === 'dodecane-blend') {
    return {
      ruleId: 'RULE-MAT-01',
      status: 'conditional',
      reason: `Blend caveat: test used ${test.fuel} rather than pure ${query.material}.`,
    };
  }
  return { ruleId: 'RULE-MAT-01', status: 'pass', reason: 'Fuel phase and material compatible.' };
}

function checkRuleGeom01(query: ResearchQuery, test: Test, noGeometry: boolean): RuleEvaluation {
  if (noGeometry) {
    return { ruleId: 'RULE-GEOM-01', status: 'pass', reason: 'Geometry rule ablated.' };
  }
  const qRegime = classifyGeometryRegime(query.geometry, query.thicknessMm, query.diameterMm, query.fuelPhase);
  const tRegime = classifyGeometryRegime(test.geometry, test.thicknessMm.value, test.diameterMm.value, test.fuelPhase);

  if (qRegime !== 'unknown' && tRegime !== 'unknown' && qRegime !== tRegime) {
    return {
      ruleId: 'RULE-GEOM-01',
      status: 'fail',
      reason: `Geometry/thickness regime mismatch: query is ${qRegime}, test is ${tRegime}.`,
    };
  }
  if (query.thicknessMm !== null && test.thicknessMm.value !== null) {
    const ratio = Math.max(query.thicknessMm, test.thicknessMm.value) / Math.max(1e-6, Math.min(query.thicknessMm, test.thicknessMm.value));
    if (ratio > 2.0) {
      return {
        ruleId: 'RULE-GEOM-01',
        status: 'conditional',
        reason: `Thickness differs (${query.thicknessMm} mm vs ${test.thicknessMm.value} mm) within regime.`,
      };
    }
  }
  const tScale = inferTestEnclosureScale(test);
  if (query.enclosureScale === 'large_enclosure' && tScale === 'small_duct' && /saffire|cygnus/i.test(query.rawQuestion)) {
    return {
      ruleId: 'RULE-GEOM-01',
      status: 'conditional',
      reason: 'Enclosure scale difference: small MSG flow duct vs large Cygnus spacecraft enclosure.',
    };
  }
  return { ruleId: 'RULE-GEOM-01', status: 'pass', reason: 'Geometry and thickness regime compatible.' };
}

function checkRuleUnk01(query: ResearchQuery, test: Test): RuleEvaluation {
  const failIssues: string[] = [];
  const condIssues: string[] = [];

  const o2Unknown = test.atmosphere.o2.value === null || test.atmosphere.o2.provenance === 'unknown';
  const pUnknown = test.atmosphere.pressure.value === null || test.atmosphere.pressure.provenance === 'unknown';
  const isPlanarSolid =
    test.fuelPhase === 'solid' &&
    test.diameterMm.value === null &&
    !/rod|cylinder|sphere|candle/i.test(test.geometry ?? '');
  const thickUnknown = isPlanarSolid && (test.thicknessMm.value === null || test.thicknessMm.provenance === 'unknown');

  if (query.o2Pct !== null && o2Unknown) failIssues.push('O2% unknown in test vs known query');
  if (query.pressureKpa !== null && pUnknown) condIssues.push('pressure unknown in test vs known query');
  if (query.thicknessMm !== null && thickUnknown) failIssues.push('thickness unknown in test vs known query (unknown !== unknown)');

  if (query.o2Pct === null && o2Unknown) {
    if (pUnknown) failIssues.push('O2% and pressure both unknown in query and test (unknown !== unknown)');
    else condIssues.push('O2% unknown in both query and test (unknown !== unknown)');
  } else if (query.pressureKpa === null && pUnknown) {
    condIssues.push('pressure unknown in both query and test (unknown !== unknown)');
  }
  if (query.thicknessMm === null && thickUnknown) {
    condIssues.push('thickness unknown in both query and solid test (unknown !== unknown)');
  }

  if (failIssues.length > 0) {
    return {
      ruleId: 'RULE-UNK-01',
      status: 'fail',
      reason: `RULE-UNK-01 (unknown !== unknown): ${[...failIssues, ...condIssues].join('; ')}.`,
    };
  }
  if (condIssues.length > 0) {
    return {
      ruleId: 'RULE-UNK-01',
      status: 'conditional',
      reason: `RULE-UNK-01 (unknown !== unknown): ${condIssues.join('; ')}.`,
    };
  }
  return { ruleId: 'RULE-UNK-01', status: 'pass', reason: 'Required parameters documented.' };
}

function checkRuleGasAndProv(query: ResearchQuery, test: Test): RuleEvaluation[] {
  const o2Role = test.atmosphere.o2.role ?? 'ambient';
  const gasRule: RuleEvaluation =
    o2Role !== query.o2Role
      ? {
          ruleId: 'RULE-GAS-01',
          status: 'fail',
          reason: `Gas role incompatibility: test O2 is ${o2Role}, query requires ${query.o2Role}.`,
        }
      : { ruleId: 'RULE-GAS-01', status: 'pass', reason: `Gas role matches (${o2Role}).` };

  const assumedDims: string[] = [];
  if (test.atmosphere.o2.provenance === 'assumed') assumedDims.push('O2');
  if (test.atmosphere.pressure.provenance === 'assumed') assumedDims.push('pressure');
  if (test.flow.initialFlowCmS.provenance === 'assumed') assumedDims.push('flow');

  const provRule: RuleEvaluation =
    assumedDims.length > 0
      ? {
          ruleId: 'RULE-PROV-01',
          status: 'conditional',
          reason: `Assumed provenance on ${assumedDims.join(', ')} caps support at conditional_support.`,
        }
      : { ruleId: 'RULE-PROV-01', status: 'pass', reason: 'Condition provenance is reported or series-level.' };

  return [gasRule, provRule];
}

function checkRuleGrav01(query: ResearchQuery, test: Test): RuleEvaluation {
  if (test.gravity.mode === 'simulated_analogue') {
    return {
      ruleId: 'RULE-GRAV-01',
      status: 'fail',
      reason: 'Simulated electric-field analogue (ACME-E-FIELD) cannot validate actual flight or partial-gravity cabin flammability.',
    };
  }
  if (query.gravityRegime === 'partial_gravity' && test.gravity.regime !== 'partial_gravity') {
    return {
      ruleId: 'RULE-GRAV-01',
      status: 'conditional',
      reason: `Gravity gap: query is partial_gravity (${query.gravityG ?? 'lunar/Mars'} g), test is ${test.gravity.regime} (${test.gravity.mode}).`,
    };
  }
  if (query.gravityRegime && query.gravityRegime !== test.gravity.regime) {
    return {
      ruleId: 'RULE-GRAV-01',
      status: 'fail',
      reason: `Gravity regime mismatch: query is ${query.gravityRegime}, test is ${test.gravity.regime}.`,
    };
  }
  return { ruleId: 'RULE-GRAV-01', status: 'pass', reason: `Gravity regime matches (${test.gravity.regime}, ${test.gravity.mode}).` };
}

function checkRuleProt01(
  query: ResearchQuery,
  test: Test,
  protocolMatch: MatchedProtocolSegment,
  noProtocol: boolean,
): RuleEvaluation {
  if (noProtocol) {
    return { ruleId: 'RULE-PROT-01', status: 'pass', reason: 'Protocol rule ablated.' };
  }
  if (!protocolMatch.endpointMatched) {
    return {
      ruleId: 'RULE-PROT-01',
      status: 'fail',
      reason: protocolMatch.operatorTerminated
        ? 'Operator termination (flow_turned_off / FT) is not physical extinction.'
        : `Protocol segments/events do not match endpoint ${query.targetEndpoint ?? 'requested'}.`,
    };
  }
  if (query.flowDirection && test.flow.direction !== 'unknown' && query.flowDirection !== test.flow.direction) {
    return {
      ruleId: 'RULE-PROT-01',
      status: 'fail',
      reason: `Flow direction mismatch: query requires ${query.flowDirection}, test used ${test.flow.direction}.`,
    };
  }
  if (protocolMatch.flowHistoryMismatch || (protocolMatch.coolFlamePresent && query.targetEndpoint === 'hot_flame_extinction')) {
    return {
      ruleId: 'RULE-PROT-01',
      status: 'conditional',
      reason: protocolMatch.warnings.join(' '),
    };
  }
  return { ruleId: 'RULE-PROT-01', status: 'pass', reason: 'Protocol segment and flow regime compatible.' };
}

function checkMarginalInsideButJointMissing(query: ResearchQuery, test: Test, allInvTests?: Test[]): boolean {
  const pool = allInvTests && allInvTests.length > 0 ? allInvTests : [test];
  const o2Vals = pool.map((t) => t.atmosphere.o2.value).filter((v): v is number => v !== null);
  const pVals = pool.map((t) => t.atmosphere.pressure.value).filter((v): v is number => v !== null);
  const fVals = pool.flatMap((t) => {
    const arr: number[] = [];
    if (t.flow.initialFlowCmS.value !== null) arr.push(t.flow.initialFlowCmS.value);
    if (t.flow.sequenceCmS) arr.push(...t.flow.sequenceCmS);
    return arr;
  });

  let activeDims = 0;
  let allInside1D = true;
  if (query.o2Pct !== null && o2Vals.length > 0) {
    activeDims += 1;
    if (query.o2Pct < Math.min(...o2Vals) - 0.6 || query.o2Pct > Math.max(...o2Vals) + 0.6) allInside1D = false;
  }
  if (query.pressureKpa !== null && pVals.length > 0) {
    activeDims += 1;
    if (query.pressureKpa < Math.min(...pVals) - 3 || query.pressureKpa > Math.max(...pVals) + 3) allInside1D = false;
  }
  if (query.flowCmS !== null && fVals.length > 0) {
    activeDims += 1;
    const lo = Array.isArray(query.flowCmS) ? Math.min(...query.flowCmS) : query.flowCmS;
    const hi = Array.isArray(query.flowCmS) ? Math.max(...query.flowCmS) : query.flowCmS;
    if (hi < Math.min(...fVals) - 2 || lo > Math.max(...fVals) + 2) allInside1D = false;
  }
  if (activeDims < 2 || !allInside1D) return false;

  const jointDists = pool.map((t) => testJointDistance(query, t)).filter((d): d is number => d !== null);
  if (jointDists.length === 0) return false;
  return Math.min(...jointDists) > JOINT_IN_DOMAIN_THRESHOLD;
}

function checkRuleJoint01(
  query: ResearchQuery,
  test: Test,
  allInvTests?: Test[],
): { rule: RuleEvaluation; jointDistance: number | null; marginalOverlapButJointMissing: boolean } {
  const jointDistance = testJointDistance(query, test);
  const marginalMissing = checkMarginalInsideButJointMissing(query, test, allInvTests);

  if (marginalMissing) {
    return {
      rule: {
        ruleId: 'RULE-JOINT-01',
        status: 'fail',
        reason: 'Unsupported joint combination: query sits inside 1D marginal bounds but no observed test/segment covers the joint multi-dimensional point.',
      },
      jointDistance,
      marginalOverlapButJointMissing: true,
    };
  }
  if (jointDistance !== null && jointDistance > JOINT_IN_DOMAIN_THRESHOLD) {
    return {
      rule: {
        ruleId: 'RULE-JOINT-01',
        status: jointDistance <= 2.5 ? 'conditional' : 'fail',
        reason: `Test conditions lie ${jointDistance.toFixed(2)} normalized joint units from query.`,
      },
      jointDistance,
      marginalOverlapButJointMissing: false,
    };
  }
  return {
    rule: { ruleId: 'RULE-JOINT-01', status: 'pass', reason: 'Joint multi-dimensional conditions supported.' },
    jointDistance,
    marginalOverlapButJointMissing: false,
  };
}

function collectReasonCodes(rules: RuleEvaluation[], protocolMatch: MatchedProtocolSegment, marginalMissing: boolean, plannedOnly: boolean): string[] {
  const codes: string[] = [];
  if (plannedOnly) codes.push('planned_only_matrix');
  if (marginalMissing) codes.push('unsupported_joint_combination');
  for (const r of rules) {
    if (r.status === 'pass') continue;
    if (r.ruleId === 'RULE-GAS-01') codes.push('oxidizer_stream_vs_ambient');
    else if (r.ruleId === 'RULE-PROV-01') codes.push('assumed_provenance_cap');
    else if (r.ruleId === 'RULE-UNK-01') codes.push('unknown_field_mismatch');
    else if (r.ruleId === 'RULE-MAT-01' && r.status === 'fail') codes.push('material_mismatch');
    else if (r.ruleId === 'RULE-EP-01') codes.push('endpoint_mismatch');
    else if (r.ruleId === 'RULE-GRAV-01') {
      codes.push(r.reason.includes('Simulated') ? 'simulated_analogue_gravity' : 'gravity_regime_gap');
    } else if (r.ruleId === 'RULE-GEOM-01') {
      codes.push(r.reason.includes('Enclosure') ? 'enclosure_scale_mismatch' : 'thickness_regime_mismatch');
    } else if (r.ruleId === 'RULE-PROT-01') {
      if (protocolMatch.operatorTerminated && !protocolMatch.endpointMatched) codes.push('operator_termination_not_physical_extinction');
      else if (protocolMatch.coolFlamePresent) codes.push('cool_flame_continuation_caveat');
      else codes.push('protocol_or_flow_mismatch');
    } else if (r.ruleId === 'RULE-JOINT-01' && !marginalMissing) {
      codes.push('out_of_tested_envelope');
    }
  }
  return [...new Set(codes)];
}

/**
 * Baseline C: row-level static matcher (checks O2, P, flow, material, geometry, gravity, endpoint
 * WITHOUT protocol segments/interventions, gas roles, provenance, unknown!==unknown, or joint check).
 */
export function evaluateStaticMatcher(query: ResearchQuery, test: Test): ApplicabilityDecision {
  const matOk = !query.fuelPhase || !test.fuelPhase || query.fuelPhase === test.fuelPhase;
  const fuelOk = !query.material || materialsCompatible(query.material, test.fuel);
  const geomOk =
    !query.geometry ||
    !test.geometry ||
    classifyGeometryRegime(query.geometry, query.thicknessMm, query.diameterMm, query.fuelPhase) ===
      classifyGeometryRegime(test.geometry, test.thicknessMm.value, test.diameterMm.value, test.fuelPhase);
  const gravOk =
    query.gravityG === null ||
    test.gravity.gravityG.value === null ||
    Math.abs(query.gravityG - test.gravity.gravityG.value) <= 0.4;
  const o2Ok =
    query.o2Pct === null ||
    test.atmosphere.o2.value === null ||
    Math.abs(query.o2Pct - test.atmosphere.o2.value) <= 3.0;
  const pOk =
    query.pressureKpa === null ||
    test.atmosphere.pressure.value === null ||
    Math.abs(query.pressureKpa - test.atmosphere.pressure.value) <= 15.0;
  const flowOk =
    query.flowCmS === null ||
    test.flow.initialFlowCmS.value === null ||
    gapToValue(query.flowCmS, test.flow.initialFlowCmS.value) <= 8.0;
  const epOk = test.initialOutcome !== 'not_applicable' && test.initialOutcome !== 'unknown';

  const admissible = matOk && fuelOk && geomOk && gravOk && o2Ok && pOk && flowOk && epOk;
  return {
    testId: test.testId,
    inv: test.inv,
    groupId: test.groupId,
    verdict: admissible ? 'admissible' : 'inadmissible',
    admissible,
    conditional: false,
    reasonCodes: admissible ? [] : ['static_matcher_mismatch'],
    rules: [],
    protocolMatch: {
      matchedSegmentIds: [],
      matchedEventIds: [],
      endpointMatched: epOk,
      operatorTerminated: false,
      coolFlamePresent: false,
      hotFlameExtinguished: false,
      flowHistoryMismatch: false,
      segmentSummary: test.initialOutcome,
      matchedOutcomeLabel: test.initialOutcome,
      warnings: [],
    },
    jointDistance: testJointDistance(query, test),
    marginalOverlapButJointMissing: false,
    matchedFactors: admissible ? ['static_row_fields'] : [],
    changedFactors: [],
    unknownFactors: [],
    sourceRef: test.sourceRef,
  };
}

export function evaluateApplicability(
  query: ResearchQuery,
  test: Test,
  opts: ApplicabilityOptions = {},
): ApplicabilityDecision {
  const plannedOnly = opts.investigation?.epistemicStatus === 'planned_only';
  const abl = opts.ablations ?? {};
  const protocolMatch = matchProtocolSegment(query, test);

  const rules: RuleEvaluation[] = [
    checkRuleEp01(query, test, !!abl.collapsedOutcomes),
    checkRuleMat01(query, test),
    checkRuleGeom01(query, test, !!abl.noGeometry),
    checkRuleUnk01(query, test),
    ...checkRuleGasAndProv(query, test),
    checkRuleGrav01(query, test),
    checkRuleProt01(query, test, protocolMatch, !!abl.noProtocol),
  ];
  const jointRes = checkRuleJoint01(query, test, opts.allInvTests);
  rules.push(jointRes.rule);

  const hasFail = rules.some((r) => r.status === 'fail');
  const hasConditional = rules.some((r) => r.status === 'conditional');

  let verdict: ApplicabilityVerdict;
  if (plannedOnly) verdict = 'planned_only';
  else if (hasFail) verdict = 'inadmissible';
  else if (hasConditional) verdict = 'conditional_support';
  else verdict = 'admissible';

  const matchedFactors = rules.filter((r) => r.status === 'pass').map((r) => r.ruleId);
  const changedFactors = rules.filter((r) => r.status !== 'pass').map((r) => `${r.ruleId}: ${r.reason}`);
  const unknownFactors: string[] = [];
  if (test.thicknessMm.value === null && test.fuelPhase === 'solid') unknownFactors.push('test.thicknessMm');
  if (query.thicknessMm === null && query.fuelPhase === 'solid') unknownFactors.push('query.thicknessMm');
  if (test.atmosphere.o2.value === null) unknownFactors.push('test.atmosphere.o2');
  if (test.atmosphere.pressure.value === null) unknownFactors.push('test.atmosphere.pressure');

  return {
    testId: test.testId,
    inv: test.inv,
    groupId: test.groupId,
    verdict,
    admissible: verdict === 'admissible',
    conditional: verdict === 'conditional_support',
    reasonCodes: collectReasonCodes(rules, protocolMatch, jointRes.marginalOverlapButJointMissing, plannedOnly),
    rules,
    protocolMatch,
    jointDistance: jointRes.jointDistance,
    marginalOverlapButJointMissing: jointRes.marginalOverlapButJointMissing,
    matchedFactors,
    changedFactors,
    unknownFactors,
    sourceRef: test.sourceRef,
  };
}

/** Every surface consumes compareTests; candidate selection is not a scientific verdict. */
export function buildContrasts(query: ResearchQuery, tests: Test[], maxContrasts = 6): ComparisonResult[] {
  const candidates = tests.slice(0, 18);
  const contrasts: ComparisonResult[] = [];
  for (let i = 0; i < candidates.length && contrasts.length < maxContrasts; i += 1) {
    for (let j = i + 1; j < candidates.length && contrasts.length < maxContrasts; j += 1) {
      if (candidates[i].testId !== candidates[j].testId) contrasts.push(compareTests(query, candidates[i], candidates[j]));
    }
  }
  return contrasts;
}

function computeRelevanceScore(query: ResearchQuery, inv: Investigation): number {
  let score = 0.25;
  if (query.fuelPhase && inv.fuelPhase) {
    score += query.fuelPhase === inv.fuelPhase ? 0.35 : -0.2;
  } else {
    score += 0.1;
  }
  if (query.material && inv.fuel?.types.some((ft) => materialsCompatible(query.material, ft))) {
    score += 0.25;
  }
  const taskDirMap: Record<ResearchQuery['safetyTask'], string> = {
    material_screening: 'prevention',
    ventilation_setting: 'prevention',
    smoke_detection: 'detection',
    fire_suppression: 'suppression',
    atmosphere_selection: 'prevention',
    general_comparison: 'prevention',
  };
  if (inv.direction.includes(taskDirMap[query.safetyTask] as never)) score += 0.15;
  if (query.targetInvIds?.length) {
    score += query.targetInvIds.includes(inv.id) ? 0.5 : -0.35;
  }
  return Math.max(0.01, Math.min(1, score));
}

function computeEvidenceQualityScore(inv: Investigation, invTests: Test[]): number {
  const n = inv.nTests ?? invTests.length;
  const countScore = Math.min(1, Math.log10(1 + n) / Math.log10(151));
  const flightScore = inv.flight ? 1.0 : 0.6;
  const rawScore = inv.rawDataAvailable ? 1.0 : 0.8;
  const assumedPenalty = inv.conditions?.assumed?.length ? 0.75 : 1.0;
  const plannedPenalty = inv.epistemicStatus === 'planned_only' ? 0.15 : 1.0;
  return Math.max(0.05, Math.min(1, (0.2 + 0.8 * countScore) * flightScore * rawScore * assumedPenalty * plannedPenalty));
}

export function rankInvestigationsV2(
  query: ResearchQuery,
  corpus: CorpusV2,
  options: { ablations?: ApplicabilityOptions['ablations'] } = {},
): InvestigationRankV2[] {
  const byInv = new Map<string, Test[]>();
  for (const t of corpus.tests) {
    const arr = byInv.get(t.inv);
    if (arr) arr.push(t);
    else byInv.set(t.inv, [t]);
  }

  return corpus.investigations
    .map((inv): InvestigationRankV2 => {
      const invTests = byInv.get(inv.id) ?? [];
      const decisions = invTests.map((t) =>
        evaluateApplicability(query, t, { investigation: inv, allInvTests: invTests, ablations: options.ablations }),
      );
      const admissibleCount = decisions.filter((d) => d.verdict === 'admissible').length;
      const conditionalCount = decisions.filter((d) => d.verdict === 'conditional_support').length;
      const inadmissibleCount = decisions.filter((d) => d.verdict === 'inadmissible').length;
      const unsupportedJointWarning = decisions.some((d) => d.marginalOverlapButJointMissing);

      let applicabilityScore = 0;
      if (inv.epistemicStatus === 'planned_only') {
        applicabilityScore = 0.05;
      } else if (invTests.length > 0) {
        const bestRatio = (admissibleCount * 1.0 + conditionalCount * 0.55) / invTests.length;
        const hasMatchBonus = admissibleCount > 0 ? 0.45 : conditionalCount > 0 ? 0.25 : 0;
        applicabilityScore = Math.min(1, hasMatchBonus + 0.55 * bestRatio);
      } else {
        applicabilityScore = 0.05;
      }

      const relevanceScore = computeRelevanceScore(query, inv);
      const evidenceQualityScore = computeEvidenceQualityScore(inv, invTests);
      const overallScore = Number(
        (0.35 * relevanceScore + 0.45 * applicabilityScore + 0.2 * evidenceQualityScore).toFixed(4),
      );

      let status: ApplicabilityVerdict = 'inadmissible';
      if (inv.epistemicStatus === 'planned_only') status = 'planned_only';
      else if (admissibleCount > 0) status = 'admissible';
      else if (conditionalCount > 0) status = 'conditional_support';

      const codeCounts = new Map<string, number>();
      for (const d of decisions) {
        for (const c of d.reasonCodes) codeCounts.set(c, (codeCounts.get(c) ?? 0) + 1);
      }
      const topReasonCodes = [...codeCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([code]) => code);

      return {
        inv,
        relevanceScore: Number(relevanceScore.toFixed(4)),
        applicabilityScore: Number(applicabilityScore.toFixed(4)),
        evidenceQualityScore: Number(evidenceQualityScore.toFixed(4)),
        overallScore,
        status,
        admissibleCount,
        conditionalCount,
        inadmissibleCount,
        topReasonCodes,
        unsupportedJointWarning,
      };
    })
    .sort((a, b) => {
      if (query.targetInvIds?.length) {
        const aHit = query.targetInvIds.includes(a.inv.id) ? 1 : 0;
        const bHit = query.targetInvIds.includes(b.inv.id) ? 1 : 0;
        if (aHit !== bHit) return bHit - aHit;
      }
      return b.overallScore - a.overallScore;
    });
}
