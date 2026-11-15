import { describe, expect, it } from 'vitest';
import { cliffStats, gapsFor, nearestTests, type LensInput, type Row } from '../src/ui/v3/data';

const scenario: LensInput = {
  missionId: 'lunar-rover', o2: 30, kPa: 70.3, flow: [0, 20], g: 0.166,
  phase: 'solid', material: 'PMMA', task: 'material_screening',
};

function record(testId: string, overrides: Partial<Row> = {}): Row {
  return {
    testId, inv: 'BASS-II', phase: 'solid', fuel: 'PMMA',
    o2: 21, o2Prov: 'reported', kPa: 101.3, kPaProv: 'reported',
    flow: 5, g: 0, outcome: 'ignited_burned', terminal: null,
    gravityMode: 'actual_flight', table: 'PSI-25', row: 1,
    url: 'https://psi.nasa.gov/physci/repo/data/investigations/PSI-25',
    geometry: null, thicknessMm: 0.2, spreadMmS: null,
    ...overrides,
  };
}

describe('public evidence presentation provenance', () => {
  it('does not treat assumed oxygen or pressure as nearest measured atmosphere', () => {
    const rows = [
      record('assumed-oxygen', { o2: 30, o2Prov: 'assumed', kPa: 70.3 }),
      record('assumed-pressure', { o2: 30, kPa: 70.3, kPaProv: 'assumed' }),
      record('reported', { o2: 21, kPa: 101.3 }),
    ];
    expect(nearestTests(scenario, rows).map((x) => x.row.testId)).toEqual(['reported']);
  });

  it('excludes incomplete or non-flight records from the nearest-flight view', () => {
    const rows = [
      record('no-oxygen', { o2: null }),
      record('no-pressure', { kPa: null }),
      record('ground', { gravityMode: 'ground_test', o2: 30, kPa: 70.3 }),
      record('flight'),
    ];
    expect(nearestTests(scenario, rows).map((x) => x.row.testId)).toEqual(['flight']);
  });

  it('reports unknown gravity instead of silently displaying microgravity', () => {
    const unknown = record('no-gravity', { g: null });
    expect(gapsFor(scenario, unknown).find((x) => x.axis === 'g')).toEqual({
      axis: 'g', label: 'Gravity', text: 'not reported', size: 3,
    });
    expect(gapsFor({ ...scenario, g: 0 }, record('observed-zero')).find((x) => x.axis === 'g')?.text).toBe('same');
  });

  it('keeps assumed pressure out of the reported-pressure evidence-cliff range', () => {
    const rows = [
      record('reported-1', { o2: 21, kPa: 101.3 }),
      record('reported-2', { o2: 22.7, kPa: 98.3 }),
      record('assumed-pressure', { o2: 21, kPa: 40, kPaProv: 'assumed' }),
    ];
    const stats = cliffStats(rows);
    if (!stats) throw new Error('Expected populated solid-material flight subset');
    expect(stats.solidFlight).toBe(3);
    expect(stats.kPaMin).toBe(98.3);
    expect(stats.kPaMax).toBe(101.3);
    expect(stats.o2Max).toBe(22.7);
  });
});
