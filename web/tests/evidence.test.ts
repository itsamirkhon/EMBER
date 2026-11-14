import { describe, expect, it } from 'vitest';
import {
  binaryOutcome,
  boxDistance,
  classMetrics,
  dataCoverage,
  estimateNumeric,
  keywordRuleShare,
  leaveOneOutNumeric,
  outcomeDerivation,
  replicatesOf,
  targetValue,
  estimate,
  evidenceStrength,
  findingStatus,
  gap,
  gravityBracket,
  leaveOneInvestigationOut,
  leaveOneTestOut,
  rankInvestigations,
  regimeTests,
  testDistance,
  weightedGeoMean,
  wilson,
  type Query,
} from '../src/lib/evidence';
import { buildDocs, buildIndex, search, supportingHits } from '../src/lib/retrieval';
import { testsToCsv } from '../src/lib/csv';
import type { Investigation, TestRow } from '../src/lib/types';
import fixtureInvs from '../fixtures/data/investigations.json';
import fixtureTests from '../fixtures/data/tests.json';
import fixtureClaims from '../fixtures/data/claims.json';

const invs = fixtureInvs as unknown as Investigation[];
const fx = fixtureTests as unknown as TestRow[];

function t(p: Partial<TestRow>): TestRow {
  return {
    inv: 'X', testId: Math.random().toString(36).slice(2), fuel: 'PMMA', fuelPhase: 'solid', geometry: null,
    thicknessMm: null, diameterMm: null, o2Pct: 21, pressureKpa: 101.3, flowCmS: 10, gravityG: 0, diluent: 'N2',
    diluentPct: null, outcome: 'burned', outcomeRaw: null, spreadRateMmS: null, burningRateMm2S: null,
    particleSizeNm: null, extra: {}, source: { sourceId: 's', file: 'f', row: 1 }, ...p,
  };
}

// A 3x3x3 grid in O2 / pressure / flow: burns above 18% O2.
const grid: TestRow[] = [];
for (const o2 of [15, 18.5, 22]) for (const p of [50, 75, 100]) for (const f of [0, 10, 20])
  grid.push(t({ o2Pct: o2, pressureKpa: p, flowCmS: f, outcome: o2 > 18 ? 'burned' : 'extinguished' }));

const q = (o2: number, p: number, f: number | [number, number], extra: Partial<Query> = {}): Query => ({
  o2Pct: o2, pressureKpa: p, flowCmS: f, fuelPhase: 'solid', ...extra,
});

describe('outcomes and helpers', () => {
  it('collapses contract outcomes to binary', () => {
    expect(binaryOutcome('flame_spread')).toBe('burn');
    expect(binaryOutcome('completed')).toBe('burn');
    expect(binaryOutcome('self_extinguished')).toBe('noburn');
    expect(binaryOutcome('no_ignition')).toBe('noburn');
    expect(binaryOutcome('unknown')).toBeNull();
    expect(binaryOutcome(null)).toBeNull();
  });
  it('gap handles intervals', () => {
    expect(gap(5, 8)).toBe(3);
    expect(gap([0, 20], 10)).toBe(0);
    expect(gap([0, 20], 25)).toBe(5);
  });
  it('wilson interval is within [0,1] and contains p', () => {
    const [lo, hi] = wilson(0.8, 5);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
    expect(lo).toBeLessThan(0.8);
    expect(hi).toBeGreaterThan(0.8);
  });
  it('weighted geometric mean', () => {
    expect(weightedGeoMean([0.5, 0.5], [1, 1])).toBeCloseTo(0.5);
    expect(weightedGeoMean([1, 0.25], [1, 1])).toBeCloseTo(0.5);
    expect(weightedGeoMean([1, 0.25], [0, 1])).toBeCloseTo(0.25);
    expect(weightedGeoMean([0.3], [0])).toBe(1);
  });
});

describe('testDistance', () => {
  it('is zero for an identical test and penalizes phase / material', () => {
    const row = t({});
    expect(testDistance(q(21, 101.3, 10), row).total).toBeCloseTo(0);
    expect(testDistance(q(21, 101.3, 10, { fuelPhase: 'gas' }), row).terms.phase).toBeGreaterThan(0);
    expect(testDistance(q(21, 101.3, 10, { fuel: 'Nomex' }), row).terms.material).toBeGreaterThan(0);
  });
  it('adds a penalty for missing test dimensions', () => {
    const d = testDistance(q(21, 101.3, 10), t({ flowCmS: null }));
    expect(d.terms.missing).toBeGreaterThan(0);
  });
});

