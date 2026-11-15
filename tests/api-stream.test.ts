import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApiHandler } from '../server/api';
import { runReviewSync, type CorpusV2, type ChunksIndex } from '../src/core';
import { readSseData } from '../src/core/reviewStream';

const corpus = JSON.parse(readFileSync('public/data/corpus_v2.json', 'utf8')) as CorpusV2;
const index = JSON.parse(readFileSync('public/data/chunks_index.json', 'utf8')) as ChunksIndex;
const question = 'PMMA flame spread';
const prose = runReviewSync({ question, corpus, index, retrievalK: 2 }).synthesis;

describe('HTTP streaming reviews', () => {
  let server: Server, url: string, directory: string;
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(prose) } }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' } },
  ));
  beforeAll(async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only-stream-key');
    vi.stubEnv('OPENROUTER_API_KEY', '');
    directory = mkdtempSync(join(tmpdir(), 'ember-stream-'));
    server = createServer(createApiHandler(resolve('.'), { storePath: join(directory, 'reviews.json'), fetchImpl }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    url = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  async function post() {
    const response = await fetch(url + '/api/reviews', { method: 'POST', headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify({ question, useLiveAi: true, retrievalK: 2 }) });
    const events = [];
    for await (const data of readSseData(response.body!)) events.push(JSON.parse(data));
    return { response, events };
  }

  it('streams stages and checked claims, then a verified persisted snapshot', async () => {
    const { response, events } = await post();
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(events.some(e => e.type === 'stage' && e.stage === 'synthesis')).toBe(true);
    expect(events.some(e => e.type === 'claim')).toBe(true);
    const final = events.at(-1);
    expect(final.type).toBe('result');
    expect(final.envelope.data.review.synthesis.mode).toBe('LIVE_AI');
    expect(final.envelope.data.review.verification.passed).toBe(true);
    expect(JSON.stringify(events)).not.toContain('test-only-stream-key');
    const saved = await fetch(url + '/api/reviews/' + final.envelope.data.reviewId);
    expect(saved.status).toBe(200);
    expect((await saved.json()).data.reviewId).toBe(final.envelope.data.reviewId);
  });

  it('replays cached reviews without repeating paid provider requests', async () => {
    const before = fetchImpl.mock.calls.length;
    const { events } = await post();
    expect(events.at(-1).envelope.data.idempotentReplay).toBe(true);
    expect(fetchImpl.mock.calls.length).toBe(before);
  });

  it('returns ordinary JSON validation errors before opening the stream', async () => {
    const before = fetchImpl.mock.calls.length;
    const response = await fetch(url + '/api/reviews', { method: 'POST', headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Who won the World Cup?', useLiveAi: true }) });
    expect(response.status).toBe(422);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect((await response.json()).error.code).toBe('QUESTION_OUT_OF_SCOPE');
    expect(fetchImpl.mock.calls.length).toBe(before);
  });
});
