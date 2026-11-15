import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateApplicability, parseResearchQuery } from '../src/core';
import type { CorpusV2 } from '../src/core';

const corpus = JSON.parse(readFileSync('public/data/corpus_v2.json', 'utf8')) as CorpusV2;

const query = (o2Pct: number, pressureKpa: number, gravityG: number) =>
  parseResearchQuery(
    '',
    { habitableEnvironment: 'custom', o2Pct, pressureKpa, flowCmS: [0, 20], gravityG, fuelPhase: 'solid', material: 'PMMA', safetyTask: 'material_screening' },
    { applyEnvironmentDefaults: false },
  );

describe('RULE-JOINT-01 with unreported conditions', () => {
  it('does not treat a test with unknown flow as near a far-away oxygen level', () => {
    // BASS-II-O7: 16 % O2 at 101.3 kPa, flow not reported in the PSI table.
    const test = corpus.tests.find((t) => t.testId === 'BASS-II-O7');
    expect(test).toBeDefined();
    expect(test!.flow.initialFlowCmS.value).toBeNull();
    const d = evaluateApplicability(query(30, 70.3, 0), test!);
    expect(d.verdict).toBe('inadmissible');
    expect(d.rules.find((r) => r.ruleId === 'RULE-JOINT-01')?.status).toBe('fail');
  });

  it('finds no applicable solid flight test at a lunar exploration atmosphere', () => {
    const q = query(30, 70.3, 0);
    const supported = corpus.tests
      .filter((t) => t.fuelPhase === 'solid')
      .map((t) => evaluateApplicability(q, t))
      .filter((d) => d.verdict === 'admissible' || d.verdict === 'conditional_support');
    expect(supported).toHaveLength(0);
  });

  it('still supports ISS cabin air for PMMA', () => {
    const q = query(21, 101.3, 0);
    const admissible = corpus.tests.map((t) => evaluateApplicability(q, t)).filter((d) => d.verdict === 'admissible');
    expect(admissible.length).toBeGreaterThan(50);
  });
});
