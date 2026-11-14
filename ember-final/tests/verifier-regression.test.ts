import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runReviewSync, verifySynthesis, type CorpusV2, type GeneratedSynthesis } from '../src/core/index';

const corpus = JSON.parse(readFileSync('public/data/corpus_v2.json', 'utf8')) as CorpusV2;
const review = runReviewSync({
  question: 'PMMA 0.1 mm thin film sustained spread at 22.2% O2 101.3 kPa 5 cm/s opposed flow microgravity',
  overrides: { targetEndpoint: 'sustained_spread' },
  corpus,
});

function changedFact(text: string): GeneratedSynthesis {
  return { ...review.synthesis, observedFact: [{ ...review.synthesis.observedFact[0], text }] };
}

describe('scientific synthesis verification regressions', () => {
  it('retains a real deterministic review and its source-grounded observations', () => {
    expect(review.synthesis.observedFact.length).toBeGreaterThan(0);
    expect(verifySynthesis(review.synthesis, review.evidencePackage).passed).toBe(true);
  });

  it.each(['observedFact', 'authorInterpretation', 'engineeringImplication'] as const)(
    'rejects an appended safety guarantee in %s even with valid citations', (section) => {
      const fact = review.synthesis.observedFact[0];
      const synthesis = {
        ...review.synthesis,
        [section]: [{ ...fact, id: 'unsafe-transfer', text: `${fact.text} This PMMA configuration is safe for crewed spacecraft and will always self extinguish.` }],
      };
      const report = verifySynthesis(synthesis, review.evidencePackage);
      expect(report.passed).toBe(false);
      expect(report.constraintPreservationCheck.passed).toBe(false);
      expect(report.flaggedClaimIds).toContain('unsafe-transfer');
    },
  );

  it('also rejects a safety guarantee placed only in the raw summary', () => {
    const synthesis = { ...review.synthesis, rawSummary: 'This configuration is safe for crewed spacecraft.' };
    expect(verifySynthesis(synthesis, review.evidencePackage).constraintPreservationCheck.passed).toBe(false);
  });

  it('does not let an unrelated appended sentence borrow source overlap', () => {
    const fact = review.synthesis.observedFact[0];
    const report = verifySynthesis(changedFact(`${fact.text} Purple elephants operate orbital umbrellas.`), review.evidencePackage);
    expect(report.lexicalEntailmentCheck.passed).toBe(false);
  });

  it('rejects a cited test quantity with a swapped unit despite globally allowed numbers', () => {
    const test = corpus.tests.find((t) => t.testId === 'BASS-II-B1')!;
    const synthesis = {
      ...review.synthesis,
      observedFact: [{ id: 'unit-swap', text: `Test ${test.testId} recorded pressure ${test.atmosphere.pressure.value} mm [${test.testId}].`, citations: [test.testId], provenance: 'reported' as const }],
    };
    const report = verifySynthesis(synthesis, review.evidencePackage);
    expect(report.numericUnitCheck.passed).toBe(false);
  });

  it('does not borrow a pressure from a different retrieved test', () => {
    const synthesis = {
      ...review.synthesis,
      observedFact: [{ id: 'wrong-test', text: 'Test BASS-II-B1 recorded pressure 100 kPa [BASS-II-B1].', citations: ['BASS-II-B1'], provenance: 'reported' as const }],
    };
    expect(verifySynthesis(synthesis, review.evidencePackage).numericUnitCheck.passed).toBe(false);
  });

  it('does not let a negative boundary in an earlier clause excuse a later guarantee', () => {
    const fact = review.synthesis.observedFact[0];
    const synthesis = {
      ...review.synthesis,
      authorInterpretation: [{ ...fact, text: `This configuration is not qualified, but it is safe for crewed spacecraft. [${fact.citations[0]}]` }],
    };
    expect(verifySynthesis(synthesis, review.evidencePackage).constraintPreservationCheck.passed).toBe(false);
  });

  it('keeps a quoted, limited self-extinction observation with its citation', () => {
    const fact = review.synthesis.observedFact[0];
    const quote = 'The tested sample self-extinguished after the operator stopped the flow.';
    const pkg = {
      ...review.evidencePackage,
      retrievedHits: review.evidencePackage.retrievedHits.map((hit) => hit.chunk.chunkId === fact.citations[0] ? { ...hit, chunk: { ...hit.chunk, text: quote } } : hit),
    };
    expect(verifySynthesis(changedFact(`${quote} [${fact.citations[0]}]`), pkg).passed).toBe(true);
  });

  it('does not confuse later self-extinction with absence of ignition', () => {
    const fact = review.synthesis.observedFact[0];
    const pkg = {
      ...review.evidencePackage,
      retrievedHits: review.evidencePackage.retrievedHits.map((hit) => hit.chunk.chunkId === fact.citations[0] ? { ...hit, chunk: { ...hit.chunk, text: 'The sample ignited and spread, then self-extinguished after flow shutoff.' } } : hit),
    };
    const synthesis = changedFact(`The sample ignited and spread. [${fact.citations[0]}]`);
    expect(verifySynthesis(synthesis, pkg).lexicalEntailmentCheck.passed).toBe(true);
  });

  it('does not treat a query-only quantity as an observed measurement', () => {
    const fact = review.synthesis.observedFact[0];
    const pkg = { ...review.evidencePackage, query: { ...review.query, pressureKpa: 987.65 } };
    const report = verifySynthesis(changedFact(`${fact.text} Pressure was 987.65 kPa.`), pkg);
    expect(report.numericUnitCheck.passed).toBe(false);
  });

  it('keeps a negative safety boundary rather than banning safety vocabulary', () => {
    const fact = review.synthesis.observedFact[0];
    const synthesis = {
      ...review.synthesis,
      engineeringImplication: [{ ...fact, id: 'boundary', text: `These observations do not establish that this configuration is safe for crewed spacecraft and cannot guarantee that it will always self extinguish. [${fact.citations[0]}]` }],
    };
    expect(verifySynthesis(synthesis, review.evidencePackage).constraintPreservationCheck.passed).toBe(true);
  });
});
