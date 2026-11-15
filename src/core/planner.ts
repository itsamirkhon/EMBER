/**
 * Exact branch-and-bound test-programme planner.
 * Generates candidate experiment blocks from EvidencePackage gaps and solves exact
 * constrained 0/1 coverage optimization within budgetRuns while preserving mandatory controls
 * and replicate requirements (never claims Bayesian information gain).
 */
import type { EvidencePackage, TestBlock, TestProgramme } from './types';

function numericFlow(flow: number | [number, number] | null): number | null {
  if (flow === null) return null;
  return Array.isArray(flow) ? (flow[0] + flow[1]) / 2 : flow;
}

export function generateCandidateBlocks(evidencePackage: EvidencePackage): TestBlock[] {
  const q = evidencePackage.query;
  const mat = q.material ?? 'PMMA';
  const geom = q.geometry ?? (q.fuelPhase === 'liquid' ? 'droplet' : q.fuelPhase === 'gas' ? 'porous burner' : 'slab');
  const flowVal = numericFlow(q.flowCmS);

  const blocks: TestBlock[] = [
    {
      blockId: 'blk-ctrl-baseline',
      title: `Mandatory baseline reference control (${mat}, 21% O2, 101.3 kPa, 1g/0g benchmark)`,
      category: 'mandatory_control',
      priorityQuestions: ['Q-CTRL-1: Calibrate baseline ignition and spread reference before varying conditions'],
      questionCoverageScore: 25,
      runsRequired: 2,
      replicatesPerCondition: 2,
      isMandatoryControl: true,
      conditions: {
        material: mat,
        geometry: geom,
        o2Pct: 21.0,
        pressureKpa: 101.3,
        flowCmS: flowVal ?? 10,
        gravityG: q.gravityG === 0 ? 0 : 1,
        targetEndpoint: q.targetEndpoint ?? 'sustained_spread',
      },
      rationale: 'Mandatory 2-replicate reference control preventing drift and apparatus bias.',
      addressesGap: 'baseline_control',
    },
  ];

  const hasJointGap = evidencePackage.applicabilityDecisions.some((d) => d.marginalOverlapButJointMissing);
  const hasGravGap = q.gravityRegime === 'partial_gravity' || evidencePackage.gaps.some((g) => /gravity/i.test(g));
  const hasThickGap = q.unknownFields.includes('thicknessMm') || evidencePackage.gaps.some((g) => /thickness|geometry/i.test(g));
  const hasFlowExtGap =
    q.targetEndpoint === 'quench_limit' ||
    q.targetEndpoint === 'extinction_under_flow_change' ||
    evidencePackage.applicabilityDecisions.some((d) => d.protocolMatch.operatorTerminated);
  const hasConflict = evidencePackage.conflictChunks.length > 0;

  if (hasJointGap || (q.o2Pct !== null && q.pressureKpa !== null)) {
    blocks.push({
      blockId: 'blk-joint-atmosphere',
      title: `Joint atmosphere cell (${q.o2Pct ?? 30}% O2 at ${q.pressureKpa ?? 70.3} kPa)`,
      category: 'gap_filling',
      priorityQuestions: ['Q-JOINT-1: Verify flammability inside target joint (O2, P) envelope'],
      questionCoverageScore: hasJointGap ? 38 : 28,
      runsRequired: 2,
      replicatesPerCondition: 2,
      isMandatoryControl: false,
      conditions: {
        material: mat,
        geometry: geom,
        o2Pct: q.o2Pct ?? 30,
        pressureKpa: q.pressureKpa ?? 70.3,
        flowCmS: flowVal ?? 5,
        gravityG: q.gravityG ?? 0,
        targetEndpoint: q.targetEndpoint ?? 'sustained_spread',
      },
      rationale: 'Directly tests the unmeasured joint O2 + pressure operating point (2 replicates).',
      addressesGap: 'unsupported_joint_combination',
    });
  }

  if (hasGravGap) {
    blocks.push({
      blockId: 'blk-partial-g-bracket',
      title: `Partial-gravity bracketing pair (0 g + 1 g matched ${mat} control)`,
      category: 'boundary_bracket',
      priorityQuestions: ['Q-GRAV-1: Bracket lunar/Mars flammability between actual 0 g and 1 g'],
      questionCoverageScore: 34,
      runsRequired: 2,
      replicatesPerCondition: 2,
      isMandatoryControl: false,
      conditions: {
        material: mat,
        geometry: geom,
        o2Pct: q.o2Pct ?? 30,
        pressureKpa: q.pressureKpa ?? 70.3,
        flowCmS: flowVal ?? 10,
        gravityG: q.gravityG ?? 0.166,
        targetEndpoint: q.targetEndpoint ?? 'sustained_spread',
      },
      rationale: 'Partial-gravity bracketing pair comparing actual 0 g vs 1 g responses with 2 replicates.',
      addressesGap: 'gravity_regime_gap',
    });
  }

  if (hasThickGap) {
    blocks.push({
      blockId: 'blk-thickness-regime',
      title: `Thickness regime check (0.2 mm thin film vs 4.0 mm thick slab, ${mat})`,
      category: 'gap_filling',
      priorityQuestions: ['Q-GEOM-1: Resolve thermally-thin vs thermally-thick spread transition'],
      questionCoverageScore: 26,
      runsRequired: 4,
      replicatesPerCondition: 2,
      isMandatoryControl: false,
      conditions: {
        material: mat,
        geometry: 'thin film and thick slab',
        o2Pct: q.o2Pct ?? 21,
        pressureKpa: q.pressureKpa ?? 101.3,
        flowCmS: flowVal ?? 10,
        gravityG: q.gravityG ?? 0,
        targetEndpoint: q.targetEndpoint ?? 'spread_rate',
      },
      rationale: 'Covers both thin-film and thick-slab regimes with 2 replicates each.',
      addressesGap: 'thickness_regime_unknown',
    });
  }

  if (hasFlowExtGap) {
    blocks.push({
      blockId: 'blk-stepped-quench',
      title: 'Stepped-down physical quench limit protocol (without early operator cutoff)',
      category: 'boundary_bracket',
      priorityQuestions: ['Q-PROT-1: Separate physical low-flow quench from operator flow shutoff'],
      questionCoverageScore: 30,
      runsRequired: 3,
      replicatesPerCondition: 3,
      isMandatoryControl: false,
      conditions: {
        material: mat,
        geometry: geom,
        o2Pct: q.o2Pct ?? 21,
        pressureKpa: q.pressureKpa ?? 101.3,
        flowCmS: 2,
        gravityG: q.gravityG ?? 0,
        targetEndpoint: 'quench_limit',
      },
      rationale: 'Explicitly runs stepped-down flow sequence to physical extinction with 3 replicates.',
      addressesGap: 'operator_termination_ambiguity',
    });
  }

  if (hasConflict) {
    blocks.push({
      blockId: 'blk-conflict-reconcile',
      title: 'Conflict reconciliation & replicate verification block',
      category: 'replicate_verification',
      priorityQuestions: ['Q-CONF-1: Resolve documented source conflict/tension with independent replicates'],
      questionCoverageScore: 22,
      runsRequired: 2,
      replicatesPerCondition: 2,
      isMandatoryControl: false,
      conditions: {
        material: mat,
        geometry: geom,
        o2Pct: q.o2Pct ?? 21,
        pressureKpa: q.pressureKpa ?? 101.3,
        flowCmS: flowVal ?? 10,
        gravityG: q.gravityG ?? 0,
        targetEndpoint: q.targetEndpoint ?? 'flame_establishment',
      },
      rationale: 'Directly tests conflicting conditions highlighted by Jev contradiction detector.',
      addressesGap: 'source_conflict_resolution',
    });
  }

  return blocks;
}

