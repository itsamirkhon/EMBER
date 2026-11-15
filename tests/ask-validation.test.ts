import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Review } from '../src/core';
import { fromReview, ScopeReplyView } from '../src/ui/v3/pages/AskPage';

function makeReview(verified: boolean): Review {
  return {
    envelope: { runId: 'run-unverified' },
    synthesis: {
      mode: 'LIVE_AI',
      modelName: 'test-model',
      answerBoundary: 'conditional_or_partial',
      observedFact: [{ id: 'f', text: 'An unsupported claim.', citations: ['chk-test-unknown'], provenance: 'model' }],
      authorInterpretation: [],
      engineeringImplication: [],
      openQuestions: ['Needs independent review'],
    },
    evidencePackage: { evidenceChunks: [], gaps: ['No matching test'] },
    verification: { passed: verified },
  } as unknown as Review;
}

describe('Ask EMBER verifier gating', () => {
  it('renders a conversational topic redirect without scientific badges or sources', () => {
    const html = renderToStaticMarkup(createElement(ScopeReplyView, { question: 'Who won the World Cup?' }));
    expect(html).toContain('Who won the World Cup?');
    expect(html).toContain('I help explore NASA research');
    expect(html).toContain('How does airflow affect PMMA');
    expect(html).not.toMatch(/Answered from observed data|Cited records only|What the sources say|DETERMINISTIC_ENGINE/);
  });

  it('never renders unverified model text as checked observations', () => {
    const answer = fromReview('Can this material burn?', makeReview(false), null);
    expect(answer.mode).toBe('in_browser');
    expect(answer.observed).toEqual([]);
    expect(answer.checks).toEqual([]);
    expect(answer.gaps).toContain('No matching test');
  });

  it('shows verified live text only when the verifier explicitly passed', () => {
    const answer = fromReview('Can this material burn?', makeReview(true), null);
    expect(answer.mode).toBe('live');
    expect(answer.observed).toHaveLength(1);
    expect(answer.checks).toHaveLength(5);
  });
});
