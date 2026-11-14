/**
 * EMBER evidence engine — pure functions, no React, no DOM.
 * Reused by the browser UI and by the Node backtest (scripts/backtest.ts).
 *
 * Concepts
 *  - Normalized condition space: O2 (%), pressure (kPa), flow (cm/s), each divided by a
 *    "scale" (what we consider one unit of difference). Fuel phase / material / gravity
 *    differences add penalty terms in quadrature.
 *  - estimate(): inverse-distance-weighted kNN over real tests -> P(burn) + answer status
 *      measured     : a real test within per-dimension tolerance (same phase / material)
 *      interpolated : local tests bracket the query on every dimension (neighbours on both sides)
 *      extrapolated : otherwise; nearest tests and out-of-range distances are reported
 *  - relevance(): consequence x evidence strength x proximity as a weighted geometric mean.
 */
import type { FuelPhase, Investigation, Range, TestRow } from './types';

export type Dim = 'o2Pct' | 'pressureKpa' | 'flowCmS';
export const DIMS: Dim[] = ['o2Pct', 'pressureKpa', 'flowCmS'];

export const DIM_LABEL: Record<Dim, string> = {
  o2Pct: 'O₂',
  pressureKpa: 'Pressure',
  flowCmS: 'Flow',
};
export const DIM_UNIT: Record<Dim, string> = { o2Pct: '%', pressureKpa: 'kPa', flowCmS: 'cm/s' };

/** One normalized unit along each dimension. */
export const DEFAULT_SCALES: Record<Dim, number> = { o2Pct: 3, pressureKpa: 15, flowCmS: 8 };
/** A test counts as "measured" at the query if every dimension is within these tolerances. */
export const DEFAULT_TOLERANCE: Record<Dim, number> = { o2Pct: 0.6, pressureKpa: 3, flowCmS: 2 };

export const PHASE_PENALTY = 4; // normalized units added (in quadrature) for a different fuel phase
export const MATERIAL_PENALTY = 1; // ... for a different material within the same phase
export const MISSING_PENALTY = 1; // ... for each dimension the test does not report (unknown is not 'near')
/** For ranking: an undocumented condition counts as 1.5 units away. */
export const MISSING_PROXIMITY_PENALTY = 1.5;
export const GRAVITY_SCALE = 0.5; // g per normalized unit (only when gravityAware)

export const KPA_PER_PSI = 6.894757;
export const kpaToPsi = (kpa: number) => kpa / KPA_PER_PSI;
export const psiToKpa = (psi: number) => psi * KPA_PER_PSI;

export interface Query {
  o2Pct: number | null;
  pressureKpa: number | null;
  /** scalar, or an operating interval [min, max] (missions give ventilation ranges) */
  flowCmS: number | [number, number] | null;
  fuelPhase?: FuelPhase | null;
  /** material name, compared case-insensitively with TestRow.fuel */
  fuel?: string | null;
  gravityG?: number | null;
}

export interface EstimateOptions {
  k: number;
  power: number;
  eps: number;
  scales: Record<Dim, number>;
  tolerance: Record<Dim, number>;
  /** neighbourhood radius (normalized) in which bracketing is checked */
  localRadius: number;
  /** nearest test must be at least this close for "interpolated" */
  maxInterpDistance: number;
  /** include gravity as a distance term */
  gravityAware: boolean;
}

export const DEFAULT_ESTIMATE_OPTIONS: EstimateOptions = {
  k: 5,
  power: 2,
  eps: 0.05,
  scales: DEFAULT_SCALES,
  tolerance: DEFAULT_TOLERANCE,
  localRadius: 2,
  maxInterpDistance: 1.25,
  gravityAware: false,
};

// ---------------------------------------------------------------------------
// Outcomes

export type Binary = 'burn' | 'noburn';

const BURN = new Set(['burned', 'flame_spread', 'completed', 'disruption']);
const NOBURN = new Set(['extinguished', 'self_extinguished', 'no_ignition']);

/** Collapse contract outcomes to burn / no-burn. `unknown` and anything else -> null. */
export function binaryOutcome(outcome: string | null | undefined): Binary | null {
  if (!outcome) return null;
  if (BURN.has(outcome)) return 'burn';
  if (NOBURN.has(outcome)) return 'noburn';
  return null;
}

// ---------------------------------------------------------------------------
// Distances

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function queryValue(q: Query, dim: Dim): number | [number, number] | null {
  return q[dim];
}

/** Absolute gap between a query value (scalar or interval) and a test value. */
export function gap(qv: number | [number, number], tv: number): number {
  if (Array.isArray(qv)) {
    const [a, b] = qv[0] <= qv[1] ? qv : [qv[1], qv[0]];
    if (tv < a) return a - tv;
    if (tv > b) return tv - b;
    return 0;
  }
  return Math.abs(qv - tv);
}

export interface DistanceBreakdown {
  total: number;
  terms: Partial<Record<Dim | 'phase' | 'material' | 'gravity' | 'missing', number>>;
}

export function testDistance(
  q: Query,
  t: TestRow,
  opts: Pick<EstimateOptions, 'scales' | 'gravityAware'> = DEFAULT_ESTIMATE_OPTIONS,
): DistanceBreakdown {
  const terms: DistanceBreakdown['terms'] = {};
  let sum = 0;
  let missing = 0;
  for (const dim of DIMS) {
    const qv = queryValue(q, dim);
    if (qv === null || qv === undefined) continue;
    const tv = t[dim];
    if (tv === null || tv === undefined || Number.isNaN(tv)) {
      missing += 1;
      continue;
    }
    const z = gap(qv, tv) / opts.scales[dim];
    terms[dim] = z;
    sum += z * z;
  }
  if (missing) {
    terms.missing = missing * MISSING_PENALTY;
    sum += terms.missing ** 2;
  }
  if (q.fuelPhase && t.fuelPhase && q.fuelPhase !== t.fuelPhase) {
    terms.phase = PHASE_PENALTY;
    sum += PHASE_PENALTY ** 2;
  } else if (q.fuel && !sameText(q.fuel, t.fuel)) {
    terms.material = MATERIAL_PENALTY;
    sum += MATERIAL_PENALTY ** 2;
  }
  if (opts.gravityAware && q.gravityG != null && t.gravityG != null) {
    const z = Math.abs(q.gravityG - t.gravityG) / GRAVITY_SCALE;
    terms.gravity = z;
    sum += z * z;
  }
  return { total: Math.sqrt(sum), terms };
}

