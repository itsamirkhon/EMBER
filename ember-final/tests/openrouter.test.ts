import { describe, expect, it, vi } from 'vitest';
import { OpenRouterClient, DECISION_MODEL, EMBEDDING_MODEL, formatEmbeddingQuery, formatEmbeddingDocument } from '../server/openrouter';
import { buildEmbeddingArtifact, writeEmbeddingArtifact } from '../pipeline/embed_openrouter';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const choices = (choice: string, others: string[]) => ({ type: 'choice', choice, probabilities: Object.fromEntries([[choice, .8], ...others.map(x => [x, .1])]), confidence: .8 });
const decisionPayload = () => ({ id: 'decision-1', model: DECISION_MODEL, answers: {
  Q1_RELEVANCE: choices('direct_match', ['partial_context', 'not_relevant']),
  Q2_OBSERVATION: choices('observed_finding', ['planned_or_hypothesis', 'method_or_assumption']),
  Q3_CONTRADICTION: choices('tension_or_conflict', ['consistent', 'insufficient_to_judge']),
} });
const mockFetch = (payload: unknown, status = 200) => vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload), { status }));
const input = { query: { rawQuestion: 'PMMA extinction after flow reduction', targetEndpoint: 'quench_limit' }, passage: { chunkId: 'chunk-1', text: 'The flame extinguished after reducing flow.', epistemicStatus: 'observed' } };

