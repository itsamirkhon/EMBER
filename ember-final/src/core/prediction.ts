/**
 * Conditional single-endpoint domain-gated kNN / local ridge predictor.
 * Only predicts validated numeric targets (spreadRateMmS, particleSizeNm, smokePointLengthMm, burningRateMm2S)
 * with leave-one-group-out CV by groupId and strict Domain Gate (refuses out-of-domain or below-baseline).
 * Uncalibrated kNN pBurn classification is permanently removed.
 */
import { materialsCompatible } from './applicability';
import type { DomainPrediction, FuelPhase, PredictionTarget, ResearchQuery, Test } from './types';

export const TARGET_META: Record<PredictionTarget, { unit: string; defaultPhase: FuelPhase }> = {
  spreadRateMmS: { unit: 'mm/s', defaultPhase: 'solid' },
  burningRateMm2S: { unit: 'mm²/s', defaultPhase: 'liquid' },
  particleSizeNm: { unit: 'nm', defaultPhase: 'solid' },
  smokePointLengthMm: { unit: 'mm', defaultPhase: 'gas' },
};

export interface PredictionOptions {
  k?: number;
  maxJointDistance?: number;
  minRows?: number;
  minGroups?: number;
}

const DEFAULT_PRED_OPTS: Required<PredictionOptions> = {
  k: 5,
  maxJointDistance: 1.75,
  minRows: 5,
  minGroups: 3,
};

function getTargetVal(t: Test, target: PredictionTarget): number | null {
  const sv = t[target];
  return sv && sv.value !== null && Number.isFinite(sv.value) ? sv.value : null;
}

function getFeatureVector(t: Test, target: PredictionTarget): number[] {
  const o2 = t.atmosphere.o2.value ?? 21.0;
  const p = t.atmosphere.pressure.value ?? 101.3;
  const flow = t.flow.initialFlowCmS.value ?? 0;
  if (target === 'spreadRateMmS') {
    return [o2 / 3, p / 15, flow / 8, (t.thicknessMm.value ?? 1.0) / 1.0];
  }
  if (target === 'burningRateMm2S') {
    return [o2 / 3, p / 50, (t.diameterMm.value ?? 2.5) / 1.5, (t.atmosphere.diluentPct.value ?? 0) / 10];
  }
  if (target === 'smokePointLengthMm') {
    return [flow / 15, (t.diameterMm.value ?? 5.0) / 2.0, o2 / 3];
  }
  // particleSizeNm
  const aging = typeof t.extra?.netAgingTimeS === 'number' ? t.extra.netAgingTimeS / 60 : 0;
  const heater = typeof t.extra?.heaterRt_R0 === 'number' ? (t.extra.heaterRt_R0 - 1) * 5 : 0;
  return [flow / 3, heater, aging, o2 / 3];
}

function queryFeatureVector(q: ResearchQuery, target: PredictionTarget): number[] {
  const o2 = q.o2Pct ?? 21.0;
  const p = q.pressureKpa ?? 101.3;
  const flow = Array.isArray(q.flowCmS) ? (q.flowCmS[0] + q.flowCmS[1]) / 2 : q.flowCmS ?? 10;
  if (target === 'spreadRateMmS') {
    return [o2 / 3, p / 15, flow / 8, (q.thicknessMm ?? 1.0) / 1.0];
  }
  if (target === 'burningRateMm2S') {
    return [o2 / 3, p / 50, (q.diameterMm ?? 2.5) / 1.5, 0];
  }
  if (target === 'smokePointLengthMm') {
    return [flow / 15, (q.diameterMm ?? 5.0) / 2.0, o2 / 3];
  }
  return [flow / 3, 0, 0, o2 / 3];
}

function euclid(a: number[], b: number[]): number {
  let sq = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const d = a[i] - b[i];
    sq += d * d;
  }
  return Math.sqrt(sq);
}

