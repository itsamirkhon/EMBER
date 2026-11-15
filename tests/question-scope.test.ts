import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { isResearchQuestion, QuestionScopeError, runReview, runReviewSync, type CorpusV2 } from '../src/core';

const corpus = JSON.parse(readFileSync('public/data/corpus_v2.json', 'utf8')) as CorpusV2;

describe('question topic boundary', () => {
  it.each(['Who won the World Cup?', 'Write a paper about football', 'Hello', 'What is the weather tomorrow?', 'Кто выиграл чемпионат мира?'])('redirects unrelated or context-free input: %s', (question) => {
    expect(isResearchQuestion(question)).toBe(false);
    expect(() => runReviewSync({ question, corpus })).toThrow(QuestionScopeError);
  });

  it.each([
    'How does airflow affect PMMA flame spread in microgravity?',
    'How are smoke particles detected?', 'Compare BASS-II and Saffire tests',
    'What happens to oxygen in a lunar cabin?', 'How does Nomex behave?',
    'Can rocket propellant fires qualify a cabin material?',
    'Как ведёт себя пламя в невесомости?',
  ])('allows research topics through to the scientific checks: %s', (question) => {
    expect(isResearchQuestion(question)).toBe(true);
  });

  it('preserves structured review requests even with a nontechnical title', () => {
    expect(isResearchQuestion('Compare these conditions', { material: 'cotton' })).toBe(true);
    expect(isResearchQuestion('Compare these conditions', { targetInvIds: ['BASS-II'] })).toBe(true);
  });

  it('does not call providers or accept a saved synthesis for an unrelated question', async () => {
    const retrieve = vi.fn();
    const fetchImpl = vi.fn();
    await expect(runReview({ question: 'Who won the World Cup?', corpus, retrieve, fetchImpl, synthesisMode: 'LIVE_AI', apiKey: 'test-only' })).rejects.toThrow(QuestionScopeError);
    expect(retrieve).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    const savedSnapshot = runReviewSync({ question: 'PMMA flame spread', corpus }).synthesis;
    expect(() => runReviewSync({ question: 'Who won the World Cup?', corpus, savedSnapshot, synthesisMode: 'SAVED_DEMO_SNAPSHOT' })).toThrow(QuestionScopeError);
  });
});
