import { describe, expect, it } from 'vitest';
import * as P from '../api/parse';
import { mockTransport } from '../api/mock';

describe('parsers', () => {
  it('turns missing ScientificValue into unknown, never a number', () => {
    expect(P.sv(undefined, 'x')).toMatchObject({ kind: 'unknown', value: null });
    expect(P.sv({ kind: 'unknown', value: 5, unit: null, role: null, source_ref: null }, 'x').value).toBeNull();
  });
  it('rejects malformed responses with a path', () => {
    expect(() => P.runStatus({ run_id: 'r', status: 'weird', stage: null, error: null, review_id: null }, 'run')).toThrow(/run\.status/);
    expect(() => P.meta({}, 'meta')).toThrow(P.ParseError);
  });
  it('parses an error envelope', () => {
    expect(P.errorEnvelope({ error: { code: 'bad', message: 'nope' } })).toEqual({ code: 'bad', message: 'nope' });
    expect(P.errorEnvelope({ detail: 'x' })).toBeNull();
  });
  it('keeps null query fields as null (unknown)', () => {
    const q = P.researchQuery({ question: 'q', environment: 'iss', topic: null, endpoint: null, config: { material: 'PMMA' } }, 'q');
    expect(q.config.o2_fraction).toBeNull();
    expect(q.config.flow_direction).toBeNull();
  });
  it('parses the mock review and investigation fixtures', async () => {
    const rev = P.review((await mockTransport('GET', '/api/reviews/rev_example_bass2')).body, 'review');
    expect(rev.claims.length).toBeGreaterThan(0);
    const inv = P.investigationFull((await mockTransport('GET', '/api/investigations/inv_bass2')).body, 'inv');
    expect(inv.test_records[0].geometry.width_mm.kind).toBe('unknown');
    expect(P.evalSummary((await mockTransport('GET', '/api/eval/summary')).body, 'e').status).toBe('measured');
    expect(P.programme((await mockTransport('POST', '/api/reviews/rev_example_bass2/test-programmes', { budget_runs: 14 })).body, 'p').blocks.every((b) => b.replicates >= 2)).toBe(true);
  });
  it('evalSummary treats anything but measured as not_measured', () => {
    expect(P.evalSummary({ status: 'weird' }, 'e').status).toBe('not_measured');
  });
});
