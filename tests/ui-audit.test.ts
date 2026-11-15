import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadStaticCorpus, loadStaticChunksIndex } from '../src/ui/apiClient';
import { safeExternalHost, safeExternalUrl } from '../src/ui/safeUrl';
import { clampFlowInput } from '../src/ui/v3/pages/LensPage';

const source = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('source provenance and unsafe input guards', () => {
  it('accepts only HTTP(S) external citations, rejecting script, data and malformed URLs', () => {
    expect(safeExternalUrl('https://psi.nasa.gov/physci/repo')).toBe('https://psi.nasa.gov/physci/repo');
    expect(safeExternalHost('https://www.nasa.gov/path')).toBe('nasa.gov');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('data:text/html,abc')).toBeNull();
    expect(safeExternalUrl('file:///etc/passwd')).toBeNull();
    expect(safeExternalUrl('not a URL')).toBeNull();
    expect(safeExternalHost('not a URL')).toBeNull();
  });

  it('clamps out-of-range airflow and invalid numeric inputs before the engine sees them', () => {
    expect(clampFlowInput('-12')).toBe(0);
    expect(clampFlowInput('200')).toBe(100);
    expect(clampFlowInput('17.5')).toBe(17.5);
    expect(clampFlowInput('not-a-number')).toBe(0);
  });

  it('does not accept SPA HTML as the static PSI corpus and can retry', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });
      return new Response(JSON.stringify({ corpusVersion: 'test-corpus', tests: [], investigations: [] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }));
    await expect(loadStaticCorpus()).rejects.toThrow();
    const corpus = await loadStaticCorpus();
    expect(corpus.corpusVersion).toBe('test-corpus');
    expect(calls).toBe(2);
  });

  it('rejects malformed chunk indices and can retry after a transient failure', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response('{"corpusVersion":"old","chunks":null}', { status: 200 })
        : new Response('{"corpusVersion":"new","chunks":[]}', { status: 200 });
    }));
    await expect(loadStaticChunksIndex()).rejects.toThrow(/missing required fields/i);
    const index = await loadStaticChunksIndex();
    expect(index.corpusVersion).toBe('new');
    expect(calls).toBe(2);
  });

  it('lets visitors reach overlapping mission presets individually through labeled buttons', () => {
    const map = source('../src/ui/v3/EvidenceMap.tsx');
    expect(map).toContain('aria-label="Choose a mission scenario"');
    expect(map).toContain('onClick={() => onPickMission(m)}');
    expect(map).toContain("r.o2Prov === 'assumed' || r.kPaProv === 'assumed'");
  });

  it('refuses cached Ask and Trust output from a mismatched corpus version', () => {
    const ask = source('../src/ui/v3/pages/AskPage.tsx');
    const trust = source('../src/ui/v3/pages/TrustPage.tsx');
    expect(ask).toContain('file.corpusVersion !== compact.corpusVersion');
    expect(ask).toContain('gravity not reported');
    expect(trust).toContain('trust.corpusVersion !== data.corpusVersion');
    expect(trust).toContain('trustError');
  });

  it('does not silently rank a canned PMMA question as the user’s selected review', () => {
    const investigations = source('../src/ui/pages/ExplorerPage.tsx');
    expect(investigations).toContain('Example ranking (no review selected)');
    expect(investigations).toContain('Investigation rankings unavailable');
  });
});
