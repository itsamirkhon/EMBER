/** Source-reviewed passage role. A passage role never proves every sentence scientifically. */
import type { ChunkRecord } from './types';

export interface SynthesisEvidenceRole {
  metadataObserved: boolean;
  authorStatus: 'source_interpretation' | 'planned' | 'hypothesis' | null;
  overrideBasis?: string;
}

// NTRS 20150008961 describes observed quenching together with the author's heat-loss
// explanation. Keeping the combined sentence as an attributed interpretation preserves
// the useful observation without turning its mechanistic explanation into a new finding.
// This exact source/text override does not classify other passages by causal keywords.
const QUENCH_CLAIM = 'Quenching of PMMA rod flames occurred when the flow became too weak for the flame to offset conduction and radiation heat losses.';
const QUENCH_QUOTE = 'Quenching was observed when the flow became sufficiently weak that the flame could no longer provide adequate heat flux to compensate for the heat losses (conduction into the rod and radiation).';
const QUENCH_TEXTS = new Set([
  `${QUENCH_CLAIM} BASS-II investigation conditions flow solid`,
  `[Claim c-0024 (BASS-II, observed)]\nClaim: ${QUENCH_CLAIM}\nQuote: ${QUENCH_QUOTE}\nScope: BASS-II investigation conditions\nLimitations: `,
]);
function reviewedQuenchExplanation(chunk: ChunkRecord): boolean {
  return ['c-0024', 'chk-claim-c-0024'].includes(chunk.chunkId) && chunk.kind === 'claim' &&
    chunk.inv === 'BASS-II' && chunk.sourceRef.sourceId === 'ntrs-20150008961' &&
    chunk.sourceRef.fileHash === '0980cf9c57cac955cab1777db1c5d7ed63c172074ac1c4d97533553422843fa9' &&
    chunk.sourceRef.quote === QUENCH_QUOTE && QUENCH_TEXTS.has(chunk.text);
}
export function classifySynthesisEvidence(chunk: ChunkRecord): SynthesisEvidenceRole {
  if (reviewedQuenchExplanation(chunk)) return {
    metadataObserved: false,
    authorStatus: 'source_interpretation',
    overrideBasis: 'Source-reviewed mixed observation/explanation in NTRS 20150008961; exact c-0024 text and source quote/hash.',
  };
  const authorStatus = chunk.epistemicStatus === 'source_interpretation' ? 'source_interpretation'
    : chunk.epistemicStatus === 'planned' || chunk.epistemicStatus === 'planned_only' ? 'planned'
    : chunk.epistemicStatus === 'hypothesis' ? 'hypothesis' : null;
  return { metadataObserved: chunk.epistemicStatus === 'observed' && chunk.kind !== 'investigation_card', authorStatus };
}
