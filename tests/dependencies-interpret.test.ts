import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDependencies, evaluateApplicability, parseResearchQuery, recalculateDesignVariant, runReviewSync } from '../src/core';
import type { CorpusV2 } from '../src/core';
const corpus = JSON.parse(readFileSync('public/data/corpus_v2.json', 'utf8')) as CorpusV2;
const tests = ['BASS-II-B1', 'BASS-II-B10'].map((id) => corpus.tests.find((t) => t.testId === id)!);
const query = parseResearchQuery('PMMA flame spread', { material: 'PMMA', thicknessMm: 1 });
const decisions = tests.map((t) => evaluateApplicability(query, t));

describe('conclusion-scoped design dependencies', () => {
  it('covers every conclusion and binds only its cited test', () => {
    const claims = tests.map((t, i) => ({ id: `fact-${i}`, text: 'Observation', citations: [t.testId] }));
    const edges = buildDependencies(claims, decisions, query);
    expect(new Set(edges.map((e) => e.conclusionId))).toEqual(new Set(['fact-0', 'fact-1']));
    for (const [i, t] of tests.entries()) {
      expect(edges.filter((e) => e.conclusionId === `fact-${i}`).every((e) => e.affectedTestIds.length === 1 && e.affectedTestIds[0] === t.testId)).toBe(true);
    }
  });
  it('does not silently attach uncited or unresolved claims to unrelated records', () => {
    const edges = buildDependencies([{ id: 'missing', text: 'No resolved evidence', citations: ['not-a-test'] }], decisions, query);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((e) => e.status === 'weakened' && e.affectedTestIds.length === 0)).toBe(true);
    expect(edges[0].reason).toMatch(/unresolved|no.*cited/i);
  });
  it('resolves chunk citations to their own record and never to every record in the investigation', () => {
    const edges = buildDependencies([{ id: 'chunk-fact', text: 'Observation', citations: ['chunk-A'] }], decisions, query, [{ chunkId: 'chunk-A', testId: tests[1].testId, inv: tests[1].inv }]);
    expect(edges.every((e) => e.affectedTestIds.join() === tests[1].testId)).toBe(true);
  });
  it('does not label an absent rule check as verified support', () => {
    const edges = buildDependencies([{ id: 'unchecked', text: 'Observation', citations: [tests[0].testId] }], [{ ...decisions[0], rules: [] }], query);
    expect(edges.every((edge) => edge.status === 'weakened')).toBe(true);
  });
  it('does not spread one cited record failure to another conclusion', () => {
    const independent = decisions.map((decision, index) => ({ ...decision, rules: [{ ruleId: 'RULE-GEOM-01' as const, status: index === 0 ? 'fail' as const : 'pass' as const, reason: index === 0 ? 'Geometry mismatch' : 'Geometry compatible' }] }));
    const edges = buildDependencies(tests.map((test, index) => ({ id: `independent-${index}`, text: 'Observation', citations: [test.testId] })), independent, query);
    expect(edges.find((edge) => edge.conclusionId === 'independent-0' && edge.fromParameter === 'thicknessMm')?.status).toBe('invalidated');
    expect(edges.find((edge) => edge.conclusionId === 'independent-1' && edge.fromParameter === 'thicknessMm')?.status).toBe('retained');
  });
  it('keeps an explicit weakened trace when a previously specified condition is removed', () => {
    const review = runReviewSync({ question: 'PMMA flame spread', corpus });
    review.query = query;
    review.synthesis.observedFact = [{ id: 'removed-thickness', text: 'Observation', citations: [tests[0].testId], provenance: 'reported' }];
    review.synthesis.authorInterpretation = [];
    review.synthesis.engineeringImplication = [];
    const variant = recalculateDesignVariant(review, { thicknessMm: null }, corpus);
    expect(variant.weakenedEdges.some((edge) => edge.conclusionId === 'removed-thickness' && edge.fromParameter === 'thicknessMm')).toBe(true);
    expect(variant.impactChains.some((chain) => chain.changedParameter === 'thicknessMm' && chain.conclusionChange.includes('removed-thickness'))).toBe(true);
  });
  it('keeps design-change impact scoped to each conclusion instead of global verdict deltas', () => {
    const review = runReviewSync({ question: 'PMMA flame spread', corpus });
    review.query = query;
    review.evidencePackage.applicabilityDecisions = decisions;
    review.synthesis.observedFact = tests.map((t, i) => ({ id: `fact-${i}`, text: 'Observation', citations: [t.testId], provenance: 'reported' }));
    review.synthesis.authorInterpretation = [{ id: 'author-0', text: 'Author interpretation', citations: [tests[0].testId], provenance: 'interpretation' }];
    review.synthesis.engineeringImplication = [{ id: 'imp-0', text: 'Transfer boundary', citations: [tests[1].testId], provenance: 'interpretation' }];
    const variant = recalculateDesignVariant(review, { thicknessMm: 2 }, corpus);
    const edges = [...variant.retainedEdges, ...variant.weakenedEdges, ...variant.invalidatedEdges];
    expect(new Set(edges.map((e) => e.conclusionId))).toEqual(new Set(['fact-0', 'fact-1', 'author-0', 'imp-0']));
    for (const [i, t] of tests.entries()) {
      expect(edges.filter((e) => e.conclusionId === `fact-${i}`).every((e) => e.affectedTestIds.join() === t.testId)).toBe(true);
    }
    expect(variant.impactChains.every((c) => /fact-[01]|author-0|imp-0/.test(c.conclusionChange))).toBe(true);
  });
});
