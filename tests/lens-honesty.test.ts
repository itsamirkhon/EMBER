import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CorpusV2, Mission } from '../src/core';
import { runEngine } from '../src/ui/v3/pages/LensPage';
import {
  PLAIN, TASKS, cliffStats, fmtG, lensFromMission, nearestTests,
  type LensInput, type Row,
} from '../src/ui/v3/data';

const rover: LensInput = {
  missionId: 'lunar-rover', o2: 30, kPa: 70.3, flow: [0, 20], g: 0.166,
  phase: 'solid', material: 'PMMA', task: 'material_screening',
};

function row(id: string, outcome: string): Row {
  return {
    testId: id, inv: 'BASS-II', phase: 'solid', fuel: 'PMMA',
    o2: 22.2, o2Prov: 'reported', kPa: 101.3, kPaProv: 'series_level',
    flow: 5, g: 0, gravityMode: 'actual_flight',
    outcome, terminal: null, table: 'PSI-25', row: 2,
    url: 'https://psi.nasa.gov', geometry: 'thin film', thicknessMm: 0.1, spreadMmS: null,
  };
}

describe('mission lens is an evidence lookup, not a physical experiment', () => {
  it('does not offer choosing a safe atmosphere as an implemented capability', () => {
    expect(TASKS.some((task) => task.id === 'atmosphere_selection')).toBe(false);
    expect(PLAIN.beyond.help).toMatch(/historical PSI data/);
    expect(PLAIN.measured.help).toMatch(/recorded matching tests/);
  });

  it('requires a user action before displaying a verdict for modified inputs', () => {
    const source = readFileSync(new URL('../src/ui/v3/pages/LensPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('onClick={() => void checkHistoricalEvidence()}');
    expect(source).toContain('const engine = lastCheck?.signature === signature ? lastCheck.result : null');
    expect(source).toContain('No evidence check run for these settings');
    expect(source).not.toMatch(/useMemo\(\(\) => \(corpus \? runEngine\(/);
  });

  it('preserves contradictory experimental outcomes at identical conditions', () => {
    const differentOutcomes = [row('BASS-II-B1', 'ignited_burned'), row('BASS-II-B2', 'no_ignition')];
    const nearest = nearestTests(rover, differentOutcomes);
    expect(nearest.map((r) => r.row.testId)).toEqual(['BASS-II-B1', 'BASS-II-B2']);
  });

  it('does not claim an evidence cliff for an empty subset', () => {
    expect(cliffStats([])).toBeNull();
    expect(cliffStats([row('nonflight', 'burned'), { ...row('unknown', 'burned'), o2: null }])?.solidFlight).toBe(1);
  });

  it('formats very small nonzero gravity and multi-digit gravity correctly', () => {
    expect(fmtG(0)).toBe('0 g');
    expect(fmtG(0.01)).toBe('0.01 g');
    expect(fmtG(10)).toBe('10 g');
  });

  it('does not import ventilation from the previous cabin when the new mission has no airflow data', () => {
    const old: LensInput = { ...rover, flow: [17, 19] };
    const suit: Mission = {
      id: 'eva-suit', label: 'EVA suit', o2Pct: 100, pressureKpa: 29.6,
      flowCmS: null, gravityG: 0.166, assumption: false, sources: [],
    };
    expect(lensFromMission(suit, old).flow).toEqual([0, 20]);
    expect(lensFromMission(suit, old).missionId).toBe('eva-suit');
  });

  it('derives result counts from the recorded corpus, without predicting a fire probability', () => {
    const file = readFileSync(new URL('../public/data/corpus_v2.json', import.meta.url), 'utf8');
    const corpus = JSON.parse(file) as CorpusV2;
    const result = runEngine(corpus, rover);
    expect(result.rankings.length).toBe(corpus.investigations.length);
    expect(result.admissible).toBeGreaterThanOrEqual(0);
    expect(result.conditional).toBeGreaterThanOrEqual(0);
    expect(result.status).toBe(
      result.admissible > 0 ? 'measured' : result.conditional > 0 ? 'nearby' : 'beyond',
    );
    expect(JSON.stringify(result)).not.toMatch(/fireRiskPercent|riskProbability|predictedIgnition/);
    // This "beyond" verdict must remain a coverage gap for the historical
    // 30% O2 / 70.3 kPa lunar-rover scenario, never a predicted burn outcome.
    expect(result.status).toBe('beyond');
  });
});
