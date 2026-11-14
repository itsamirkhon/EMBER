import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateApplicability, matchProtocolSegment, parseResearchQuery, type CorpusV2, type TargetEndpoint } from '../src/core';
const corpus = JSON.parse(readFileSync('public/data/corpus_v2.json','utf8')) as CorpusV2;
const smoke = corpus.tests.find((test) => test.testId === 'SAME-5')!;
const noIgnition = corpus.tests.find((test) => test.testId === 'BASS-II-T23')!;

describe('protocol interpretation of non-flaming and negative records', () => {
  it.each<TargetEndpoint>(['flame_establishment','sustained_spread','spread_rate'])('does not promote non-flaming pyrolysis to observed %s', (endpoint) => {
    const query = parseResearchQuery('flame experiment', { targetEndpoint: endpoint });
    const result = matchProtocolSegment(query,smoke);
    expect(result.endpointMatched).toBe(false);
    expect(result.matchedOutcomeLabel).toBeNull();
    expect(result.warnings.join(' ')).toMatch(/non.flaming|pyrolysis/i);
    expect(evaluateApplicability(query,smoke).rules.find((rule) => rule.ruleId === 'RULE-EP-01')?.status).toBe('fail');
  });
  it('keeps no ignition as a valuable negative observation of attempted flame establishment', () => {
    const result = matchProtocolSegment(parseResearchQuery('ignition', { targetEndpoint: 'flame_establishment' }),noIgnition);
    expect(result.endpointMatched).toBe(true);
    expect(result.matchedOutcomeLabel).toBe('no_ignition');
    expect(result.matchedEventIds.length).toBeGreaterThan(0);
  });
  it('keeps measured smoke endpoints available despite absence of flaming', () => {
    expect(smoke.particleSizeNm.value).not.toBeNull();
    expect(matchProtocolSegment(parseResearchQuery('smoke size',{targetEndpoint:'smoke_particle_size'}),smoke).endpointMatched).toBe(true);
  });
});
