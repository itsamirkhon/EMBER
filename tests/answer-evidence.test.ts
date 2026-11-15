import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { runReviewSync, type CorpusV2 } from '../src/core';
import { nearestEvidenceTests, recordedFlowSteps } from '../src/core/answerEvidence';
import { fromReview, AnswerView } from '../src/ui/v3/pages/AskPage';
import { EvidenceComparison } from '../src/ui/v3/AnswerEvidence';

const corpus = JSON.parse(readFileSync('public/data/corpus_v2.json', 'utf8')) as CorpusV2;

describe('Ask evidence and coverage boundary', () => {
  it('caps a causal airflow question at partial support while keeping observed outcomes available', () => {
    const question = 'How does airflow speed affect flame spread over PMMA in microgravity?';
    const review = runReviewSync({ question, corpus });
    expect(review.synthesis.answerBoundary).toBe('conditional_or_partial');
    expect(review.synthesis.observedFact.length).toBeGreaterThan(0);
    const answer = fromReview(question, review, corpus);
    expect(answer.tests?.every(t => t.fuel?.includes('PMMA'))).toBe(true);
  });

  it('shows real Nomex context and explicit condition gaps even when passage triage returns no evidence', () => {
    const question = 'Will Nomex burn in a lunar habitat at 34% oxygen and 56.5 kPa?';
    const review = runReviewSync({ question, corpus });
    review.evidencePackage.evidenceChunks = [];
    review.evidencePackage.retrievedHits = [];
    const answer = fromReview(question, review, corpus);
    expect(answer.boundary).toBe('insufficient_data');
    expect(answer.nearby).toBe(true);
    expect(answer.tests).toHaveLength(3);
    expect(answer.tests?.every(t => /Nomex/i.test(t.fuel ?? ''))).toBe(true);
    expect(answer.citations.some(c => c.kind === 'test')).toBe(true);
    const html = renderToStaticMarkup(createElement(AnswerView, { a: answer }));
    expect(html).toContain('not a prediction');
    expect(html).toContain('O₂ requested 34%');
    expect(html).toContain('Pressure requested 56.5 kPa');
    expect(html).not.toContain('Answered from observed data');
    expect(answer.gaps.join(' ')).not.toContain('SAME');
  });

  it('marks other materials as different and never fills unknown quantities with zero', () => {
    const review = runReviewSync({ question: 'Nomex flame spread at 34% oxygen', corpus });
    const other = corpus.tests.find(t => t.testId === 'BASS-II-B1')!;
    const test = { ...other, atmosphere: { ...other.atmosphere, o2: { ...other.atmosphere.o2, value: null, provenance: 'unknown' as const } } };
    const html = renderToStaticMarkup(createElement(EvidenceComparison, { tests: [test], query: review.query, nearby: true }));
    expect(html).toContain('Different material: PMMA; requested Nomex');
    expect(html).toContain('Not reported');
    expect(html).not.toContain('recorded 0%');
    expect(nearestEvidenceTests(review.query, [test, ...corpus.tests]).every(t => /Nomex/i.test(t.fuel ?? ''))).toBe(true);
  });

  it('shows B10 flow steps only when backed by the source value, without inventing times or a quench limit', () => {
    const test = corpus.tests.find(t => t.testId === 'BASS-II-B10')!;
    expect(recordedFlowSteps(test)).toEqual([5, 4, 3, 2, 1]);
    expect(recordedFlowSteps({ ...test, flow: { ...test.flow, initialFlowCmS: { ...test.flow.initialFlowCmS, originalValue: undefined } } })).toEqual([]);
    const review = runReviewSync({ question: 'PMMA flame spread', corpus });
    const html = renderToStaticMarkup(createElement(EvidenceComparison, { tests: [test], query: review.query, nearby: false }));
    expect(html).toContain('Recorded order, not a time axis');
    expect(html).toContain('does not establish an exact extinction threshold');
    expect(html).toContain('testId=BASS-II-B10');
  });
});