describe('OpenRouter scientific adapters', () => {
  it('fails explicitly without a server key before any call', () => {
    expect(() => new OpenRouterClient({ apiKey: '' })).toThrow('OPENROUTER_API_KEY');
  });
  it('uses the Decisions endpoint and bounded choice questions; preserves conflict', async () => {
    const fetchImpl = mockFetch(decisionPayload());
    const result = await new OpenRouterClient({ apiKey: 'test-key', fetchImpl }).evaluatePassage(input);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe(DECISION_MODEL);
    expect(body.state).toEqual(input);
    expect(Object.keys(body.questions)).toEqual(['Q1_RELEVANCE', 'Q2_OBSERVATION', 'Q3_CONTRADICTION']);
    expect(body.questions.Q2_OBSERVATION.type).toBe('choice');
    expect(body.messages).toBeUndefined();
    expect(result.route).toBe('conflict');
    expect(result.q1Relevance.probabilities.direct_match).toBe(.8);
    expect(result.evaluatorMode).toBe('live_openrouter');
    expect(result.model).toBe(DECISION_MODEL);
  });
  it.each([
    ['missing answers', (p: ReturnType<typeof decisionPayload>) => { delete (p.answers as Record<string, unknown>).Q2_OBSERVATION; }],
    ['wrong type', (p: ReturnType<typeof decisionPayload>) => { p.answers.Q1_RELEVANCE.type = 'score'; }],
    ['invalid choice', (p: ReturnType<typeof decisionPayload>) => { p.answers.Q1_RELEVANCE.choice = 'safe'; }],
    ['probability sum', (p: ReturnType<typeof decisionPayload>) => { p.answers.Q1_RELEVANCE.probabilities.direct_match = .2; }],
    ['negative probability', (p: ReturnType<typeof decisionPayload>) => { p.answers.Q1_RELEVANCE.probabilities.direct_match = -1; }],
    ['unknown option', (p: ReturnType<typeof decisionPayload>) => { p.answers.Q1_RELEVANCE.probabilities.extra = 0; }],
    ['confidence range', (p: ReturnType<typeof decisionPayload>) => { p.answers.Q1_RELEVANCE.confidence = 1.1; }],
  ])('rejects %s without offline fallback', async (_label, mutate) => {
    const payload = decisionPayload(); mutate(payload);
    await expect(new OpenRouterClient({ apiKey: 'test-key', fetchImpl: mockFetch(payload) }).evaluatePassage(input)).rejects.toThrow('Invalid OpenRouter');
  });
  it('rejects a silent decision model substitution', async () => {
    const payload = { ...decisionPayload(), model: 'other/model' };
    await expect(new OpenRouterClient({ apiKey: 'test-key', fetchImpl: mockFetch(payload) }).evaluatePassage(input)).rejects.toThrow('model');
  });
  it('does not echo provider error contents or credentials', async () => {
    const client = new OpenRouterClient({ apiKey: 'test-secret', fetchImpl: mockFetch({ error: 'test-secret' }, 401) });
    await expect(client.evaluatePassage(input)).rejects.toThrow(/^OpenRouter HTTP 401$/);
  });
  it('times out even if an injected transport ignores AbortSignal', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise(() => {}));
    await expect(new OpenRouterClient({ apiKey: 'key', fetchImpl, timeoutMs: 5 }).evaluatePassage(input)).rejects.toThrow('timed out');
  });
  it('formats compatible query/doc inputs and restores embedding response index order', async () => {
    const fetchImpl = mockFetch({ model: EMBEDDING_MODEL, data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] });
    const result = await new OpenRouterClient({ apiKey: 'test-key', fetchImpl }).embed(['first', 'second'], 2);
    expect(result).toEqual([[1, 0], [0, 1]]);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/embeddings');
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ model: EMBEDDING_MODEL, input: ['first', 'second'], dimensions: 2, encoding_format: 'float' });
    expect(formatEmbeddingQuery('PMMA')).toBe('task: search result | query: PMMA');
    expect(formatEmbeddingDocument('observed extinction', null)).toBe('title: none | text: observed extinction');
  });
  it.each([
    [{ index: 0, embedding: [1] }],
    [{ index: 0, embedding: [0, 0] }],
    [{ index: 0, embedding: [1.7e308, 1.7e308] }],
    [{ index: 0, embedding: [1, 'bad'] }],
    [{ index: 0, embedding: [1, 0] }, { index: 0, embedding: [0, 1] }],
  ])('rejects malformed vector/index responses %#', async (...data) => {
    await expect(new OpenRouterClient({ apiKey: 'key', fetchImpl: mockFetch({ model: EMBEDDING_MODEL, data }) }).embed(['one'], 2)).rejects.toThrow('Invalid OpenRouter');
  });
  it('builds an ordered, hashed atomic artifact without copying credentials or stale SVD vectors', async () => {
    const client = new OpenRouterClient({ apiKey: 'test-secret', fetchImpl: mockFetch({ model: EMBEDDING_MODEL, data: [{ index: 0, embedding: [1, 0] }] }) });
    const artifact = await buildEmbeddingArtifact({ corpusVersion: 'corpus-1', chunks: [{ chunkId: 'c1', text: 'observed extinction', sectionHeader: 'Results' }] }, client, { dimensions: 2, batchSize: 1, concurrency: 1 });
    expect(artifact.entries[0].chunkId).toBe('c1');
    expect(artifact.entries[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.embeddingModel).toBe(EMBEDDING_MODEL);
    expect(artifact.embeddingDim).toBe(2);
    expect(artifact.corpusVersion).toBe('corpus-1');
    const dir = await mkdtemp(join(tmpdir(), 'ember-embedding-'));
    try {
      const path = join(dir, 'vectors.json');
      await writeEmbeddingArtifact(path, artifact);
      await writeEmbeddingArtifact(path, artifact);
      const saved = await readFile(path, 'utf8');
      expect(JSON.parse(saved)).toEqual(artifact);
      expect(saved).not.toContain('test-secret');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects duplicate chunk IDs before spending on embeddings', async () => {
    const fetchImpl = mockFetch({});
    const client = new OpenRouterClient({ apiKey: 'key', fetchImpl });
    await expect(buildEmbeddingArtifact({ corpusVersion: 'v1', chunks: [{ chunkId: 'c', text: 'a' }, { chunkId: 'c', text: 'b' }] }, client)).rejects.toThrow('Duplicate');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('embedding artifact batching', () => {
  it('bounds workers and preserves corpus order when requests finish in reverse order', async () => {
    let active = 0;
    let maximum = 0;
    const client = { embed: async (inputs: string[]) => {
      active++; maximum = Math.max(maximum, active);
      const number = Number(inputs[0].split('doc')[1]);
      await new Promise(resolve => setTimeout(resolve, number === 0 ? 15 : 1));
      active--;
      return inputs.map(() => [number + 1, 1]);
    } };
    const artifact = await buildEmbeddingArtifact({ corpusVersion: 'v1', chunks: [0, 1, 2].map(i => ({ chunkId: `c${i}`, text: `doc${i}` })) }, client, { dimensions: 2, batchSize: 1, concurrency: 2 });
    expect(maximum).toBe(2);
    expect(artifact.entries.map(entry => [entry.chunkId, entry.vector])).toEqual([['c0', [1, 1]], ['c1', [2, 1]], ['c2', [3, 1]]]);
  });
  it('does not publish partial results after one batch fails', async () => {
    const client = { embed: vi.fn().mockResolvedValueOnce([[1, 0]]).mockRejectedValueOnce(new Error('failure')) };
    await expect(buildEmbeddingArtifact({ corpusVersion: 'v1', chunks: [{ chunkId: 'a', text: 'a' }, { chunkId: 'b', text: 'b' }] }, client, { dimensions: 2, batchSize: 1, concurrency: 1 })).rejects.toThrow('failure');
  });
});
