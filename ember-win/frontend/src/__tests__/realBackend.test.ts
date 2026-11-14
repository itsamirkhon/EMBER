// Parses JSON captured with curl from the real backend (src/api/fixtures). If the backend
// contract changes, re-capture the fixtures and these tests show which parser must follow.
import { describe, expect, it } from 'vitest';
import * as P from '../api/parse';
import meta from '../api/fixtures/meta.json';
import investigations from '../api/fixtures/investigations.json';
import investigationsQ from '../api/fixtures/investigations_q.json';
import bass2 from '../api/fixtures/investigation_bass2.json';
import flex from '../api/fixtures/investigation_flex.json';
import reviews from '../api/fixtures/reviews.json';
import review from '../api/fixtures/review_example.json';
import evalJson from '../api/fixtures/eval.json';
import rules from '../api/fixtures/rules.json';
import revisions from '../api/fixtures/revisions.json';
import parse from '../api/fixtures/parse.json';

describe('real backend JSON', () => {
  it('meta, lists, parse, rules, revisions', () => {
    expect(P.meta(meta, 'meta').saved_example_id).toBe('rev_example_bass2');
    expect(P.investigationList(investigations, 'i').items[0].n_tests).toBeGreaterThan(0);
    expect(P.investigationList(investigationsQ, 'i').items.length).toBeGreaterThan(0);
    expect(P.reviewList(reviews, 'r')[0].id).toBe('rev_example_bass2');
    const pq = P.parsedQuery(parse, 'p');
    expect(pq.query.config.shape).toBeNull();
    expect(pq.confirm).toContain('gravity_regime');
    expect(P.rules(rules, 'r').rules.length).toBeGreaterThan(5);
    expect(P.revisions(revisions, 'r')[0].revision).toBe(1);
  });
  it('investigations with test_records and summary entries', () => {
    const inv = P.investigationFull(bass2, 'inv');
    expect(inv.test_records.length).toBe(inv.tests.length);
    expect(inv.test_records[0].geometry.thickness_mm.kind).toBe('unknown');
    expect(inv.summary.goal.items.length).toBeGreaterThan(0);
    expect(inv.summary.conditions_range.extra.numeric).toBeTruthy();
    expect(inv.claims[0].evidence.length).toBeGreaterThan(0);
    expect(P.investigationFull(flex, 'inv').coverage).toBe('catalog');
  });
  it('the saved review, including object-valued manifest, quality and explanation', () => {
    const r = P.review(review, 'review');
    expect(r.manifest.corpus).toMatchObject({ version: expect.any(String) });
    expect(r.ranking[0].quality.level).toBeTruthy();
    expect(Object.keys(r.ranking[0].applicability_summary)).toContain('limited_context');
    expect(r.explanation?.mode).toBe('saved_example');
    expect(r.open_questions[0].kind).toBeTruthy();
    expect(r.programme?.blocks[0].control).toBeTypeOf('object');
    expect(r.claims.length).toBeGreaterThan(0);
  });
  it('eval summary keeps "not measured" cells', () => {
    const e = P.evalSummary(evalJson, 'eval');
    expect(e.status).toBe('measured');
    expect((e.endpoint_support as { all: { A: string } }).all.A).toBe('not measured');
  });
  it('replay events with bare time_s parse', () => {
    const rp = P.replay({ segments: [{ label: 'x', kind: 'prep', time_s: null, order: 1 }], events: [{ kind: 'ignition_attempt', step_order: 2, time_s: null, observed: true, note: '' }, { kind: 'hot_extinction', step_order: 3, time_s: 4.5 }], measurements: [{ name: 'm', unit: null, kind: 'unknown', description: '', source_ref: null }], disclaimer: 'd' }, 'rp');
    expect(rp.events[0].time_s.kind).toBe('unknown');
    expect(rp.events[1].time_s.value).toBe(4.5);
  });
});