describe('estimate status', () => {
  it('measured when a real test is within tolerance', () => {
    const e = estimate(q(22, 100, 10), grid);
    expect(e.status).toBe('measured');
    expect(e.predicted).toBe('burn');
    expect(e.measuredTests.length).toBe(1);
  });
  it('interpolated when bracketed by neighbours on every dimension', () => {
    const e = estimate(q(20, 85, 15), grid);
    expect(e.status).toBe('interpolated');
    expect(e.pBurn).not.toBeNull();
    expect(e.interval![0]).toBeLessThanOrEqual(e.pBurn!);
    expect(e.interval![1]).toBeGreaterThanOrEqual(e.pBurn!);
    for (const d of ['o2Pct', 'pressureKpa', 'flowCmS'] as const) {
      expect(e.bracket[d]).toEqual({ below: true, above: true });
    }
  });
  it('extrapolated outside the tested range, reporting excess', () => {
    const e = estimate(q(30, 70, 10), grid);
    expect(e.status).toBe('extrapolated');
    const o2 = e.outOfRange.find((o) => o.dim === 'o2Pct')!;
    expect(o2.excess).toBeCloseTo(8);
    expect(e.neighbours.length).toBe(5);
    expect(e.interval).toEqual([0, 1]);
    expect(e.reasons.join(' ')).toMatch(/outside the tested range/);
  });
  it('status flips from interpolated to extrapolated as O2 leaves the data', () => {
    const inside = estimate(q(20, 75, 10), grid).status;
    const outside = estimate(q(26, 75, 10), grid).status;
    expect(inside).not.toBe('extrapolated');
    expect(outside).toBe('extrapolated');
  });
  it('falls back to other phases (and flags it) when the phase has no tests', () => {
    const e = estimate(q(20, 75, 10, { fuelPhase: 'liquid' }), grid);
    expect(e.phaseFallback).toBe(true);
    expect(e.status).toBe('extrapolated');
  });
  it('handles an empty pool', () => {
    const e = estimate(q(20, 75, 10), []);
    expect(e.pBurn).toBeNull();
    expect(e.status).toBe('extrapolated');
  });
  it('ignores unknown outcomes', () => {
    const e = estimate(q(22, 100, 10), [t({ o2Pct: 22, pressureKpa: 100, outcome: 'unknown' })]);
    expect(e.poolSize).toBe(0);
  });
  it('accepts a flow interval query', () => {
    const e = estimate(q(22, 100, [5, 15]), grid);
    expect(e.status).toBe('measured');
  });
});

describe('relevance', () => {
  it('evidence strength grows with test count and flight data', () => {
    const a = evidenceStrength({ nTests: 5, flight: false, rawDataAvailable: false }).score;
    const b = evidenceStrength({ nTests: 120, flight: true, rawDataAvailable: true }).score;
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThanOrEqual(1);
  });
  it('box distance is zero inside', () => {
    expect(boxDistance(q(20, 80, 5), { o2Pct: [15, 21], pressureKpa: [50, 101], flowCmS: [0, 40] }).distance).toBe(0);
  });
  it('ranks solid-fuel investigations first for the lunar rover scenario', () => {
    const query: Query = { o2Pct: 30, pressureKpa: 70.3, flowCmS: [0, 20], fuelPhase: 'solid', gravityG: 0.166 };
    const ranked = rankInvestigations(invs, fx, query);
    expect(ranked.length).toBe(invs.length);
    expect(ranked[0].inv.fuelPhase).toBe('solid');
    // 1 g ground-reference rows must not make 30% O2 "known" for a lunar mission
    expect(ranked.find((r) => r.inv.id === 'BASS-II')!.status).not.toBe('known');
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    // weights change ordering: with only consequence weighted, high-consequence first
    const consOnly = rankInvestigations(invs, fx, query, { consequence: 1, evidence: 0, proximity: 0 });
    expect(consOnly[0].inv.safetyConsequence).toBe(3);
  });
  it('finding status: known / extrapolating / unknown', () => {
    const bass = invs.find((i) => i.id === 'BASS-II')!;
    const bt = regimeTests(fx.filter((x) => x.inv === 'BASS-II'), 0);
    expect(findingStatus(bass, bt, q(18, 80, 10)).status).toBe('known');
    expect(findingStatus(bass, bt, q(23, 80, 10)).status).toBe('extrapolating');
    expect(findingStatus(bass, bt, q(45, 80, 10)).status).toBe('unknown');
    expect(findingStatus(bass, bt, q(18, 80, 10, { fuelPhase: 'gas' })).status).toBe('unknown');
  });
});

