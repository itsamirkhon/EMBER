import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateDeterministicSynthesis, runReviewSync, type CorpusV2, type EvidencePackage } from '../src/core';
const corpus = JSON.parse(readFileSync('public/data/corpus_v2.json','utf8')) as CorpusV2;
const pkg = runReviewSync({question:'PMMA thin film flame spread in microgravity',corpus,retrievalK:12}).evidencePackage;

describe('deterministic epistemic partition', () => {
  it('preserves real source interpretations even when passage triage routes them as evidence', () => {
    const interpretationIds = pkg.retrievedHits.filter((hit) => hit.chunk.epistemicStatus === 'source_interpretation' && pkg.evidenceChunks.some((decision) => decision.chunkId === hit.chunk.chunkId)).map((hit) => hit.chunk.chunkId);
    expect(interpretationIds.length).toBeGreaterThan(0);
    const synthesis = generateDeterministicSynthesis(pkg);
    for (const id of interpretationIds) {
      expect(synthesis.observedFact.some((claim) => claim.citations.includes(id))).toBe(false);
      expect(synthesis.authorInterpretation.some((claim) => claim.citations.includes(id))).toBe(true);
    }
  });
  it.each(['source_interpretation','planned','planned_only','hypothesis'])('never promotes %s metadata into observed facts despite erroneous observed triage', (epistemicStatus) => {
    const hit = pkg.retrievedHits.find((entry) => entry.chunk.chunkId === 'c-0010')!;
    const decision = pkg.jevDecisions.find((entry) => entry.chunkId === hit.chunk.chunkId)!;
    const isolated: EvidencePackage = {
      ...pkg, retrievedHits:[{...hit,chunk:{...hit.chunk,epistemicStatus}}],
      evidenceChunks:[{...decision,route:'evidence',q2Observation:{...decision.q2Observation,answer:'observed_finding'}}],
      contextChunks:[], conflictChunks:[], applicabilityDecisions:[], evaluatedTests:[], rankings:[],
    };
    const synthesis = generateDeterministicSynthesis(isolated);
    expect(synthesis.observedFact).toEqual([]);
    expect(synthesis.authorInterpretation.some((claim) => claim.citations.includes(hit.chunk.chunkId))).toBe(true);
    expect(synthesis.authorInterpretation[0].provenance).toBe(epistemicStatus === 'source_interpretation' ? 'interpretation' : 'planned');
  });
  it('does not copy a whole investigation objective card as an atomic observed result', () => {
    const synthesis = generateDeterministicSynthesis(pkg);
    const cardIds = new Set(pkg.retrievedHits.filter((hit) => hit.chunk.kind === 'investigation_card').map((hit) => hit.chunk.chunkId));
    expect(cardIds.size).toBeGreaterThan(0);
    expect(synthesis.observedFact.every((claim) => claim.citations.every((id) => !cardIds.has(id)))).toBe(true);
  });
});

import { classifySynthesisEvidence } from '../src/core/synthesisEvidence';
describe('source-reviewed mixed observation/explanation override', () => {
  it('attributes the exact reviewed c-0024 claim without a general text heuristic', () => {
    const chunk = pkg.retrievedHits.find((hit) => hit.chunk.chunkId === 'c-0024')!.chunk;
    expect(classifySynthesisEvidence(chunk)).toEqual(expect.objectContaining({metadataObserved:false,authorStatus:'source_interpretation',overrideBasis:expect.any(String)}));
    expect(classifySynthesisEvidence({...chunk,sourceRef:{...chunk.sourceRef,quote:'Different source'}}).authorStatus).toBeNull();
    expect(classifySynthesisEvidence({...chunk,text:'A different measured quenching result.'}).metadataObserved).toBe(true);
  });
  it('recognizes the corresponding exact pipeline serialization', () => {
    const index = JSON.parse(readFileSync('public/data/chunks_index.json','utf8')) as {chunks:import('../src/core').ChunkRecord[]};
    const chunk = index.chunks.find((entry) => entry.chunkId === 'chk-claim-c-0024')!;
    expect(classifySynthesisEvidence(chunk).authorStatus).toBe('source_interpretation');
  });
});
