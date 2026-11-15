import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateDeterministicSynthesis, generateSynthesis } from '../src/core/generator';
import { runReviewSync } from '../src/core/reviewEngine';
import { verifySynthesis } from '../src/core/verifier';
import type { ChunksIndex, CorpusV2 } from '../src/core/types';

const corpus = JSON.parse(readFileSync('public/data/corpus_v2.json', 'utf8')) as CorpusV2;
const index = JSON.parse(readFileSync('public/data/chunks_index.json', 'utf8')) as ChunksIndex;
const base = runReviewSync({ question: 'PMMA flame spread', corpus, retrievalK: 2 }).evidencePackage;
const chunk = index.chunks.find((c) => c.chunkId === 'chk-claim-c-0020')!;
// Exercise the deployed index's exact passage, including its long metadata prefix.
const pkg = { ...base, retrievedHits: [...base.retrievedHits, { ...base.retrievedHits[0], chunk }] };

describe('source-safe synthesis and explicit fallback', () => {
  it('keeps the BASS-II airflow unit intact in the deterministic answer and passes verification', () => {
    const synthesis = generateDeterministicSynthesis(pkg);
    const interpretation = synthesis.authorInterpretation.find((c) => c.citations.includes(chunk.chunkId));
    expect(interpretation?.text).toContain('53 cm/s.');
    expect(interpretation?.text).not.toContain('53 cm...');
    expect(verifySynthesis(synthesis, pkg).passed).toBe(true);
  });

  it('preserves a qualification after a long measurement clause', () => {
    const text = `The source reports ${'carefully controlled '.repeat(12)}53 cm / s, but only for the tunnel capability, not an extinction threshold.`;
    const qualifiedPkg = { ...pkg, retrievedHits: [{ ...pkg.retrievedHits[0], chunk: { ...chunk, text } }] };
    const synthesis = generateDeterministicSynthesis(qualifiedPkg);
    expect(synthesis.authorInterpretation[0].text).toContain(text);
  });

  it('retains short complete sentences without appending a partial next sentence', () => {
    const text = `The tunnel capability was 53 cm/s. ${'Additional source context '.repeat(20)}.`;
    const shortPkg = { ...pkg, retrievedHits: [{ ...pkg.retrievedHits[0], chunk: { ...chunk, text } }] };
    const synthesis = generateDeterministicSynthesis(shortPkg);
    expect(synthesis.authorInterpretation[0].text).toContain('The tunnel capability was 53 cm/s. …');
    expect(synthesis.authorInterpretation[0].text).not.toContain('Additional');
  });

  it.each([
    ['provider_error', async () => new Response('private provider detail', { status: 503 })],
    ['invalid_response', async () => new Response('{broken JSON')],
    ['verification_failed', async () => {
      const synthesis = generateDeterministicSynthesis(pkg);
      synthesis.observedFact[0].text += ' Pressure was 98765 kPa.';
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(synthesis) } }] }));
    }],
  ] as const)('reports %s without exposing provider details or unverified prose', async (reason, fetchImpl) => {
    const synthesis = await generateSynthesis(pkg, { mode: 'LIVE_AI', apiKey: 'test-only', fetchImpl });
    expect(synthesis.mode).toBe('DETERMINISTIC_ENGINE');
    expect(synthesis.fallbackReason).toBe(reason);
    expect(JSON.stringify(synthesis)).not.toMatch(/private provider detail|98765|test-only/);
    expect(verifySynthesis(synthesis, pkg).passed).toBe(true);
  });

  it('accepts checked live prose with the complete BASS-II quantity', async () => {
    const synthesis = await generateSynthesis(pkg, {
      mode: 'LIVE_AI', apiKey: 'test-only', strictLive: true,
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(generateDeterministicSynthesis(pkg)) } }] })),
    });
    expect(synthesis.mode).toBe('LIVE_AI');
    expect(synthesis.fallbackReason).toBeUndefined();
    expect(synthesis.authorInterpretation.some((c) => c.text.includes('53 cm/s.'))).toBe(true);
  });
});