function fractionalBound(items: TestBlock[], startIdx: number, remCap: number): number {
  let bound = 0;
  let cap = remCap;
  for (let i = startIdx; i < items.length && cap > 0; i += 1) {
    const it = items[i];
    if (it.runsRequired <= cap) {
      bound += it.questionCoverageScore;
      cap -= it.runsRequired;
    } else {
      bound += it.questionCoverageScore * (cap / Math.max(1, it.runsRequired));
      cap = 0;
    }
  }
  return bound;
}

function exactKnapsackBranchAndBound(items: TestBlock[], capacity: number): {
  bestValue: number;
  selectedIndices: Set<number>;
} {
  const sorted = items
    .map((item, origIdx) => ({ item, origIdx, ratio: item.questionCoverageScore / Math.max(1, item.runsRequired) }))
    .sort((a, b) => b.ratio - a.ratio);

  const orderedItems = sorted.map((s) => s.item);
  let bestVal = -1;
  let bestPicked: number[] = [];
  let visited = 0;
  const MAX_VISITS = 250000;

  function dfs(idx: number, usedRuns: number, curVal: number, picked: number[]): void {
    if (visited > MAX_VISITS) return;
    visited += 1;

    if (curVal > bestVal) {
      bestVal = curVal;
      bestPicked = [...picked];
    }
    if (idx >= orderedItems.length) return;

    const ub = curVal + fractionalBound(orderedItems, idx, capacity - usedRuns);
    if (ub <= bestVal + 1e-9) return;

    const item = orderedItems[idx];
    if (usedRuns + item.runsRequired <= capacity) {
      picked.push(idx);
      dfs(idx + 1, usedRuns + item.runsRequired, curVal + item.questionCoverageScore, picked);
      picked.pop();
    }
    dfs(idx + 1, usedRuns, curVal, picked);
  }

  dfs(0, 0, 0, []);
  const selectedIndices = new Set<number>();
  for (const sortedIdx of bestPicked) {
    selectedIndices.add(sorted[sortedIdx].origIdx);
  }
  return { bestValue: Math.max(0, bestVal), selectedIndices };
}

