import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReview } from '../src/ui/apiClient';

const encoder = new TextEncoder();
const frame = (event: unknown) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
const envelope = { status: 'ok', warnings: [], data: { reviewId: 'stream-review' } };
const params = { question: 'PMMA flame spread', useLiveAi: true };

afterEach(() => vi.unstubAllGlobals());

describe('browser review stream transport', () => {
  it('delivers progress before the final snapshot, then returns the saved review', async () => {
    let writer!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(c) { writer = c; } });
    const fetchImpl = vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchImpl);
    const progress = vi.fn();
    let complete = false;
    const result = createReview(params, progress).then(value => { complete = true; return value; });
    writer.enqueue(frame({ type: 'stage', stage: 'retrieval' }));
    await vi.waitFor(() => expect(progress).toHaveBeenCalledWith({ type: 'stage', stage: 'retrieval' }));
    expect(complete).toBe(false);
    writer.enqueue(frame({ type: 'result', envelope }));
    writer.close();
    expect((await result).snapshot.reviewId).toBe('stream-review');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('does not retry or turn a dropped stream into a successful offline answer', async () => {
    const fetchImpl = vi.fn(async () => new Response(frame({ type: 'stage', stage: 'synthesis' }), { headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchImpl);
    await expect(createReview(params, () => undefined)).rejects.toThrow('before the final checks');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('keeps compatibility with older JSON APIs and preserves validation errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(envelope), { headers: { 'Content-Type': 'application/json' } })));
    expect((await createReview(params, () => undefined)).meta.backendSource).toBe('node_api');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'error', error: { message: 'Research topic required' } }), { status: 422, headers: { 'Content-Type': 'application/json' } })));
    await expect(createReview(params, () => undefined)).rejects.toThrow('Research topic required');
  });

  it('does not launch an offline fallback when a request is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => { throw new DOMException('Aborted', 'AbortError'); });
    vi.stubGlobal('fetch', fetchImpl);
    await expect(createReview(params, () => undefined, controller.signal)).rejects.toThrow('Aborted');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
