import { describe, expect, it } from 'vitest';
import { MATCH_TOLERANCE, O2_IN_DOMAIN_POINTS } from '../src/core';
import { MARGIN_ROWS, REFERENCE_POINTS, marginDelta, protocolNote, type LensInput } from '../src/ui/v3/data';
import { rankGaps } from '../src/ui/v3/pages/LensPage';
import { TOUR_ANCHORS, TOUR_STEPS, tourHref } from '../src/ui/v3/Tour';

const rover: LensInput = {
  missionId: 'lunar-rover', o2: 30, kPa: 70.3, flow: [0, 20], g: 0.166,
  phase: 'solid', material: 'PMMA', task: 'material_screening',
};

describe('Earth and history reference points', () => {
  it('carry a source and stay out of the test data', () => {
    expect(REFERENCE_POINTS.map((r) => r.id)).toEqual(['airliner', 'oxygen-enriched', 'apollo-1']);
    for (const r of REFERENCE_POINTS) {
      expect(r.source.url).toMatch(/^https:\/\//);
      expect(r.o2).toBeGreaterThan(0);
      expect(r.kPa).toBeGreaterThan(0);
    }
  });

  it('uses the documented values', () => {
    const byId = Object.fromEntries(REFERENCE_POINTS.map((r) => [r.id, r]));
    expect(byId.airliner).toMatchObject({ o2: 21, kPa: 75.3 }); // 8,000 ft cabin altitude, 14 CFR 25.841(a)
    expect(byId['oxygen-enriched']).toMatchObject({ o2: 23.5, kPa: 101.3 }); // NFPA 99
    expect(byId['apollo-1']).toMatchObject({ o2: 100, kPa: 115.1 }); // 16.7 psia pure oxygen
  });
});

describe('1 g vs 0 g oxygen margin table', () => {
  it('reproduces NASA/TM-2008-215260 Table 1 and its equation 1', () => {
    const d = Object.fromEntries(MARGIN_ROWS.map((r) => [r.material.split(' ')[0], marginDelta(r)]));
    expect(d.Nomex).toBeCloseTo(-1.2, 5);
    expect(d.Ultem).toBeCloseTo(-1.75, 5);
    expect(d.Mylar).toBeCloseTo(-3.9, 5);
  });

  it('never shows a 0 g limit above the 1 g limit for these materials', () => {
    for (const r of MARGIN_ROWS) expect(marginDelta(r)).toBeLessThan(0);
  });
});

describe('protocol note on nearest tests', () => {
  it('flags airflow reduced or turned off during the test', () => {
    expect(protocolNote('ignited_flame_spread', 'extinguished_at_reduced_flow')).toMatch(/reduced step by step/);
    expect(protocolNote('ignited_flame_spread', 'flow_turned_off')).toMatch(/operator action/);
    expect(protocolNote('ignited_burned', 'burned_out')).toBeNull();
    expect(protocolNote('ignited_burned', null)).toBeNull();
  });
});

describe('gap order for the next-evidence card', () => {
  it('ranks numeric gaps by rule tolerance and keeps gravity and material last', () => {
    const gaps = rankGaps(rover, { o2: 22.4, kPa: 100.1, flow: 10, g: 0, fuel: 'PMMA' });
    expect(gaps.map((g) => g.axis)).toEqual(['o2', 'kPa', 'g']);
    expect(gaps[0].size).toBeCloseTo(7.6 / O2_IN_DOMAIN_POINTS, 5);
    expect(gaps[1].size).toBeCloseTo(29.8 / MATCH_TOLERANCE.pressureKpa, 5);
    expect(gaps[2].text).toMatch(/No combustion flight test in NASA PSI ran at partial gravity/);
  });

  it('adds a material gap and omits axes inside tolerance', () => {
    const gaps = rankGaps(rover, { o2: 29, kPa: 70, flow: 5, g: 0.166, fuel: 'Nomex III' });
    expect(gaps.map((g) => g.axis)).toEqual(['material']);
  });

  it('matches the tolerances the applicability engine uses', () => {
    expect(MATCH_TOLERANCE.o2Pct).toBe(O2_IN_DOMAIN_POINTS);
    expect(MATCH_TOLERANCE.pressureKpa).toBeCloseTo(22.5, 5);
    expect(MATCH_TOLERANCE.flowCmS).toBeCloseTo(12, 5);
  });
});

describe('judges’ tour', () => {
  it('has five steps that start on the map and end on Trust', () => {
    expect(TOUR_STEPS).toHaveLength(5);
    expect(tourHref(1)).toBe('/map?tour=1');
    expect(tourHref(2)).toBe('/lens?mission=lunar-rover&material=PMMA&tour=2');
    expect(tourHref(5)).toBe('/trust?tour=5');
    expect(TOUR_ANCHORS).toEqual({ 3: 'near-h', 4: 'next-h' });
  });
});
