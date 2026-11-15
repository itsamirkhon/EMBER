import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matchProtocolSegment, parseResearchQuery, type CorpusV2, type TargetEndpoint, type Test } from '../src/core/index';

const corpus = JSON.parse(readFileSync('public/data/corpus_v2.json', 'utf8')) as CorpusV2;
function record(id: string): Test {
  const test = corpus.tests.find((candidate) => candidate.testId === id);
  if (!test) throw new Error(`Missing test fixture ${id}`);
  return structuredClone(test);
}
function match(test: Test, endpoint: TargetEndpoint) {
  return matchProtocolSegment(parseResearchQuery('protocol regression', { targetEndpoint: endpoint }), test);
}

describe('protocol chronology and event binding', () => {
  it('preserves real B9 quench with unknown absolute timestamps', () => {
    expect(match(record('BASS-II-B9'), 'quench_limit').endpointMatched).toBe(true);
  });
  it('rejects quench moved onto ignition despite the legacy terminal label', () => {
    const test = record('BASS-II-B9');
    const event = test.events.find((event) => event.endpoint === 'quench_limit')!;
    event.segmentId = test.segments.find((segment) => segment.stageType === 'ignition')!.segmentId;
    const result = match(test, 'quench_limit');
    expect(result.endpointMatched).toBe(false);
    expect(result.matchedEventIds).not.toContain(event.id);
    expect(result.warnings.join(' ')).toMatch(/inconsistent/i);
  });
  it('does not let operator terminal text override a misplaced typed event', () => {
    const test = record('BASS-II-B1');
    const event = test.events.find((event) => event.eventType === 'operator_flow_shutoff')!;
    event.segmentId = test.segments.find((segment) => segment.stageType === 'ignition')!.segmentId;
    const query = parseResearchQuery('operator cutoff', { targetEndpoint: 'extinction_under_flow_change', flowHistory: 'abrupt_cutoff' });
    expect(matchProtocolSegment(query, test).endpointMatched).toBe(false);
  });
  it('keeps legacy operator cutoff support separate from physical quench and blowoff', () => {
    const test = record('BASS-II-B1');
    test.events = test.events.filter((event) => event.endpoint !== 'extinction_under_flow_change');
    const cutoffQuery = parseResearchQuery('operator cutoff', { targetEndpoint: 'extinction_under_flow_change', flowHistory: 'abrupt_cutoff' });
    expect(matchProtocolSegment(cutoffQuery, test).endpointMatched).toBe(true);
    for (const endpoint of ['quench_limit', 'blowoff_limit'] as const) {
      expect(matchProtocolSegment({ ...cutoffQuery, targetEndpoint: endpoint }, test).endpointMatched).toBe(false);
    }
  });
  it.each([false, true])('rejects ambiguous duplicate event IDs (conflicting binding: %s)', (conflicting) => {
    const test = record('BASS-II-B9');
    const duplicate = structuredClone(test.events.find((event) => event.endpoint === 'quench_limit')!);
    if (conflicting) duplicate.segmentId = test.segments[0].segmentId;
    test.events.push(duplicate);
    const result = match(test, 'quench_limit');
    expect(result.endpointMatched).toBe(false);
    expect(result.matchedEventIds).not.toContain(duplicate.id);
  });
  it('rejects cool continuation supported by internally contradictory precursor timing', () => {
    const test = record('CFI-1206');
    test.segments[0].timeStartS = 10;
    test.segments[0].timeEndS = 2;
    expect(match(test, 'cool_flame_continuation').endpointMatched).toBe(false);
  });
  it('does not infer a physical quench from terminal text without an event', () => {
    const test = record('BASS-II-B9');
    test.events = [];
    expect(match(test, 'quench_limit').endpointMatched).toBe(false);
  });
  it('rejects extinction ordered before flow modification', () => {
    const test = record('BASS-II-B9');
    test.segments.find((s) => s.stageType === 'termination')!.order = 0;
    expect(match(test, 'quench_limit').endpointMatched).toBe(false);
  });
  it('rejects missing segment and contradictory timestamps', () => {
    const test = record('BASS-II-B9');
    const event = test.events.find((event) => event.endpoint === 'quench_limit')!;
    event.segmentId = 'missing';
    expect(match(test, 'quench_limit').endpointMatched).toBe(false);
    const timed = record('BASS-II-B9');
    timed.segments.find((s) => s.stageType === 'termination')!.timeStartS = 1;
    timed.segments.find((s) => s.stageType === 'flow_modification')!.timeStartS = 10;
    expect(match(timed, 'quench_limit').endpointMatched).toBe(false);
  });
  it('does not assert cool continuation after hot extinction when their order is reversed', () => {
    const test = record('CFI-1206');
    test.segments[0].order = 2;
    test.segments[1].order = 1;
    const result = match(test, 'cool_flame_continuation');
    expect(result.endpointMatched).toBe(false);
    expect(result.warnings.join(' ')).not.toContain('continued after hot-flame extinction');
  });
});
