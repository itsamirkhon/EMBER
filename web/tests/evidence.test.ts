import { describe, expect, it } from 'vitest';
import {
  binaryOutcome,
  boxDistance,
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
  it('leave-one-investigation-out reports every investigation', () => {
    const r = leaveOneInvestigationOut(fx);
    const ids = new Set(fx.filter((x) => binaryOutcome(x.outcome)).map((x) => x.inv));
    expect(r.n).toBe(ids.size);
    for (const d of r.details) {
      expect(d.statusCounts.measured + d.statusCounts.interpolated + d.statusCounts.extrapolated).toBe(d.n);
      expect(d.honest).toBeGreaterThanOrEqual(d.predictionCorrect);
    }
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