export function optimizeTestProgramme(candidates: TestBlock[], budgetRuns: number): TestProgramme {
  const safeBudget = Math.max(0, Math.floor(budgetRuns));
  const validCandidates = candidates.filter((c) => c.runsRequired > 0 && c.replicatesPerCondition >= 2 && c.runsRequired >= c.replicatesPerCondition);

  const mandatory = validCandidates.filter((c) => c.isMandatoryControl);
  const optional = validCandidates.filter((c) => !c.isMandatoryControl);

  const mandatoryTotalRuns = mandatory.reduce((s, b) => s + b.runsRequired, 0);
  let selectedBlocks: TestBlock[] = [];
  let mandatoryControlsPreserved = false;

  if (mandatoryTotalRuns <= safeBudget) {
    mandatoryControlsPreserved = true;
    const remBudget = safeBudget - mandatoryTotalRuns;
    const optRes = exactKnapsackBranchAndBound(optional, remBudget);
    const chosenOpt = optional.filter((_, i) => optRes.selectedIndices.has(i));
    selectedBlocks = [...mandatory, ...chosenOpt];
  } else {
    const mandRes = exactKnapsackBranchAndBound(mandatory, safeBudget);
    selectedBlocks = mandatory.filter((_, i) => mandRes.selectedIndices.has(i));
    mandatoryControlsPreserved = mandatory.length === 0;
  }

  const selectedIds = new Set(selectedBlocks.map((b) => b.blockId));
  const excludedBlocks = candidates.filter((c) => !selectedIds.has(c.blockId));
  const usedRuns = selectedBlocks.reduce((s, b) => s + b.runsRequired, 0);
  const totalCoverageScore = Number(selectedBlocks.reduce((s, b) => s + b.questionCoverageScore, 0).toFixed(2));
  const replicatesPreserved = selectedBlocks.every((b) => b.replicatesPerCondition >= 2 && b.runsRequired >= b.replicatesPerCondition);

  return {
    budgetRuns: safeBudget,
    usedRuns,
    remainingRuns: Math.max(0, safeBudget - usedRuns),
    totalCoverageScore,
    selectedBlocks,
    excludedBlocks,
    mandatoryControlsPreserved,
    replicatesPreserved,
    optimizerMethod: 'exact_branch_and_bound',
    epistemicNote:
      'Exact branch-and-bound maximization of priority question coverage within run budget under mandatory control and replicate constraints; does not claim Bayesian expected information gain.',
  };
}