describe('gravity bracket', () => {
  it('returns micro and ground estimates when both exist', () => {
    const g = gravityBracket({ o2Pct: 30, pressureKpa: 70.3, flowCmS: 0, fuelPhase: 'solid' }, fx);
    expect(g.micro).not.toBeNull();
    expect(g.ground).not.toBeNull();
    expect(g.pRange![0]).toBeLessThanOrEqual(g.pRange![1]);
    expect(g.nGround).toBeGreaterThan(0);
  });
});

describe('backtests', () => {
  it('leave-one-test-out is accurate on a clean grid', () => {
    const r = leaveOneTestOut(grid);
    expect(r.n).toBe(grid.length);
    expect(r.correct / r.n).toBeGreaterThan(0.8);
  });
  it('leave-one-investigation-out reports every investigation, strictly', () => {
    const r = leaveOneInvestigationOut(fx);
    const ids = new Set(fx.filter((x) => binaryOutcome(x.outcome)).map((x) => x.inv));
    expect(r.investigations).toBe(ids.size);
    let n = 0;
    let correct = 0;
    for (const d of r.details) {
      expect(d.statusCounts.measured + d.statusCounts.interpolated + d.statusCounts.extrapolated).toBe(d.n);
      expect(d.wrong).toBe(d.n - d.correct);
      expect(d.wrongFlagged + d.confidentWrong).toBe(d.wrong);
      n += d.n;
      correct += d.correct;
    }
    // overall accuracy counts correct predictions only — a flagged wrong answer is still wrong
    expect(r.overall.n).toBe(n);
    expect(r.overall.correct).toBe(correct);
  });
  it('classMetrics reports the majority baseline and flagging rate', () => {
    const d = (actual: 'burn' | 'noburn', predicted: 'burn' | 'noburn', status: 'measured' | 'extrapolated') =>
      ({ inv: 'X', testId: 'x', fuelPhase: 'solid' as const, actual, predicted, pBurn: null, status, correct: actual === predicted });
    const m = classMetrics([d('noburn', 'noburn', 'measured'), d('noburn', 'burn', 'extrapolated'), d('noburn', 'burn', 'measured'), d('burn', 'burn', 'measured')]);
    expect(m.accuracy).toBeCloseTo(0.5);
    expect(m.baseline.predicts).toBe('noburn');
    expect(m.baseline.accuracy).toBeCloseTo(0.75);
    expect(m.wrong).toBe(2);
    expect(m.wrongFlagged).toBe(1);
    expect(m.flaggingRate).toBeCloseTo(0.5);
  });
});

describe('grouped leave-one-test-out', () => {
  // two conditions, each with replicates whose outcomes disagree with a nearby other condition
  const reps: TestRow[] = [
    ...[0, 1, 2].map(() => t({ inv: 'A', o2Pct: 21, flowCmS: 10, outcome: 'burned' })),
    t({ inv: 'A', o2Pct: 21.3, flowCmS: 10.5, outcome: 'burned' }),
    ...[0, 1].map(() => t({ inv: 'A', o2Pct: 24, flowCmS: 10, outcome: 'extinguished' })),
    t({ inv: 'B', o2Pct: 21, flowCmS: 10, outcome: 'extinguished' }),
  ];
  it('replicatesOf finds same-investigation twins within the Measured tolerance only', () => {
    const r = replicatesOf(reps[0], reps);
    expect(r).toHaveLength(3); // the two exact copies and the 21.3% / 10.5 cm/s one; not B, not 24%
    expect(r.every((x) => x.inv === 'A' && x !== reps[0])).toBe(true);
  });
  it('removes twins so the hidden test cannot be copied', () => {
    const plain = leaveOneTestOut(reps);
    const grouped = leaveOneTestOut(reps, {}, { grouped: true });
    expect(plain.grouped).toBe(false);
    expect(grouped.grouped).toBe(true);
    const first = grouped.details[0];
    expect(first.replicatesRemoved).toBe(3);
    // plain: copies a twin (measured, burn); grouped: only B's test is Measured-close (different inv) -> noburn
    expect(plain.details[0].status).toBe('measured');
    expect(plain.details[0].correct).toBe(true);
    expect(first.predicted).toBe('noburn');
    expect(grouped.replicates!.removedTotal).toBeGreaterThan(0);
    expect(grouped.byPhase.solid.n).toBe(reps.length);
  });
});