function predictSinglePoint(
  qVec: number[],
  train: Array<{ test: Test; vec: number[]; y: number }>,
  k: number,
): { value: number; interval: [number, number]; neighbours: DomainPrediction['nearestNeighbours'] } {
  const scored = train
    .map((row) => ({ row, dist: euclid(qVec, row.vec) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, Math.min(k, train.length));

  const eps = 0.05;
  const weighted = scored.map((s) => ({ ...s, w: 1 / Math.pow(s.dist + eps, 2) }));
  const sumW = weighted.reduce((acc, s) => acc + s.w, 0) || 1;
  const knnMean = weighted.reduce((acc, s) => acc + s.w * s.row.y, 0) / sumW;

  // Light weighted linear ridge slope refinement along 1st varying coordinate when k >= 4
  let predicted = knnMean;
  const xs = weighted.map((s) => s.row.vec[0]);
  const meanX = weighted.reduce((acc, s) => acc + s.w * s.row.vec[0], 0) / sumW;
  const varX = weighted.reduce((acc, s) => acc + s.w * (s.row.vec[0] - meanX) ** 2, 0) / sumW;
  if (weighted.length >= 4 && varX > 1e-4 && Math.max(...xs) - Math.min(...xs) > 0.05) {
    const covXY = weighted.reduce((acc, s) => acc + s.w * (s.row.vec[0] - meanX) * (s.row.y - knnMean), 0) / sumW;
    const slope = covXY / (varX + 0.25); // ridge lambda = 0.25
    const ridgeEst = knnMean + slope * (qVec[0] - meanX);
    if (Number.isFinite(ridgeEst) && ridgeEst >= 0) predicted = ridgeEst;
  }

  const ys = weighted.map((s) => s.row.y);
  const spread = Math.sqrt(weighted.reduce((acc, s) => acc + s.w * (s.row.y - knnMean) ** 2, 0) / sumW);
  const lo = Math.max(0, Math.min(...ys, predicted - spread));
  const hi = Math.max(...ys, predicted + spread);

  return {
    value: Number(predicted.toFixed(4)),
    interval: [Number(lo.toFixed(4)), Number(hi.toFixed(4))],
    neighbours: scored.map((s) => ({
      testId: s.row.test.testId,
      inv: s.row.test.inv,
      groupId: s.row.test.groupId,
      distance: Number(s.dist.toFixed(4)),
      value: s.row.y,
    })),
  };
}

export function groupedCrossValidate(
  rows: Test[],
  target: PredictionTarget,
  options: PredictionOptions = {},
): {
  cvMae: number | null;
  baselineInvMeanMae: number | null;
  baselineGlobalMeanMae: number | null;
  nGroups: number;
  nRows: number;
  beatsBaseline: boolean;
} {
  const opts = { ...DEFAULT_PRED_OPTS, ...options };
  const valid = rows
    .map((test) => ({ test, y: getTargetVal(test, target), vec: getFeatureVector(test, target) }))
    .filter((r): r is { test: Test; y: number; vec: number[] } => r.y !== null);

  const byGroup = new Map<string, typeof valid>();
  for (const r of valid) {
    const g = r.test.groupId || r.test.testId;
    const arr = byGroup.get(g);
    if (arr) arr.push(r);
    else byGroup.set(g, [r]);
  }

  if (byGroup.size < opts.minGroups || valid.length < opts.minRows) {
    return {
      cvMae: null,
      baselineInvMeanMae: null,
      baselineGlobalMeanMae: null,
      nGroups: byGroup.size,
      nRows: valid.length,
      beatsBaseline: false,
    };
  }

  let errModel = 0;
  let errInv = 0;
  let errGlobal = 0;
  let count = 0;

  for (const [groupId, heldOut] of byGroup.entries()) {
    const train = valid.filter((r) => (r.test.groupId || r.test.testId) !== groupId);
    if (train.length === 0) continue;
    const globalMean = train.reduce((s, r) => s + r.y, 0) / train.length;

    for (const item of heldOut) {
      const pred = predictSinglePoint(item.vec, train, opts.k);
      const sameInv = train.filter((r) => r.test.inv === item.test.inv);
      const invMean = sameInv.length > 0 ? sameInv.reduce((s, r) => s + r.y, 0) / sameInv.length : globalMean;
      errModel += Math.abs(pred.value - item.y);
      errInv += Math.abs(invMean - item.y);
      errGlobal += Math.abs(globalMean - item.y);
      count += 1;
    }
  }

  if (count === 0) {
    return {
      cvMae: null,
      baselineInvMeanMae: null,
      baselineGlobalMeanMae: null,
      nGroups: byGroup.size,
      nRows: valid.length,
      beatsBaseline: false,
    };
  }

  const cvMae = Number((errModel / count).toFixed(4));
  const baselineInvMeanMae = Number((errInv / count).toFixed(4));
  const baselineGlobalMeanMae = Number((errGlobal / count).toFixed(4));
  const beatsBaseline = cvMae < baselineGlobalMeanMae && cvMae <= baselineInvMeanMae + 1e-9;

  return {
    cvMae,
    baselineInvMeanMae,
    baselineGlobalMeanMae,
    nGroups: byGroup.size,
    nRows: valid.length,
    beatsBaseline,
  };
}

function makeRefusal(
  target: PredictionTarget,
  status: Exclude<DomainPrediction['status'], 'predicted'>,
  reasons: string[],
  cv?: ReturnType<typeof groupedCrossValidate>,
): DomainPrediction {
  return {
    target,
    unit: TARGET_META[target].unit,
    status,
    refused: true,
    refusalReasons: reasons,
    method: 'domain_gated_knn_ridge',
    predictedValue: null,
    interval: null,
    nTrainGroups: cv?.nGroups ?? 0,
    nTrainRows: cv?.nRows ?? 0,
    cvMae: cv?.cvMae ?? null,
    baselineInvMeanMae: cv?.baselineInvMeanMae ?? null,
    baselineGlobalMeanMae: cv?.baselineGlobalMeanMae ?? null,
    beatsBaseline: cv?.beatsBaseline ?? false,
    nearestNeighbours: [],
  };
}

export function predictDomainGated(
  query: ResearchQuery,
  tests: Test[],
  target: PredictionTarget,
  options: PredictionOptions = {},
): DomainPrediction {
  const opts = { ...DEFAULT_PRED_OPTS, ...options };
  const phaseFilter = query.fuelPhase ?? TARGET_META[target].defaultPhase;

  if (query.gravityRegime === 'partial_gravity') {
    return makeRefusal(target, 'refused_out_of_domain', [
      `Domain Gate refused ${target}: zero actual partial-gravity (${query.gravityG ?? 'lunar/Mars'} g) training data in PSI.`,
    ]);
  }

  const pool = tests.filter((t) => {
    if (getTargetVal(t, target) === null) return false;
    if (t.fuelPhase && t.fuelPhase !== phaseFilter && target !== 'particleSizeNm') return false;
    if (query.material && !materialsCompatible(query.material, t.fuel)) return false;
    if ((t.atmosphere.o2.role ?? 'ambient') !== query.o2Role) return false;
    if (t.gravity.mode === 'simulated_analogue') return false;
    if (query.gravityRegime && t.gravity.regime !== query.gravityRegime) return false;
    return true;
  });

  const cv = groupedCrossValidate(pool, target, opts);
  if (cv.nGroups < opts.minGroups || cv.nRows < opts.minRows) {
    return makeRefusal(
      target,
      'refused_insufficient_data',
      [`Insufficient domain-matched groups/rows for ${target}: ${cv.nGroups} groups, ${cv.nRows} rows (need >= ${opts.minGroups} groups, >= ${opts.minRows} rows).`],
      cv,
    );
  }

  // In-domain bounding & joint distance check
  const o2Vals = pool.map((t) => t.atmosphere.o2.value).filter((v): v is number => v !== null);
  const pVals = pool.map((t) => t.atmosphere.pressure.value).filter((v): v is number => v !== null);
  const outReasons: string[] = [];
  if (query.o2Pct !== null && o2Vals.length > 0) {
    const lo = Math.min(...o2Vals);
    const hi = Math.max(...o2Vals);
    if (query.o2Pct < lo - 1.0 || query.o2Pct > hi + 1.0) {
      outReasons.push(`Query O2 ${query.o2Pct}% is outside training envelope [${lo}, ${hi}]%.`);
    }
  }
  if (query.pressureKpa !== null && pVals.length > 0) {
    const lo = Math.min(...pVals);
    const hi = Math.max(...pVals);
    if (query.pressureKpa < lo - 5.0 || query.pressureKpa > hi + 5.0) {
      outReasons.push(`Query pressure ${query.pressureKpa} kPa is outside training envelope [${lo}, ${hi}] kPa.`);
    }
  }

  const qVec = queryFeatureVector(query, target);
  const train = pool.map((test) => ({
    test,
    y: getTargetVal(test, target)!,
    vec: getFeatureVector(test, target),
  }));
  const minDist = Math.min(...train.map((r) => euclid(qVec, r.vec)));
  if (minDist > opts.maxJointDistance) {
    outReasons.push(`Nearest joint training point is ${minDist.toFixed(2)} normalized units away (limit ${opts.maxJointDistance}).`);
  }

  if (outReasons.length > 0) {
    return makeRefusal(target, 'refused_out_of_domain', outReasons, cv);
  }

  if (!cv.beatsBaseline) {
    return makeRefusal(
      target,
      'refused_below_baseline',
      [
        `Grouped CV MAE (${cv.cvMae}) did not beat mean baselines (invMean=${cv.baselineInvMeanMae}, globalMean=${cv.baselineGlobalMeanMae}); prediction suppressed.`,
      ],
      cv,
    );
  }

  const pred = predictSinglePoint(qVec, train, opts.k);
  return {
    target,
    unit: TARGET_META[target].unit,
    status: 'predicted',
    refused: false,
    refusalReasons: [],
    method: 'domain_gated_knn_ridge',
    predictedValue: pred.value,
    interval: pred.interval,
    nTrainGroups: cv.nGroups,
    nTrainRows: cv.nRows,
    cvMae: cv.cvMae,
    baselineInvMeanMae: cv.baselineInvMeanMae,
    baselineGlobalMeanMae: cv.baselineGlobalMeanMae,
    beatsBaseline: true,
    nearestNeighbours: pred.neighbours,
  };
}

export function predictAllApplicableTargets(
  query: ResearchQuery,
  tests: Test[],
  options: PredictionOptions = {},
): DomainPrediction[] {
  const targets: PredictionTarget[] = ['spreadRateMmS', 'burningRateMm2S', 'particleSizeNm', 'smokePointLengthMm'];
  return targets.map((target) => predictDomainGated(query, tests, target, options));
}
