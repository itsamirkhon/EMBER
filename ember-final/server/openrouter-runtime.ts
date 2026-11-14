/** Server adapters compose provider I/O with the pure scientific pipeline. */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {embeddingContentHash,type EmbeddingArtifact} from '../pipeline/embed_openrouter';
import {searchHybrid} from '../src/core/retrieval';
import type {ReviewInput} from '../src/core/reviewEngine';
import type {ChunksIndex,CorpusV2,RetrievalHit} from '../src/core/types';
import {OpenRouterClient,EMBEDDING_MODEL,EMBEDDING_FORMAT_VERSION,formatEmbeddingQuery} from './openrouter';

function record(value:unknown):Record<string,unknown>{
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('Invalid embedding artifact object');
  return value as Record<string,unknown>;
}
function parseVector(value:unknown,dimensions:number):number[]{
  if(!Array.isArray(value)||value.length!==dimensions||!value.every(v=>typeof v==='number'&&Number.isFinite(v)))throw new Error('Invalid embedding vector dimensions/values');
  const norm=Math.hypot(...value);
  if(!Number.isFinite(norm)||norm===0)throw new Error('Invalid zero embedding vector');
  return value.map(v=>v/norm);
}
function parseEntry(value:unknown,index:ChunksIndex,dimensions:number,seen:Set<string>):EmbeddingArtifact['entries'][number]{
  const item=record(value);
  const chunk=index.chunks.find(c=>c.chunkId===item.chunkId);
  if(!chunk||seen.has(chunk.chunkId)||item.contentHash!==embeddingContentHash(chunk))throw new Error('Embedding artifact chunk/hash mismatch; rebuild embeddings');
  seen.add(chunk.chunkId);
  return {chunkId:chunk.chunkId,contentHash:String(item.contentHash),vector:parseVector(item.vector,dimensions)};
}
export function validateEmbeddingArtifact(value:unknown,index:ChunksIndex,corpusVersion:string):EmbeddingArtifact{
  const data=record(value);
  if(data.corpusVersion!==corpusVersion||index.corpusVersion!==corpusVersion)throw new Error('Embedding artifact corpus version mismatch; rebuild embeddings');
  if(data.embeddingModel!==EMBEDDING_MODEL||data.formatVersion!==EMBEDDING_FORMAT_VERSION)throw new Error('Embedding artifact model/format mismatch');
  const dimensions=data.embeddingDim;
  if(typeof dimensions!=='number'||!Number.isInteger(dimensions)||dimensions<1||dimensions>3072)throw new Error('Invalid embedding dimensions');
  if(!Array.isArray(data.entries)||data.entries.length!==index.chunks.length)throw new Error('Embedding artifact must cover every chunk exactly once');
  const seen=new Set<string>();
  return {corpusVersion,embeddingModel:EMBEDDING_MODEL,formatVersion:EMBEDDING_FORMAT_VERSION,embeddingDim:dimensions,entries:data.entries.map(e=>parseEntry(e,index,dimensions,seen))};
}
function denseHits(index:ChunksIndex,artifact:EmbeddingArtifact,queryVector:number[],k:number):RetrievalHit[]{
  const vector=parseVector(queryVector,artifact.embeddingDim);
  const byId=new Map(index.chunks.map(c=>[c.chunkId,c]));
  return artifact.entries.map(entry=>{
    const score=entry.vector.reduce((sum,v,i)=>sum+v*vector[i],0);
    return {chunk:byId.get(entry.chunkId)!,score,denseScore:score,bm25Score:0,structuredScore:0,matchedTerms:[],rank:0};
  }).filter(hit=>hit.score>0).sort((a,b)=>b.score-a.score).slice(0,k).map((hit,i)=>({...hit,rank:i+1}));
}
export function createOpenRouterAdapters(corpus:CorpusV2,index:ChunksIndex,value:unknown,client:Pick<OpenRouterClient,'embed'|'evaluatePassage'>):Required<Pick<ReviewInput,'retrieve'|'passageEvaluator'|'embeddingModel'|'embeddingDim'>>{
  const artifact=validateEmbeddingArtifact(value,index,corpus.corpusVersion);
  const slots: Promise<unknown>[] = Array.from({length:4},()=>Promise.resolve());
  let next = 0;
  let failed = false;
  return {
    embeddingModel:artifact.embeddingModel,
    embeddingDim:artifact.embeddingDim,
    retrieve:async(query,currentIndex,k,mode)=>{
      if(currentIndex!==index) throw new Error('OpenRouter retrieval index changed; reload adapters');
      if(mode!=='hybrid') return searchHybrid(corpus,currentIndex,query,{k,mode});
      const [vector]=await client.embed([formatEmbeddingQuery(query.rawQuestion)],artifact.embeddingDim);
      return searchHybrid(corpus,currentIndex,query,{k,denseHits:denseHits(index,artifact,vector,Math.max(24,k*2))});
    },
    passageEvaluator:async(query,chunk)=>{
      const slot = next++ % slots.length;
      const request = slots[slot].then(()=>{
        if(failed) throw new Error('Decision scheduling stopped after a provider failure');
        return client.evaluatePassage({query,passage:{chunkId:chunk.chunkId,text:chunk.text,epistemicStatus:chunk.epistemicStatus,sectionHeader:chunk.sectionHeader}});
      }).catch(error=>{failed=true;throw error;});
      slots[slot] = request.catch(()=>undefined);
      const result=await request;
      return {...result,chunkId:chunk.chunkId,inv:chunk.inv,testId:chunk.testId,sourceRef:chunk.sourceRef};
    },
  };
}
export async function loadOpenRouterAdapters(rootDir:string,corpus:CorpusV2,index:ChunksIndex,options:ConstructorParameters<typeof OpenRouterClient>[0]){
  let value:unknown;
  try{value=JSON.parse(await readFile(join(rootDir,'data/openrouter_embeddings.json'),'utf8'));}
  catch{throw new Error('OpenRouter embedding artifact unavailable; run npm run embeddings:openrouter first');}
  return createOpenRouterAdapters(corpus,index,value,new OpenRouterClient(options));
}
