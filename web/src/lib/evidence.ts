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

  const scored = pool
    .map((t) => ({ test: t, distance: testDistance(q, t, opts).total }))
    .sort((a, b) => a.distance - b.distance);

  const neighbours: Neighbour[] = scored.slice(0, Math.min(opts.k, scored.length)).map((s) => ({
    test: s.test,
    distance: s.distance,
    weight: 1 / Math.pow(s.distance + opts.eps, opts.power),
    outcome: binaryOutcome(s.test.outcome)!,
  }));

  // out-of-range per dimension against the whole pool
  const outOfRange: OutOfRange[] = [];
  for (const dim of DIMS) {
    const qv = q[dim];
    if (qv === null || qv === undefined) continue;
    const r = rangeOf(pool.map((t) => t[dim]));
    if (!r) continue;
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
  let used = neighbours;
  if (measuredTests.length > 0) {
    status = 'measured';
    reasons.push(
      `${measuredTests.length} real test${measuredTests.length > 1 ? 's' : ''} within tolerance (±${fmt(opts.tolerance.o2Pct)}% O₂, ±${fmt(opts.tolerance.pressureKpa)} kPa, ±${fmt(opts.tolerance.flowCmS)} cm/s).`,
    );
    used = measuredTests.map((t) => ({
      test: t,
      distance: testDistance(q, t, opts).total,
      weight: 1,
      outcome: binaryOutcome(t.outcome)!,
    }));
  } else if (!phaseFallback && bracketedAll && nearestDistance <= opts.maxInterpDistance) {
    status = 'interpolated';
    reasons.push('Real tests surround this point on every dimension; estimate is a weighted vote of nearest tests.');
  } else {
    status = 'extrapolated';
    for (const o of outOfRange) {
      if (o.excess > 0) {
        reasons.push(
          `${DIM_LABEL[o.dim]} ${fmt(o.value)} ${DIM_UNIT[o.dim]} is ${fmt(o.excess)} ${DIM_UNIT[o.dim]} outside the tested range ${fmt(o.min)}–${fmt(o.max)}.`,
        );
      }
    }
    for (const dim of DIMS) {
      const b = bracket[dim];
      if (local.length > 0 && b && !(b.below && b.above) && !outOfRange.find((o) => o.dim === dim && o.excess > 0)) {
        reasons.push(`No nearby tests on the ${b.below ? 'high' : 'low'} side of ${DIM_LABEL[dim]}.`);
      }
    }
    if (local.length === 0 || nearestDistance > opts.maxInterpDistance) {
      reasons.push(`Nearest test is ${nearestDistance.toFixed(2)} normalized units away.`);
    }
  }

  const sw = used.reduce((s, n) => s + n.weight, 0);
  const pBurn = used.reduce((s, n) => s + n.weight * (n.outcome === 'burn' ? 1 : 0), 0) / sw;
  const sw2 = used.reduce((s, n) => s + n.weight * n.weight, 0);
  const nEff = (sw * sw) / sw2;
  let interval = wilson(pBurn, nEff);
  if (status === 'extrapolated') interval = [0, 1]; // honest: no bound outside the data
  return {
    status,
    pBurn,
    interval,
    predicted: pBurn >= 0.5 ? 'burn' : 'noburn',
    neighbours,
    measuredTests,
    nearestDistance,
    bracket,
    outOfRange,
    poolSize: pool.length,
    phaseFallback,
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
  actual: Binary;
  predicted: Binary | null;
  pBurn: number | null;
  status: AnswerStatus;
  correct: boolean;
}

export interface LootResult {
  n: number;
  correct: number;
  perInvestigation: Record<string, { n: number; correct: number }>;
  byStatus: Record<AnswerStatus, { n: number; correct: number }>;
  details: LootDetail[];
}

/** Leave-one-test-out: predict each test's binary outcome from all other tests. */
export function leaveOneTestOut(tests: TestRow[], options: Partial<EstimateOptions> = {}): LootResult {
  const usable = usableTests(tests);
  const details: LootDetail[] = [];
  usable.forEach((t, i) => {
    const rest = usable.filter((_, j) => j !== i);
    const e = estimate(queryFromTest(t), rest, { gravityAware: true, ...options });
    const actual = binaryOutcome(t.outcome)!;
    details.push({
      inv: t.inv,
      testId: t.testId,
      actual,
      predicted: e.predicted,
      pBurn: e.pBurn,
      status: e.status,
      correct: e.predicted === actual,
    });
  });
  return summarize(details);
}

function summarize(details: LootDetail[]): LootResult {
  const perInvestigation: LootResult['perInvestigation'] = {};
  const byStatus: LootResult['byStatus'] = {
    measured: { n: 0, correct: 0 },
    interpolated: { n: 0, correct: 0 },
    extrapolated: { n: 0, correct: 0 },
  };
  let correct = 0;
  for (const d of details) {
    const p = (perInvestigation[d.inv] ??= { n: 0, correct: 0 });
    p.n += 1;
    byStatus[d.status].n += 1;
    if (d.correct) {
      correct += 1;
      p.correct += 1;
      byStatus[d.status].correct += 1;
    }
  }
  return { n: details.length, correct, perInvestigation, byStatus, details };
}

export interface LoioDetail {
  inv: string;
  n: number;
  predictionCorrect: number;
  statusCounts: Record<AnswerStatus, number>;
  /** tests where the system was right, or wrong but had flagged "extrapolated" */
  honest: number;
  honestRate: number;
  accuracy: number | null;
  /** investigation passes if honestRate >= passThreshold */
  correct: boolean;
}

export interface LoioResult {
  n: number;
  correct: number;
  passThreshold: number;
  tests: LootResult;
  details: LoioDetail[];
}

/**
 * Leave-one-investigation-out ("hide an experiment"): remove every test of one investigation,
 * then estimate each hidden test from the remaining investigations only.
 * A hidden test is handled *honestly* when the prediction is correct, or when it is wrong
 * but the system flagged the point as extrapolated (i.e. did not claim knowledge).
 */
export function leaveOneInvestigationOut(
  tests: TestRow[],
  options: Partial<EstimateOptions> = {},
  passThreshold = 0.75,
): LoioResult {
  const usable = usableTests(tests);
  const invIds = [...new Set(usable.map((t) => t.inv))];
  const all: LootDetail[] = [];
  const details: LoioDetail[] = [];
  for (const inv of invIds) {
    const hidden = usable.filter((t) => t.inv === inv);
    const rest = usable.filter((t) => t.inv !== inv);
    const statusCounts: Record<AnswerStatus, number> = { measured: 0, interpolated: 0, extrapolated: 0 };
    let predictionCorrect = 0;
    let honest = 0;
    for (const t of hidden) {
      const e = estimate(queryFromTest(t), rest, { gravityAware: true, ...options });
      const actual = binaryOutcome(t.outcome)!;
      const ok = e.predicted === actual;
      statusCounts[e.status] += 1;
      if (ok) predictionCorrect += 1;
      if (ok || e.status === 'extrapolated') honest += 1;
      all.push({ inv, testId: t.testId, actual, predicted: e.predicted, pBurn: e.pBurn, status: e.status, correct: ok });
    }
    const honestRate = hidden.length ? honest / hidden.length : 0;
    details.push({
      inv,
      n: hidden.length,
      predictionCorrect,
      statusCounts,
      honest,
      honestRate,
      accuracy: hidden.length ? predictionCorrect / hidden.length : null,
      correct: honestRate >= passThreshold,
    });
  }
  return {
    n: details.length,
    correct: details.filter((d) => d.correct).length,
    passThreshold,
    tests: summarize(all),
    details,
  };
}