describe('numeric kNN', () => {
  const rows: TestRow[] = [];
  for (const o2 of [15, 18, 21, 24]) for (const f of [0, 10, 20])
    rows.push(t({ inv: o2 < 20 ? 'L' : 'H', o2Pct: o2, flowCmS: f, spreadRateMmS: 0.1 * o2 + 0.01 * f }));
  it('estimates a value with the same status rules as estimate()', () => {
    const m = estimateNumeric(q(21, 101.3, 10), rows, 'spreadRateMmS');
    expect(m.status).toBe('measured');
    expect(m.value).toBeCloseTo(2.2);
    const i = estimateNumeric(q(19.5, 101.3, 5), rows, 'spreadRateMmS');
    expect(i.status).toBe('interpolated');
    expect(i.value!).toBeGreaterThan(1.5);
    expect(i.value!).toBeLessThan(2.5);
    const e = estimateNumeric(q(35, 101.3, 10), rows, 'spreadRateMmS');
    expect(e.status).toBe('extrapolated');
    expect(e.reasons.join(' ')).toMatch(/outside the tested range/);
  });
  it('never borrows a target across fuel phases', () => {
    const e = estimateNumeric(q(21, 101.3, 10, { fuelPhase: 'liquid' }), rows, 'spreadRateMmS');
    expect(e.value).toBeNull();
    expect(e.poolSize).toBe(0);
  });
  it('reads not-yet-contracted targets from extra', () => {
    const r = t({ extra: { smokePointLengthMm: '42.5' } });
    expect(targetValue(r, 'smokePointLengthMm')).toBe(42.5);
    expect(targetValue(t({}), 'particleSizeNm')).toBeNull();
  });
  it('leave-one-out regression reports MAE against mean baselines on the same rows', () => {
    const r = leaveOneOutNumeric(rows, 'spreadRateMmS');
    expect(r.overall.n).toBe(rows.length);
    expect(r.overall.model.n).toBe(r.overall.baselineGlobalMean.n);
    expect(r.overall.model.mae!).toBeLessThan(r.overall.baselineGlobalMean.mae!);
    const g = leaveOneOutNumeric([...rows, ...rows.map((x) => ({ ...x }))], 'spreadRateMmS', {}, { grouped: true });
    expect(g.grouped).toBe(true);
    expect(g.details.every((d) => d.replicatesRemoved! >= 1)).toBe(true);
    expect(g.details.every((d) => d.status !== 'measured')).toBe(true);
  });
});

describe('coverage and provenance', () => {
  it('classifies outcome derivation, including the legacy note', () => {
    expect(outcomeDerivation(t({ extra: { outcomeDerivation: 'report' } }))).toBe('report');
    expect(outcomeDerivation(t({ extra: { outcomeDerivedFrom: "keyword rules on 'Test Observations'" } }))).toBe('keyword-rule');
    expect(outcomeDerivation(t({}))).toBeNull();
    const share = keywordRuleShare([t({ extra: { outcomeDerivation: 'keyword-rule' } }), t({ outcome: 'unknown' }), t({})]);
    expect(share).toEqual({ withOutcome: 2, keyword: 1, share: 0.5 });
  });
  it('counts rows that take part in no estimate', () => {
    const c = dataCoverage([t({}), t({ outcome: 'unknown' }), t({ outcome: 'unknown', burningRateMm2S: 0.8 })]);
    expect(c.total.rows).toBe(3);
    expect(c.total.outcome).toBe(1);
    expect(c.total.targets.burningRateMm2S).toBe(1);
    expect(c.total.none).toBe(1);
  });
});

describe('retrieval', () => {
  const idx = buildIndex(buildDocs(fixtureClaims as never, invs));
  it('finds the CO2 suppression claim', () => {
    const hits = search(idx, 'How much CO2 is needed to extinguish droplet flames?');
    expect(hits[0].doc.inv).toBe('FLEX');
    expect(supportingHits(hits, 'How much CO2 is needed to extinguish droplet flames?').length).toBeGreaterThan(0);
  });
  it('returns no supporting evidence for off-topic questions', () => {
    const qn = 'What is the best pizza topping in Naples?';
    expect(supportingHits(search(idx, qn), qn)).toEqual([]);
  });
});

describe('csv', () => {
  it('escapes and includes source columns', () => {
    const csv = testsToCsv([t({ inv: 'BASS-II', fuel: 'cotton, "SIBAL"' })], invs);
    const [header, row] = csv.trim().split('\r\n');
    expect(header).toContain('sourceFile');
    expect(header).toContain('doi');
    expect(row).toContain('"cotton, ""SIBAL"""');
    expect(row).toContain('PSI-25');
  });
});
