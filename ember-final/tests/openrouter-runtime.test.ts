import {parseResearchQuery} from '../src/core/queryParser';
import {createHash} from 'node:crypto';
import {describe,expect,it,vi} from 'vitest';
import {validateEmbeddingArtifact,createOpenRouterAdapters} from '../server/openrouter-runtime';
import {formatEmbeddingDocument,EMBEDDING_MODEL} from '../server/openrouter';
import type {ChunksIndex,CorpusV2} from '../src/core/types';
const chunk={chunkId:'a',text:'PMMA measured flame spread',sectionHeader:'Results',inv:null,testId:null,kind:'claim',epistemicStatus:'observed',tableUnits:null,vector:[1],sourceRef:{sourceId:'s',url:null,doi:null}};
const index={corpusVersion:'v1',embeddingModel:'local-svd',embeddingDim:1,vocabulary:{},idf:[],svdComponents:[],chunks:[chunk]} as ChunksIndex;
const hash=createHash('sha256').update(formatEmbeddingDocument(chunk.text,chunk.sectionHeader)).digest('hex');
const artifact=()=>({corpusVersion:'v1',embeddingModel:EMBEDDING_MODEL,embeddingDim:2,formatVersion:'gemini-search-v1',entries:[{chunkId:'a',contentHash:hash,vector:[1,0]}]});
describe('server embedding compatibility',()=>{
 it('accepts vectors only for the current corpus and exact chunk contents',()=>expect(validateEmbeddingArtifact(artifact(),index,'v1').entries).toHaveLength(1));
 it.each(['version','model','hash','dimensions','duplicate','zero'])('rejects %s before making paid requests',(bad)=>{
  const x=artifact();
  if(bad==='version') x.corpusVersion='v0';
  if(bad==='model') x.embeddingModel='other' as typeof EMBEDDING_MODEL;
  if(bad==='hash') x.entries[0].contentHash='wrong';
  if(bad==='dimensions')x.entries[0].vector=[1];
  if(bad==='duplicate')x.entries.push(x.entries[0]);
  if(bad==='zero')x.entries[0].vector=[0,0];
  expect(()=>validateEmbeddingArtifact(x,index,'v1')).toThrow();
 });
 it('uses query embeddings for retrieval and the decision model for passages',async()=>{
  const embed=vi.fn().mockResolvedValue([[1,0]]);
  const evaluatePassage=vi.fn().mockResolvedValue({evaluatorMode:'live_openrouter',model:'google/gemini-decision-1',responseId:'d1',promptVersion:'decision-v1.0'});
  const corpus={corpusVersion:'v1',tests:[],investigations:[]} as unknown as CorpusV2;
  const adapters=createOpenRouterAdapters(corpus,index,artifact(),{embed,evaluatePassage});
  const query={rawQuestion:'PMMA spread'} as Parameters<typeof adapters.retrieve>[0];
  const hits=await adapters.retrieve(query,index,5,'hybrid');
  expect(hits[0].chunk.chunkId).toBe('a');
  expect(embed).toHaveBeenCalledWith(['task: search result | query: PMMA spread'],2);
  const decision=await adapters.passageEvaluator(query,chunk);
  expect(decision.model).toBe('google/gemini-decision-1');
  expect(decision.chunkId).toBe('a');
  expect(evaluatePassage).toHaveBeenCalledOnce();
 });
 it('keeps a requested BM25 ablation free of embedding calls',async()=>{
  const embed=vi.fn();const evaluatePassage=vi.fn();
  const corpus={corpusVersion:'v1',tests:[],investigations:[]} as unknown as CorpusV2;
  const adapters=createOpenRouterAdapters(corpus,index,artifact(),{embed,evaluatePassage});
  const hits=await adapters.retrieve(parseResearchQuery('PMMA'),index,5,'bm25');
  expect(hits[0].chunk.chunkId).toBe('a');expect(embed).not.toHaveBeenCalled();
 });
 it('does not combine provider vectors with a replaced search index',async()=>{
  const client={embed:vi.fn(),evaluatePassage:vi.fn()};
  const adapters=createOpenRouterAdapters({corpusVersion:'v1'} as CorpusV2,index,artifact(),client);
  await expect(adapters.retrieve(parseResearchQuery('PMMA'),{...index},5,'hybrid')).rejects.toThrow('index changed');
  expect(client.embed).not.toHaveBeenCalled();
 });
 it('stops queued paid decisions after an earlier provider failure',async()=>{
  const evaluatePassage=vi.fn().mockRejectedValue(new Error('provider unavailable'));
  const adapters=createOpenRouterAdapters({corpusVersion:'v1'} as CorpusV2,index,artifact(),{embed:vi.fn(),evaluatePassage});
  const results=await Promise.allSettled(Array.from({length:20},()=>adapters.passageEvaluator(parseResearchQuery('PMMA'),chunk)));
  expect(results.every(result=>result.status==='rejected')).toBe(true);
  expect(evaluatePassage.mock.calls.length).toBeLessThanOrEqual(4);
 });

});
