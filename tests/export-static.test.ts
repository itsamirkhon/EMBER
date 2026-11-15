import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { exportCorpusText, exportReviewText, getReviewSnapshot } from '../src/ui/apiClient';
import type { CorpusV2 } from '../src/core';

const corpusJson = readFileSync(new URL('../public/data/corpus_v2.json', import.meta.url), 'utf8');
const indexJson = readFileSync(new URL('../public/data/chunks_index.json', import.meta.url), 'utf8');
const corpus = JSON.parse(corpusJson) as CorpusV2;
const fetched: string[] = [];

describe('static AWS exports do not depend on the absent Node API', () => {
  beforeAll(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      if (url === './data/corpus_v2.json') {
        return new Response(corpusJson, { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === './data/chunks_index.json') {
        return new Response(indexJson, { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.startsWith('/api/')) {
        // Reproduce the production static-host SPA fallback bug: HTTP 200 HTML
        // rather than HTTP 404 from an unknown /api route.
        return new Response('<!doctype html><html><body>EMBER</body></html>', {
          status: 200, headers: { 'content-type': 'text/html' },
        });
      }
      throw new Error('Unexpected export fetch: ' + url);
    }));
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('exports the complete NASA PSI JSON from static data without a saved review', async () => {
    const file = await exportCorpusText('json');
    expect(file.filename).toMatch(/^ember-psi-.+-json\.json$/);
    expect(file.mimeType).toContain('application/json');
    const parsed = JSON.parse(file.content) as CorpusV2;
    expect(parsed.tests.length).toBe(corpus.tests.length);
    expect(parsed.investigations.length).toBe(corpus.investigations.length);
    expect(parsed.corpusVersion).toBe(corpus.corpusVersion);
  });

  it('exports a nonempty CSV with every recorded test and source identifiers', async () => {
    const file = await exportCorpusText('csv');
    const lines = file.content.trim().split(/\r?\n/);
    expect(lines[0]).toContain('testId');
    expect(lines[0]).toContain('sourceId');
    expect(lines[0]).toContain('groupId');
    expect(lines.length - 1).toBe(corpus.tests.length);
    expect(file.mimeType).toContain('text/csv');
    expect(file.content).not.toMatch(/^\s*<!doctype html/i);
  });

  it('exports endpoint-scoped modeling CSV without mixing fuel phases', async () => {
    const file = await exportCorpusText('modeling_csv', { fuelPhase: 'solid', endpoint: 'spread_rate' });
    const lines = file.content.trim().split(/\r?\n/);
    const header = lines[0].split(',');
    expect(header).toContain('groupId');
    expect(header).toContain('fuelPhase');
    expect(header).toContain('o2Provenance');
    expect(header).toContain('pressureProvenance');
    expect(header).toContain('protocolSummary');
    expect(lines.length).toBeGreaterThan(1);
    const phaseColumn = header.indexOf('fuelPhase');
    for (const row of lines.slice(1, 8)) {
      expect(row.split(',')[phaseColumn]).toBe('solid');
    }
  });

  it('rejects a modeling export with no compatible target', async () => {
    await expect(exportCorpusText('modeling_csv')).rejects.toThrow(/Select a compatible/);
  });

  it('does not save HTML when the absent review export API returns 200 HTML', async () => {
    const file = await exportReviewText('demo-pmma-lunar', 'markdown');
    expect(file.content).toContain('# EMBER Review:');
    expect(file.content).not.toContain('<!doctype html>');
    expect(fetched.some((url) => url.includes('/api/reviews/demo-pmma-lunar/export'))).toBe(true);
  });

  it('exports an already loaded review without contacting the missing API', async () => {
    const snapshot = (await getReviewSnapshot('demo-pmma-lunar')).snapshot;
    const before = fetched.length;
    const file = await exportReviewText(snapshot.reviewId, 'json', snapshot.review);
    expect(JSON.parse(file.content)).toHaveProperty('query');
    expect(fetched.slice(before).some((url) => url.startsWith('/api/'))).toBe(false);
  });
});
