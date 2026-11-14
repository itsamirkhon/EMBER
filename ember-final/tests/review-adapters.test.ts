import {readFileSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import {runReview} from '../src/core/reviewEngine';
import {evaluatePassageWithJevOffline} from '../src/core/jev';
import type {CorpusV2,ChunksIndex,ResearchQuery,ChunkRecord} from '../src/core/types';
const corpus:CorpusV2=JSON.parse(readFileSync('public/data/corpus_v2.json','utf8'));
const index:ChunksIndex=JSON.parse(readFileSync('public/data/chunks_index.json','utf8'));
describe('injected live retrieval and passage decisions',()=>{
 it('uses the server retrieval result and decision adapter without a generation key',async()=>{
  const chunk=index.chunks[0];
  const retrieve=vi.fn(async()=>[{chunk,score:1,bm25Score:0,denseScore:1,structuredScore:0,matchedTerms:[],rank:1}]);
  const passageEvaluator=vi.fn(async(q:ResearchQuery,part:ChunkRecord)=>evaluatePassageWithJevOffline(q,part,{corpus}));
  const review=await runReview({question:'PMMA flame spread',corpus,index,retrieve,passageEvaluator});
  expect(retrieve).toHaveBeenCalledOnce();
  expect(passageEvaluator).toHaveBeenCalledOnce();
  expect(review.evidencePackage.retrievedHits.map(h=>h.chunk.chunkId)).toEqual([chunk.chunkId]);
  expect(review.synthesis.mode).toBe('DETERMINISTIC_ENGINE');
 });
 it('does not silently replace a failed decision provider with heuristic decisions',async()=>{
  await expect(runReview({question:'PMMA flame spread',corpus,index,passageEvaluator:async()=>{throw new Error('decision unavailable');}})).rejects.toThrow('decision unavailable');
 });
});
