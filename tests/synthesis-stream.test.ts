import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { generateSynthesis, runReviewSync, verifySynthesis, type CorpusV2, type ChunksIndex } from '../src/core';
import { consumeSynthesisStream } from '../server/synthesisStream';
import { readSseData, type ReviewProgress } from '../src/core/reviewStream';

const corpus = JSON.parse(readFileSync('public/data/corpus_v2.json', 'utf8')) as CorpusV2;
const index = JSON.parse(readFileSync('public/data/chunks_index.json', 'utf8')) as ChunksIndex;
const review = runReviewSync({ question: 'PMMA flame spread', corpus, index, retrievalK: 2 });
const encoder = new TextEncoder();
const delta = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

describe('verified live synthesis stream', () => {
  it('handles split UTF-8, CRLF, comments and multi-line SSE data', async () => {
    const bytes = encoder.encode(': keepalive\r\n\r\ndata: {"text":\r\ndata: "O₂ — поток"}\r\n\r\n');
    const body = new ReadableStream<Uint8Array>({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } });
    const frames = [];
    for await (const frame of readSseData(body)) frames.push(JSON.parse(frame));
    expect(frames).toEqual([{ text: 'O₂ — поток' }]);
  });

  it('emits a checked complete claim before EOF, keeps unfinished/unsupported claims private, then falls back on final failure', async () => {
    const first = review.synthesis.observedFact[0];
    const bad = { ...first, id: 'unsupported', text: `${first.text} Pressure was 98765 kPa.` };
    const events: ReviewProgress[] = [];
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
    const result = generateSynthesis(review.evidencePackage, {
      mode: 'LIVE_AI', apiKey: 'test-only', fetchImpl,
      consumeResponse: (response, pkg, draft) => consumeSynthesisStream(response, pkg, draft, event => events.push(event)),
    });
    let completed = false;
    void result.then(() => { completed = true; });
    const prefix = `{"observedFact":[${JSON.stringify(first)},`;
    controller.enqueue(encoder.encode(delta(prefix)));
    expect(events).toEqual([]);
    // The next complete item proves the preceding object was not a repaired partial value.
    controller.enqueue(encoder.encode(delta(JSON.stringify(bad))));
    await vi.waitFor(() => expect(events.some(e => e.type === 'claim' && e.claim.id === first.id)).toBe(true));
    expect(completed).toBe(false);
    expect(JSON.stringify(events)).not.toContain('98765');
    controller.enqueue(encoder.encode(delta(`],"authorInterpretation":[],"engineeringImplication":[],"applicabilityConditions":[],"openQuestions":[]}`)));
    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    controller.close();
    const final = await result;
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).stream).toBe(true);
    expect(final.mode).toBe('DETERMINISTIC_ENGINE');
    expect(final.fallbackReason).toBe('verification_failed');
    expect(verifySynthesis(final, review.evidencePackage).passed).toBe(true);
    expect(JSON.stringify(events)).not.toContain('98765');
  });

  it('preserves checked LIVE_AI prose when the complete streamed document passes', async () => {
    const events: ReviewProgress[] = [];
    const text = JSON.stringify(review.synthesis);
    const response = new Response(delta(text.slice(0, 150)) + delta(text.slice(150)) + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    const result = await generateSynthesis(review.evidencePackage, { mode: 'LIVE_AI', apiKey: 'test-only', strictLive: true, fetchImpl: async () => response,
      consumeResponse: (r, p, d) => consumeSynthesisStream(r, p, d, e => events.push(e)) });
    expect(result.mode).toBe('LIVE_AI');
    expect(events.some(e => e.type === 'claim')).toBe(true);
  });

  it('rejects truncated provider streams even if a partial JSON document could be repaired', async () => {
    const response = new Response(delta('{"observedFact":['), { headers: { 'Content-Type': 'text/event-stream' } });
    await expect(consumeSynthesisStream(response, review.evidencePackage, review.synthesis, () => undefined)).rejects.toThrow('interrupted');
  });
});