// ---------------------------------------------------------------------------
// Statistics helpers

/** Wilson score interval for a proportion p with (effective) sample size n, z = 1.96. */
export function wilson(p: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 1];
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function rangeOf(values: (number | null | undefined)[]): Range {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo === Infinity ? null : [lo, hi];
}

// ---------------------------------------------------------------------------
// Estimate

export type AnswerStatus = 'measured' | 'interpolated' | 'extrapolated';

export interface Neighbour {
  test: TestRow;
  distance: number;
  weight: number;
  outcome: Binary;
}

export interface OutOfRange {
  dim: Dim;
  value: number;
  min: number;
  max: number;
  /** how far outside the tested range, native units (0 if inside) */
  excess: number;
}

export interface Estimate {
  status: AnswerStatus;
  /** probability-like weighted vote that the material burns / flame is sustained */
  pBurn: number | null;
  interval: [number, number] | null;
  predicted: Binary | null;
  neighbours: Neighbour[];
  measuredTests: TestRow[];
  nearestDistance: number | null;
  bracket: Partial<Record<Dim, { below: boolean; above: boolean }>>;
  outOfRange: OutOfRange[];
  poolSize: number;
  /** true when no test of the requested fuel phase exists and other phases were used */
  phaseFallback: boolean;
  /** human-readable reasons for the status */
  reasons: string[];
}

function withinTolerance(q: Query, t: TestRow, tol: Record<Dim, number>): boolean {
  for (const dim of DIMS) {
    const qv = q[dim];
    if (qv === null || qv === undefined) continue;
    const tv = t[dim];
    if (tv === null || tv === undefined) return false;
    if (gap(qv, tv) > tol[dim]) return false;
  }
  if (q.fuelPhase && t.fuelPhase !== q.fuelPhase) return false;
  if (q.fuel && !sameText(q.fuel, t.fuel)) return false;
  return true;
}

function fmt(n: number, d = 1) {
  return Number.isInteger(n) ? String(n) : n.toFixed(d);
}

/** Tests usable for outcome estimation (binary outcome). */
export function usableTests(tests: TestRow[]): TestRow[] {
  return tests.filter((t) => binaryOutcome(t.outcome) !== null);
}

interface Classification {
  status: AnswerStatus;
  scored: { test: TestRow; distance: number }[];
  measuredTests: TestRow[];
  nearestDistance: number;
  bracket: Estimate['bracket'];
  outOfRange: OutOfRange[];
}

/**
 * Shared Measured / Interpolated / Extrapolated logic for a non-empty pool.
 * Used by both the burn / no-burn vote (estimate) and the numeric kNN (estimateNumeric).
 */
function classify(q: Query, pool: TestRow[], opts: EstimateOptions, phaseFallback: boolean, reasons: string[]): Classification {
  const scored = pool
    .map((t) => ({ test: t, distance: testDistance(q, t, opts).total }))
    .sort((a, b) => a.distance - b.distance);

  // out-of-range per dimension against the whole pool
  const outOfRange: OutOfRange[] = [];
  const unrecorded: Dim[] = [];
  for (const dim of DIMS) {
    const qv = q[dim];
    if (qv === null || qv === undefined) continue;
    const r = rangeOf(pool.map((t) => t[dim]));
    if (!r) {
      unrecorded.push(dim);
      continue;
    }
    const v = Array.isArray(qv) ? (qv[0] + qv[1]) / 2 : qv;
    // interval queries: any overlap with the tested range counts as inside
    const qMax = Array.isArray(qv) ? Math.max(qv[0], qv[1]) : v;
    const qMin = Array.isArray(qv) ? Math.min(qv[0], qv[1]) : v;
    const excess = qMax < r[0] ? r[0] - qMax : qMin > r[1] ? qMin - r[1] : 0;
    outOfRange.push({ dim, value: v, min: r[0], max: r[1], excess });
  }

  // measured?
  const measuredTests = (phaseFallback ? [] : pool).filter((t) => withinTolerance(q, t, opts.tolerance));

  // bracketing in the neighbourhood
  const local = scored.filter((s) => s.distance <= opts.localRadius).map((s) => s.test);
  const bracket: Estimate['bracket'] = {};
  let bracketedAll = local.length > 0;
  for (const dim of DIMS) {
    const qv = q[dim];
    if (qv === null || qv === undefined) continue;
    const [a, b] = Array.isArray(qv) ? [Math.min(...qv), Math.max(...qv)] : [qv, qv];
    const tol = opts.tolerance[dim];
    let below = false;
    let above = false;
    for (const t of local) {
      const tv = t[dim];
      if (tv === null || tv === undefined) continue;
      if (tv <= b + tol) below = true;
      if (tv >= a - tol) above = true;
    }
    bracket[dim] = { below, above };
    if (!(below && above)) bracketedAll = false;
  }

  const nearestDistance = scored[0].distance;
  let status: AnswerStatus;
  if (measuredTests.length > 0) {
    status = 'measured';
    reasons.push(
      `${measuredTests.length} real test${measuredTests.length > 1 ? 's' : ''} within tolerance (±${fmt(opts.tolerance.o2Pct)}% O₂, ±${fmt(opts.tolerance.pressureKpa)} kPa, ±${fmt(opts.tolerance.flowCmS)} cm/s).`,
    );
  } else if (!phaseFallback && bracketedAll && nearestDistance <= opts.maxInterpDistance) {
    status = 'interpolated';
    reasons.push('Real tests surround this point on every dimension; estimate is a weighted vote of nearest tests.');
  } else {
    status = 'extrapolated';
    for (const dim of unrecorded) reasons.push(`${DIM_LABEL[dim]} is not recorded for any test in this pool.`);
    for (const o of outOfRange) {
      if (o.excess > 0) {
        reasons.push(
          `${DIM_LABEL[o.dim]} ${fmt(o.value)} ${DIM_UNIT[o.dim]} is ${fmt(o.excess)} ${DIM_UNIT[o.dim]} outside the tested range ${fmt(o.min)}–${fmt(o.max)}.`,
        );
      }
    }
    for (const dim of DIMS) {
      const b = bracket[dim];
      if (unrecorded.includes(dim)) continue;
      if (local.length > 0 && b && !(b.below && b.above) && !outOfRange.find((o) => o.dim === dim && o.excess > 0)) {
        reasons.push(`No nearby tests on the ${b.below ? 'high' : 'low'} side of ${DIM_LABEL[dim]}.`);
      }
    }
    if (local.length === 0 || nearestDistance > opts.maxInterpDistance) {
      reasons.push(`Nearest test is ${nearestDistance.toFixed(2)} normalized units away.`);
    }
  }
  return { status, scored, measuredTests, nearestDistance, bracket, outOfRange };
}

export function estimate(
  q: Query,
  tests: TestRow[],
  options: Partial<EstimateOptions> = {},
): Estimate {
  const opts = { ...DEFAULT_ESTIMATE_OPTIONS, ...options };
  const usable = usableTests(tests);
  let pool = q.fuelPhase ? usable.filter((t) => t.fuelPhase === q.fuelPhase) : usable;
  let phaseFallback = false;
  const reasons: string[] = [];
  if (pool.length === 0 && q.fuelPhase) {
    pool = usable;
    phaseFallback = pool.length > 0;
    if (phaseFallback) reasons.push(`No ${q.fuelPhase}-fuel tests with outcomes; using other fuel phases.`);
  }

  const empty: Estimate = {
    status: 'extrapolated',
    pBurn: null,
    interval: null,
    predicted: null,
    neighbours: [],
    measuredTests: [],
    nearestDistance: null,
    bracket: {},
    outOfRange: [],
    poolSize: 0,
    phaseFallback,
    reasons: ['No tests with a recorded outcome are available.'],
  };
  if (pool.length === 0) return empty;

  const c = classify(q, pool, opts, phaseFallback, reasons);
  const neighbours: Neighbour[] = c.scored.slice(0, Math.min(opts.k, c.scored.length)).map((s) => ({
    test: s.test,
    distance: s.distance,
    weight: 1 / Math.pow(s.distance + opts.eps, opts.power),
    outcome: binaryOutcome(s.test.outcome)!,
  }));
  const used: Neighbour[] =
    c.status === 'measured'
      ? c.measuredTests.map((t) => ({ test: t, distance: testDistance(q, t, opts).total, weight: 1, outcome: binaryOutcome(t.outcome)! }))
      : neighbours;

  const sw = used.reduce((s, n) => s + n.weight, 0);
  const pBurn = used.reduce((s, n) => s + n.weight * (n.outcome === 'burn' ? 1 : 0), 0) / sw;
  const sw2 = used.reduce((s, n) => s + n.weight * n.weight, 0);
  const nEff = (sw * sw) / sw2;
  let interval = wilson(pBurn, nEff);
  if (c.status === 'extrapolated') interval = [0, 1]; // honest: no bound outside the data
  return {
    status: c.status,
    pBurn,
    interval,
    predicted: pBurn >= 0.5 ? 'burn' : 'noburn',
    neighbours,
    measuredTests: c.measuredTests,
    nearestDistance: c.nearestDistance,
    bracket: c.bracket,
    outOfRange: c.outOfRange,
    poolSize: pool.length,
    phaseFallback,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Numeric targets (kNN regression)

export type NumericTarget = 'spreadRateMmS' | 'burningRateMm2S' | 'particleSizeNm' | 'smokePointLengthMm';
export const NUMERIC_TARGETS: NumericTarget[] = ['spreadRateMmS', 'burningRateMm2S', 'particleSizeNm', 'smokePointLengthMm'];
export const TARGET_LABEL: Record<NumericTarget, string> = {
  spreadRateMmS: 'Flame spread rate',
  burningRateMm2S: 'Droplet burning-rate constant',
  particleSizeNm: 'Smoke particle size',
  smokePointLengthMm: 'Smoke-point flame length',
};
export const TARGET_UNIT: Record<NumericTarget, string> = {
  spreadRateMmS: 'mm/s',
  burningRateMm2S: 'mm²/s',
  particleSizeNm: 'nm',
  smokePointLengthMm: 'mm',
};

/** Numeric target of a row: top-level field, or (for not-yet-contracted fields) the same key in `extra`. */
export function targetValue(t: TestRow, target: NumericTarget): number | null {
  const top = (t as unknown as Record<string, unknown>)[target];
  const v = top !== undefined && top !== null ? top : t.extra?.[target];
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export interface NumericNeighbour {
  test: TestRow;
  distance: number;
  weight: number;
  value: number;
}

export interface NumericEstimate {
  target: NumericTarget;
  status: AnswerStatus;
  /** inverse-distance-weighted mean of the k nearest values (mean of the matching tests when Measured) */
  value: number | null;
  /** min–max of the values that produced the estimate */
  range: [number, number] | null;
  /** weighted standard deviation of those values */
  spread: number | null;
  neighbours: NumericNeighbour[];
  measuredTests: TestRow[];
  nearestDistance: number | null;
  outOfRange: OutOfRange[];
  poolSize: number;
  reasons: string[];
}

/**
 * kNN regression for a numeric outcome with the same distance and Measured / Interpolated /
 * Extrapolated rules as estimate(). No fuel-phase fallback: a spread rate is never borrowed from
 * droplets or gas flames.
 */
export function estimateNumeric(
  q: Query,
  tests: TestRow[],
  target: NumericTarget,
  options: Partial<EstimateOptions> = {},
): NumericEstimate {
  const opts = { ...DEFAULT_ESTIMATE_OPTIONS, ...options };
  const withTarget = tests.filter((t) => targetValue(t, target) !== null);
  const pool = q.fuelPhase ? withTarget.filter((t) => t.fuelPhase === q.fuelPhase) : withTarget;
  const reasons: string[] = [];
  if (pool.length === 0) {
    return {
      target, status: 'extrapolated', value: null, range: null, spread: null, neighbours: [], measuredTests: [],
      nearestDistance: null, outOfRange: [], poolSize: 0,
      reasons: [`No ${q.fuelPhase ? `${q.fuelPhase}-fuel ` : ''}tests report ${TARGET_LABEL[target].toLowerCase()}.`],
    };
  }
  const c = classify(q, pool, opts, false, reasons);
  const neighbours: NumericNeighbour[] = c.scored.slice(0, Math.min(opts.k, c.scored.length)).map((s) => ({
    test: s.test,
    distance: s.distance,
    weight: 1 / Math.pow(s.distance + opts.eps, opts.power),
    value: targetValue(s.test, target)!,
  }));
  const used: NumericNeighbour[] =
    c.status === 'measured'
      ? c.measuredTests.map((t) => ({ test: t, distance: testDistance(q, t, opts).total, weight: 1, value: targetValue(t, target)! }))
      : neighbours;
  const sw = used.reduce((s, n) => s + n.weight, 0);
  const value = used.reduce((s, n) => s + n.weight * n.value, 0) / sw;
  const variance = used.reduce((s, n) => s + n.weight * (n.value - value) ** 2, 0) / sw;
  const vals = used.map((n) => n.value);
  return {
    target,
    status: c.status,
    value,
    range: [Math.min(...vals), Math.max(...vals)],
    spread: Math.sqrt(variance),
    neighbours,
    measuredTests: c.measuredTests,
    nearestDistance: c.nearestDistance,
    outOfRange: c.outOfRange,
    poolSize: pool.length,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Relevance (mission lens)

export interface RelevanceWeights {
  consequence: number;
  evidence: number;
  proximity: number;
}
export const DEFAULT_WEIGHTS: RelevanceWeights = { consequence: 1, evidence: 1, proximity: 1 };

export type FindingStatus = 'known' | 'extrapolating' | 'unknown';

export interface EvidenceStrength {
  score: number;
  nTestsScore: number;
  flightScore: number;
  rawScore: number;
}

/** Evidence strength in (0,1]: number of tests (log-scaled, saturates ~150), flight vs ground, raw data. */
export function evidenceStrength(inv: Pick<Investigation, 'nTests' | 'flight' | 'rawDataAvailable'>): EvidenceStrength {
  const n = inv.nTests ?? 0;
  const nTestsScore = Math.min(1, Math.log10(1 + n) / Math.log10(151));
  const flightScore = inv.flight === true ? 1 : inv.flight === false ? 0.6 : 0.75;
  const rawScore = inv.rawDataAvailable === true ? 1 : inv.rawDataAvailable === false ? 0.8 : 0.85;
  const score = Math.max(0.05, (0.15 + 0.85 * nTestsScore) * flightScore * rawScore);
  return { score, nTestsScore, flightScore, rawScore };
}

export function consequenceScore(inv: Pick<Investigation, 'safetyConsequence'>): number {
  const c = inv.safetyConsequence ?? 1;
  return Math.max(1, Math.min(3, c)) / 3;
}

/** Normalized distance from a query point to a box of condition ranges. */
export function boxDistance(
  q: Query,
  box: Partial<Record<Dim, Range>>,
  scales: Record<Dim, number> = DEFAULT_SCALES,
): { distance: number; perDim: Partial<Record<Dim, number>>; missing: Dim[] } {
  let sum = 0;
  const perDim: Partial<Record<Dim, number>> = {};
  const missing: Dim[] = [];
  for (const dim of DIMS) {
    const qv = q[dim];
    if (qv === null || qv === undefined) continue;
    const r = box[dim];
    if (!r) {
      missing.push(dim);
      sum += MISSING_PROXIMITY_PENALTY ** 2;
      continue;
    }
    const [lo, hi] = r[0] <= r[1] ? r : [r[1], r[0]];
    const [a, b] = Array.isArray(qv) ? [Math.min(...qv), Math.max(...qv)] : [qv, qv];
    const g = b < lo ? lo - b : a > hi ? a - hi : 0;
    perDim[dim] = g / scales[dim];
    sum += perDim[dim]! ** 2;
  }
  return { distance: Math.sqrt(sum), perDim, missing };
}

/** Tested condition box: investigation.conditions, filled from its test rows where null. */
export function conditionBox(inv: Investigation, invTests: TestRow[]): Partial<Record<Dim, Range>> {
  const box: Partial<Record<Dim, Range>> = {};
  for (const dim of DIMS) {
    const declared = inv.conditions?.[dim] ?? null;
    const fromTests = rangeOf(invTests.map((t) => t[dim]));
    box[dim] = declared && fromTests
      ? [Math.min(declared[0], fromTests[0]), Math.max(declared[1], fromTests[1])]
      : declared ?? fromTests;
  }
  return box;
}

/** Proximity falls off gently with normalized distance: 1 at 0, 0.5 at 2 units, 0.2 at 4 units. */
export const proximityKernel = (d: number) => 1 / (1 + (d / 2) ** 2);
/** Multiplier on proximity when the investigation's fuel phase differs from the query's. */
export const PHASE_FACTOR = 0.25;

export interface Proximity {
  score: number;
  distance: number;
  basis: 'tests' | 'ranges' | 'none';
  phaseFactor: number;
  phaseMatch: boolean | null;
  boxPerDim: Partial<Record<Dim, number>>;
  missing: Dim[];
}

export function proximity(
  inv: Investigation,
  invTests: TestRow[],
  q: Query,
  scales: Record<Dim, number> = DEFAULT_SCALES,
): Proximity {
  const box = conditionBox(inv, invTests);
  const bd = boxDistance(q, box, scales);
  const conditionQuery: Query = { ...q, fuelPhase: null, fuel: null };
  const withValues = invTests.filter((t) => DIMS.some((d) => t[d] !== null && t[d] !== undefined));
  let distance: number;
  let basis: Proximity['basis'];
  if (withValues.length > 0) {
    distance = Math.min(
      ...withValues.map((t) => {
        const d = testDistance(conditionQuery, t, { scales, gravityAware: false });
        const nMissing = (d.terms.missing ?? 0) / MISSING_PENALTY;
        // swap the kNN missing penalty for the (larger) ranking penalty
        const extra = nMissing * nMissing * (MISSING_PROXIMITY_PENALTY ** 2 - MISSING_PENALTY ** 2);
        return Math.sqrt(d.total ** 2 + Math.max(0, extra));
      }),
    );
    basis = 'tests';
  } else if (DIMS.some((d) => box[d])) {
    distance = bd.distance;
    basis = 'ranges';
  } else {
    distance = 3;
    basis = 'none';
  }
  const phase = inv.fuelPhase;
  const phaseMatch = q.fuelPhase && phase ? q.fuelPhase === phase : null;
  const phaseFactor = phaseMatch === null ? (q.fuelPhase && !phase ? 0.7 : 1) : phaseMatch ? 1 : PHASE_FACTOR;
  const score = Math.max(0.01, proximityKernel(distance) * phaseFactor);
  return { score, distance, basis, phaseFactor, phaseMatch, boxPerDim: bd.perDim, missing: bd.missing };
}

export function findingStatus(
  inv: Investigation,
  invTests: TestRow[],
  q: Query,
  scales: Record<Dim, number> = DEFAULT_SCALES,
): { status: FindingStatus; reasons: string[] } {
  const reasons: string[] = [];
  if (q.fuelPhase && inv.fuelPhase && q.fuelPhase !== inv.fuelPhase) {
    reasons.push(`Different fuel phase (${inv.fuelPhase} vs ${q.fuelPhase}); results transfer only qualitatively.`);
    return { status: 'unknown', reasons };
  }
  const box = conditionBox(inv, invTests);
  if (!DIMS.some((d) => box[d])) {
    reasons.push('Tested conditions are not documented.');
    return { status: 'unknown', reasons };
  }
  const bd = boxDistance(q, box, scales);
  if (bd.missing.includes('o2Pct') || bd.missing.includes('pressureKpa')) {
    for (const d of bd.missing) reasons.push(`${DIM_LABEL[d]} not documented for this investigation.`);
    reasons.push('Cannot place mission conditions relative to the tests.');
    return { status: 'unknown', reasons };
  }
  const outside = DIMS.filter((d) => (bd.perDim[d] ?? 0) > 0);
  for (const d of outside) {
    const r = box[d]!;
    reasons.push(`${DIM_LABEL[d]} outside tested ${fmt(r[0])}–${fmt(r[1])} ${DIM_UNIT[d]}.`);
  }
  for (const d of bd.missing) reasons.push(`${DIM_LABEL[d]} not documented for this investigation.`);
  if (outside.length === 0 && bd.missing.length === 0) {
    reasons.push('Mission conditions lie inside the tested ranges.');
    return { status: 'known', reasons };
  }
  if (bd.distance <= 2.5) return { status: 'extrapolating', reasons };
  reasons.push(`Far from tested conditions (${bd.distance.toFixed(1)} normalized units).`);
  return { status: 'unknown', reasons };
}

export interface Relevance {
  inv: Investigation;
  score: number;
  consequence: number;
  evidence: EvidenceStrength;
  proximity: Proximity;
  status: FindingStatus;
  statusReasons: string[];
}

/** Weighted geometric mean: exp(sum w_i ln x_i / sum w_i). All weights 0 -> 1. */
export function weightedGeoMean(values: number[], weights: number[]): number {
  let sw = 0;
  let s = 0;
  values.forEach((v, i) => {
    const w = Math.max(0, weights[i] ?? 0);
    sw += w;
    s += w * Math.log(Math.max(1e-6, v));
  });
  return sw === 0 ? 1 : Math.exp(s / sw);
}

export function relevance(
  inv: Investigation,
  invTests: TestRow[],
  q: Query,
  weights: RelevanceWeights = DEFAULT_WEIGHTS,
  scales: Record<Dim, number> = DEFAULT_SCALES,
): Relevance {
  const consequence = consequenceScore(inv);
  const evidence = evidenceStrength(inv);
  const regime = regimeTests(invTests, q.gravityG);
  const prox = proximity(inv, regime, q, scales);
  const score = weightedGeoMean(
    [consequence, evidence.score, prox.score],
    [weights.consequence, weights.evidence, weights.proximity],
  );
  const fs = findingStatus(inv, regime, q, scales);
  return { inv, score, consequence, evidence, proximity: prox, status: fs.status, statusReasons: fs.reasons };
}

/**
 * Tests from the gravity regime closest to the query: microgravity (g <= 0.01, or unreported)
 * for queries below 0.5 g, Earth-gravity (g >= 0.9) otherwise. Keeps 1 g ground-reference rows
 * from widening an investigation's "tested range" for a space mission (and vice versa).
 */
export function regimeTests(tests: TestRow[], gravityG: number | null | undefined): TestRow[] {
  const ground = gravityG != null && gravityG >= 0.5;
  return tests.filter((t) => (ground ? t.gravityG !== null && t.gravityG >= 0.9 : t.gravityG === null || t.gravityG <= 0.01));
}

export function groupTests(tests: TestRow[]): Map<string, TestRow[]> {
  const m = new Map<string, TestRow[]>();
  for (const t of tests) {
    const arr = m.get(t.inv);
    if (arr) arr.push(t);
    else m.set(t.inv, [t]);
  }
  return m;
}

export function rankInvestigations(
  invs: Investigation[],
  tests: TestRow[],
  q: Query,
  weights: RelevanceWeights = DEFAULT_WEIGHTS,
  scales: Record<Dim, number> = DEFAULT_SCALES,
): Relevance[] {
  const byInv = groupTests(tests);
  return invs
    .map((inv) => relevance(inv, byInv.get(inv.id) ?? [], q, weights, scales))
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Gravity bracket

export interface GravityBracket {
  micro: Estimate | null;
  ground: Estimate | null;
  pRange: [number, number] | null;
  spreadMicro: number | null;
  spreadGround: number | null;
  nMicro: number;
  nGround: number;
}

function weightedSpread(e: Estimate | null): number | null {
  if (!e) return null;
  const withRate = e.neighbours.filter((n) => n.test.spreadRateMmS != null);
  if (withRate.length === 0) return null;
  const sw = withRate.reduce((s, n) => s + n.weight, 0);
  return withRate.reduce((s, n) => s + n.weight * (n.test.spreadRateMmS as number), 0) / sw;
}

/** Brackets partial gravity between microgravity (g <= 0.01) and Earth-gravity (g >= 0.9) tests. */
export function gravityBracket(q: Query, tests: TestRow[], options: Partial<EstimateOptions> = {}): GravityBracket {
  const micro = tests.filter((t) => t.gravityG !== null && t.gravityG <= 0.01);
  const ground = tests.filter((t) => t.gravityG !== null && t.gravityG >= 0.9);
  const qq: Query = { ...q, gravityG: null };
  const em = usableTests(micro).length ? estimate(qq, micro, options) : null;
  const eg = usableTests(ground).length ? estimate(qq, ground, options) : null;
  // a bracket needs both ends; one side alone is not a range
  const pm = em?.pBurn;
  const pg = eg?.pBurn;
  const both = pm != null && pg != null;
  return {
    micro: em,
    ground: eg,
    pRange: both ? [Math.min(pm, pg), Math.max(pm, pg)] : null,
    spreadMicro: weightedSpread(em),
    spreadGround: weightedSpread(eg),
    nMicro: micro.length,
    nGround: ground.length,
  };
}

// ---------------------------------------------------------------------------
// Backtests

export function queryFromTest(t: TestRow, withMaterial = true): Query {
  return {
    o2Pct: t.o2Pct,
    pressureKpa: t.pressureKpa,
    flowCmS: t.flowCmS,
    fuelPhase: t.fuelPhase,
    fuel: withMaterial ? t.fuel : null,
    gravityG: t.gravityG,
  };
}

export interface LootDetail {
  inv: string;
  testId: string;
  fuelPhase: FuelPhase | null;
  actual: Binary;
  predicted: Binary | null;
  pBurn: number | null;
  status: AnswerStatus;
  correct: boolean;
  /** grouped variant: same-investigation replicates removed together with this test */
  replicatesRemoved?: number;
}

export type StatusCounts = Record<AnswerStatus, { n: number; correct: number }>;

/**
 * Accuracy of a set of predictions, always reported with its majority-class baseline.
 *  - baseline: always predict `baseline.predicts` (by default the most common outcome *in this set*,
 *    an optimistic baseline because it knows the set's class balance).
 *  - flaggingRate: of the wrong answers, the share the system had labelled Extrapolated
 *    (did it warn you when it was wrong?). `confidentWrong` = wrong and labelled Measured/Interpolated.
 */
export interface ClassMetrics {
  n: number;
  correct: number;
  accuracy: number | null;
  baseline: { predicts: Binary | null; correct: number; accuracy: number | null };
  byStatus: StatusCounts;
  wrong: number;
  wrongFlagged: number;
  confidentWrong: number;
  flaggingRate: number | null;
}

export function majorityClass(labels: Binary[]): Binary | null {
  if (labels.length === 0) return null;
  const burn = labels.filter((l) => l === 'burn').length;
  return burn > labels.length - burn ? 'burn' : 'noburn';
}

export function classMetrics(details: LootDetail[], baselineClass?: Binary | null): ClassMetrics {
  const byStatus: StatusCounts = {
    measured: { n: 0, correct: 0 },
    interpolated: { n: 0, correct: 0 },
    extrapolated: { n: 0, correct: 0 },
  };
  let correct = 0;
  let wrongFlagged = 0;
  for (const d of details) {
    byStatus[d.status].n += 1;
    if (d.correct) {
      correct += 1;
      byStatus[d.status].correct += 1;
    } else if (d.status === 'extrapolated') wrongFlagged += 1;
  }
  const n = details.length;
  const predicts = baselineClass === undefined ? majorityClass(details.map((d) => d.actual)) : baselineClass;
  const bCorrect = predicts ? details.filter((d) => d.actual === predicts).length : 0;
  const wrong = n - correct;
  return {
    n,
    correct,
    accuracy: n ? correct / n : null,
    baseline: { predicts, correct: bCorrect, accuracy: n ? bCorrect / n : null },
    byStatus,
    wrong,
    wrongFlagged,
    confidentWrong: wrong - wrongFlagged,
    flaggingRate: wrong ? wrongFlagged / wrong : null,
  };
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

function metricsBy(details: LootDetail[], key: (d: LootDetail) => string): Record<string, ClassMetrics> {
  const out: Record<string, ClassMetrics> = {};
  for (const [k, ds] of groupBy(details, key)) out[k] = classMetrics(ds);
  return out;
}

export interface LootResult {
  grouped: boolean;
  n: number;
  correct: number;
  overall: ClassMetrics;
  perInvestigation: Record<string, ClassMetrics>;
  byPhase: Record<string, ClassMetrics>;
  byStatus: StatusCounts;
  /** grouped variant: total replicate rows removed across all hold-outs, and how many hold-outs removed any */
  replicates?: { removedTotal: number; testsWithReplicates: number };
  details: LootDetail[];
}

/**
 * Replicates of `t` in `pool`: tests of the same investigation that would count as a Measured
 * match for a query at t's conditions (same phase and material, within DEFAULT/opts tolerance).
 * Does not include t itself.
 */
export function replicatesOf(t: TestRow, pool: TestRow[], tolerance: Record<Dim, number> = DEFAULT_TOLERANCE): TestRow[] {
  const q = queryFromTest(t);
  return pool.filter((o) => o !== t && o.inv === t.inv && withinTolerance(q, o, tolerance));
}

export interface LeaveOutOptions {
  /** also remove same-investigation replicates (Measured-tolerance twins) of the held-out test */
  grouped?: boolean;
}

/** Leave-one-test-out: predict each test's binary outcome from all other tests. */
export function leaveOneTestOut(
  tests: TestRow[],
  options: Partial<EstimateOptions> = {},
  leaveOut: LeaveOutOptions = {},
): LootResult {
  const opts = { ...DEFAULT_ESTIMATE_OPTIONS, gravityAware: true, ...options };
  const usable = usableTests(tests);
  const details: LootDetail[] = [];
  let removedTotal = 0;
  let testsWithReplicates = 0;
  usable.forEach((t, i) => {
    let rest = usable.filter((_, j) => j !== i);
    let replicatesRemoved: number | undefined;
    if (leaveOut.grouped) {
      const twins = new Set(replicatesOf(t, rest, opts.tolerance));
      rest = rest.filter((o) => !twins.has(o));
      replicatesRemoved = twins.size;
      removedTotal += twins.size;
      if (twins.size) testsWithReplicates += 1;
    }
    const e = estimate(queryFromTest(t), rest, opts);
    const actual = binaryOutcome(t.outcome)!;
    const d: LootDetail = {
      inv: t.inv,
      testId: t.testId,
      fuelPhase: t.fuelPhase,
      actual,
      predicted: e.predicted,
      pBurn: e.pBurn,
      status: e.status,
      correct: e.predicted === actual,
    };
    if (replicatesRemoved !== undefined) d.replicatesRemoved = replicatesRemoved;
    details.push(d);
  });
  const overall = classMetrics(details);
  return {
    grouped: !!leaveOut.grouped,
    n: overall.n,
    correct: overall.correct,
    overall,
    perInvestigation: metricsBy(details, (d) => d.inv),
    byPhase: metricsBy(details, (d) => d.fuelPhase ?? 'unknown'),
    byStatus: overall.byStatus,
    ...(leaveOut.grouped ? { replicates: { removedTotal, testsWithReplicates } } : {}),
    details,
  };
}

export interface LoioDetail extends ClassMetrics {
  inv: string;
  fuelPhase: FuelPhase | null;
  statusCounts: Record<AnswerStatus, number>;
  /** baseline that a transfer method could actually know: majority outcome of the *other* investigations */
  trainMajority: { predicts: Binary | null; correct: number; accuracy: number | null };
}

export interface LoioResult {
  /** number of hidden investigations */
  investigations: number;
  /** strict, test level: correct predictions only */
  overall: ClassMetrics;
  /** sum over investigations of the "majority of the other investigations" baseline */
  trainMajority: { correct: number; accuracy: number | null };
  byPhase: Record<string, ClassMetrics>;
  tests: { n: number; correct: number; byStatus: StatusCounts; details: LootDetail[] };
  details: LoioDetail[];
}

/**
 * Leave-one-investigation-out ("hide an experiment"): remove every test of one investigation,
 * then estimate each hidden test from the remaining investigations only.
 * Reported strictly (a test counts only if the predicted outcome is right), together with the
 * flagging rate: the share of wrong answers that the system had labelled Extrapolated.
 */
export function leaveOneInvestigationOut(tests: TestRow[], options: Partial<EstimateOptions> = {}): LoioResult {
  const usable = usableTests(tests);
  const invIds = [...new Set(usable.map((t) => t.inv))];
  const all: LootDetail[] = [];
  const details: LoioDetail[] = [];
  let tmCorrect = 0;
  for (const inv of invIds) {
    const hidden = usable.filter((t) => t.inv === inv);
    const rest = usable.filter((t) => t.inv !== inv);
    const ds: LootDetail[] = hidden.map((t) => {
      const e = estimate(queryFromTest(t), rest, { gravityAware: true, ...options });
      const actual = binaryOutcome(t.outcome)!;
      return { inv, testId: t.testId, fuelPhase: t.fuelPhase, actual, predicted: e.predicted, pBurn: e.pBurn, status: e.status, correct: e.predicted === actual };
    });
    all.push(...ds);
    const m = classMetrics(ds);
    const tmClass = majorityClass(rest.map((t) => binaryOutcome(t.outcome)!));
    const tm = tmClass ? ds.filter((d) => d.actual === tmClass).length : 0;
    tmCorrect += tm;
    details.push({
      inv,
      fuelPhase: hidden[0]?.fuelPhase ?? null,
      ...m,
      statusCounts: { measured: m.byStatus.measured.n, interpolated: m.byStatus.interpolated.n, extrapolated: m.byStatus.extrapolated.n },
      trainMajority: { predicts: tmClass, correct: tm, accuracy: ds.length ? tm / ds.length : null },
    });
  }
  const overall = classMetrics(all);
  return {
    investigations: details.length,
    overall,
    trainMajority: { correct: tmCorrect, accuracy: all.length ? tmCorrect / all.length : null },
    byPhase: metricsBy(all, (d) => d.fuelPhase ?? 'unknown'),
    tests: { n: overall.n, correct: overall.correct, byStatus: overall.byStatus, details: all },
    details,
  };
}

// ---------------------------------------------------------------------------
// Numeric backtests

export interface NumericDetail {
  inv: string;
  testId: string;
  fuelPhase: FuelPhase | null;
  actual: number;
  predicted: number | null;
  status: AnswerStatus;
  baselineInvMean: number | null;
  baselineGlobalMean: number | null;
  replicatesRemoved?: number;
}

export interface ErrorStats {
  n: number;
  mae: number | null;
  /** median of |pred - actual| / |actual| (rows with actual = 0 skipped) */
  medianAbsPctErr: number | null;
}

export interface NumericMetrics {
  /** rows with a value for the target */
  n: number;
  /** rows for which a prediction could be made (same fuel phase data left after hold-out) */
  nPredicted: number;
  model: ErrorStats;
  /** predict the mean of the remaining rows of the same investigation (global mean if none left) */
  baselineInvMean: ErrorStats;
  /** predict the mean of all remaining rows */
  baselineGlobalMean: ErrorStats;
  byStatus: Record<AnswerStatus, ErrorStats>;
}

export interface NumericBacktest {
  target: NumericTarget;
  unit: string;
  grouped: boolean;
  overall: NumericMetrics;
  perInvestigation: Record<string, NumericMetrics>;
  byPhase: Record<string, NumericMetrics>;
  details: NumericDetail[];
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function errorStats(pairs: [number | null, number][]): ErrorStats {
  const ok = pairs.filter((p): p is [number, number] => p[0] !== null);
  if (!ok.length) return { n: 0, mae: null, medianAbsPctErr: null };
  const mae = ok.reduce((s, [p, a]) => s + Math.abs(p - a), 0) / ok.length;
  const pct = ok.filter(([, a]) => a !== 0).map(([p, a]) => Math.abs(p - a) / Math.abs(a));
  return { n: ok.length, mae, medianAbsPctErr: median(pct) };
}

export function numericMetrics(details: NumericDetail[]): NumericMetrics {
  const predicted = details.filter((d) => d.predicted !== null);
  const byStatus = {} as Record<AnswerStatus, ErrorStats>;
  for (const s of ['measured', 'interpolated', 'extrapolated'] as AnswerStatus[]) {
    byStatus[s] = errorStats(predicted.filter((d) => d.status === s).map((d) => [d.predicted, d.actual]));
  }
  return {
    n: details.length,
    nPredicted: predicted.length,
    model: errorStats(predicted.map((d) => [d.predicted, d.actual])),
    // baselines scored on the same rows as the model, so n matches
    baselineInvMean: errorStats(predicted.map((d) => [d.baselineInvMean, d.actual])),
    baselineGlobalMean: errorStats(predicted.map((d) => [d.baselineGlobalMean, d.actual])),
    byStatus,
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/**
 * Leave-one-test-out for a numeric target (optionally grouped: replicates removed too).
 * Only rows reporting the target take part. Baselines use exactly the rows the model could see.
 */
export function leaveOneOutNumeric(
  tests: TestRow[],
  target: NumericTarget,
  options: Partial<EstimateOptions> = {},
  leaveOut: LeaveOutOptions = {},
): NumericBacktest {
  const opts = { ...DEFAULT_ESTIMATE_OPTIONS, gravityAware: true, ...options };
  const rows = tests.filter((t) => targetValue(t, target) !== null);
  const details: NumericDetail[] = rows.map((t, i) => {
    let rest = rows.filter((_, j) => j !== i);
    let replicatesRemoved: number | undefined;
    if (leaveOut.grouped) {
      const twins = new Set(replicatesOf(t, rest, opts.tolerance));
      rest = rest.filter((o) => !twins.has(o));
      replicatesRemoved = twins.size;
    }
    const e = estimateNumeric(queryFromTest(t), rest, target, opts);
    const restVals = rest.map((o) => targetValue(o, target)!);
    const global = mean(restVals);
    const own = mean(rest.filter((o) => o.inv === t.inv).map((o) => targetValue(o, target)!));
    const d: NumericDetail = {
      inv: t.inv,
      testId: t.testId,
      fuelPhase: t.fuelPhase,
      actual: targetValue(t, target)!,
      predicted: e.value,
      status: e.status,
      baselineInvMean: own ?? global,
      baselineGlobalMean: global,
    };
    if (replicatesRemoved !== undefined) d.replicatesRemoved = replicatesRemoved;
    return d;
  });
  const per = (key: (d: NumericDetail) => string) => {
    const out: Record<string, NumericMetrics> = {};
    for (const [k, ds] of groupBy(details, key)) out[k] = numericMetrics(ds);
    return out;
  };
  return {
    target,
    unit: TARGET_UNIT[target],
    grouped: !!leaveOut.grouped,
    overall: numericMetrics(details),
    perInvestigation: per((d) => d.inv),
    byPhase: per((d) => d.fuelPhase ?? 'unknown'),
    details,
  };
}

// ---------------------------------------------------------------------------
// Data coverage and provenance

export type OutcomeDerivation = 'source-table' | 'report' | 'keyword-rule';

/**
 * How a row's outcome was obtained. Reads `extra.outcomeDerivation` when present; otherwise
 * infers "keyword-rule" from the older free-text `extra.outcomeDerivedFrom` note. null = not stated.
 */
export function outcomeDerivation(t: TestRow): OutcomeDerivation | null {
  const d = t.extra?.outcomeDerivation;
  if (d === 'source-table' || d === 'report' || d === 'keyword-rule') return d;
  const legacy = t.extra?.outcomeDerivedFrom;
  if (typeof legacy === 'string' && /keyword/i.test(legacy)) return 'keyword-rule';
  return null;
}

/** Share of an investigation's rows *with an outcome* whose outcome came from keyword rules on free-text notes. */
export function keywordRuleShare(invTests: TestRow[]): { withOutcome: number; keyword: number; share: number | null } {
  const withOutcome = invTests.filter((t) => binaryOutcome(t.outcome) !== null);
  const keyword = withOutcome.filter((t) => outcomeDerivation(t) === 'keyword-rule').length;
  return { withOutcome: withOutcome.length, keyword, share: withOutcome.length ? keyword / withOutcome.length : null };
}

export interface CoverageRow {
  inv: string;
  fuelPhase: FuelPhase | null;
  rows: number;
  /** rows with a burn / no-burn outcome */
  outcome: number;
  targets: Record<NumericTarget, number>;
  /** rows that take part in no estimate at all */
  none: number;
  derivation: Record<OutcomeDerivation | 'unstated', number>;
}

export function dataCoverage(tests: TestRow[]): { perInvestigation: CoverageRow[]; total: CoverageRow } {
  const make = (inv: string, rows: TestRow[]): CoverageRow => {
    const targets = {} as Record<NumericTarget, number>;
    for (const k of NUMERIC_TARGETS) targets[k] = rows.filter((t) => targetValue(t, k) !== null).length;
    const derivation: CoverageRow['derivation'] = { 'source-table': 0, report: 0, 'keyword-rule': 0, unstated: 0 };
    let outcome = 0;
    let none = 0;
    for (const t of rows) {
      const hasOutcome = binaryOutcome(t.outcome) !== null;
      if (hasOutcome) {
        outcome += 1;
        derivation[outcomeDerivation(t) ?? 'unstated'] += 1;
      }
      if (!hasOutcome && NUMERIC_TARGETS.every((k) => targetValue(t, k) === null)) none += 1;
    }
    const phases = new Set(rows.map((t) => t.fuelPhase));
    return { inv, fuelPhase: phases.size === 1 ? rows[0]?.fuelPhase ?? null : null, rows: rows.length, outcome, targets, none, derivation };
  };
  const perInvestigation = [...groupTests(tests)].map(([inv, rows]) => make(inv, rows));
  return { perInvestigation, total: make('all', tests) };
}
