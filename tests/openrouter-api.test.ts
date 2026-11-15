import {createServer,type Server} from 'node:http';
import {copyFile,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createApiHandler} from '../server/api';
import {DECISION_MODEL,EMBEDDING_MODEL} from '../server/openrouter';
import {buildEmbeddingArtifact} from '../pipeline/embed_openrouter';
import {readFile} from 'node:fs/promises';

describe('OpenRouter HTTP review path',()=>{
 let root:string,server:Server,url:string;
 const oldKey=process.env.OPENROUTER_API_KEY;
 const oldGenerationKey=process.env.OPENAI_API_KEY;
 const nativeChoice=(choice:string,others:string[])=>({type:'choice',choice,confidence:.8,probabilities:Object.fromEntries([[choice,.8],...others.map(x=>[x,.1])])});
 const fetchImpl=vi.fn<typeof fetch>(async endpoint=>new Response(JSON.stringify(String(endpoint).endsWith('/embeddings')
  ? {model:EMBEDDING_MODEL,data:[{index:0,embedding:[1,0]}]}
  : {id:'d1',model:DECISION_MODEL,answers:{Q1_RELEVANCE:nativeChoice('direct_match',['partial_context','not_relevant']),Q2_OBSERVATION:nativeChoice('observed_finding',['planned_or_hypothesis','method_or_assumption']),Q3_CONTRADICTION:nativeChoice('consistent',['tension_or_conflict','insufficient_to_judge'])}}),{status:200}));
 beforeAll(async()=>{
  root=await mkdtemp(join(tmpdir(),'ember-or-api-'));
  await mkdir(join(root,'public/data'),{recursive:true});await mkdir(join(root,'data'));
  for(const file of ['corpus_v2.json','chunks_index.json'])await copyFile(resolve('public/data',file),join(root,'public/data',file));
  process.env.OPENROUTER_API_KEY='test-only-secret';delete process.env.OPENAI_API_KEY;
  const handler=createApiHandler(root,{storePath:join(root,'data/reviews.json'),fetchImpl});
  server=createServer((req,res)=>{void handler(req,res);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw new Error('missing test port');url=`http://127.0.0.1:${address.port}`;
 });
 afterAll(async()=>{
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldKey;
  if(oldGenerationKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldGenerationKey;
  await rm(root,{recursive:true,force:true});
 });
 it('shows missing embedding artifact as explicit deterministic fallback without paid requests',async()=>{
  const response=await fetch(url+'/api/reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'PMMA flame spread',useLiveAi:true,retrievalK:2})});
  expect(response.status).toBe(201);
  const body=await response.json();
  expect(body.warnings.join(' ')).toMatch(/embedding artifact/);
  expect(body.mode).toBe('DETERMINISTIC_ENGINE');
  expect(fetchImpl).not.toHaveBeenCalled();
 });
 it('runs Gemini decision/embedding models server-side and records actual provider provenance',async()=>{
  const source=JSON.parse(await readFile(join(root,'public/data/chunks_index.json'),'utf8'));
  const artifact=await buildEmbeddingArtifact(source,{embed:async inputs=>inputs.map(()=>[1,0])},{dimensions:2});
  await writeFile(join(root,'data/openrouter_embeddings.json'),JSON.stringify(artifact));
  const response=await fetch(url+'/api/reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'PMMA thin film sustained spread 22% O2 101.3 kPa in microgravity',useLiveAi:true,retrievalK:2})});
  expect(response.status).toBe(201);
  const body=await response.json();
  expect(fetchImpl.mock.calls.map(([u])=>String(u))).toContain('https://openrouter.ai/api/alpha/decisions');
  expect(body.versions.jevPrompt).toBe('decision-v1.0');
  expect(JSON.stringify(body)).not.toContain('test-only-secret');
  const review=body.data.snapshot?.review??body.data.review;
  expect(review.envelope.decisionModel).toBe(DECISION_MODEL);
  expect(review.envelope.embeddingModel).toBe(EMBEDDING_MODEL);
  expect(review.evidencePackage.jevDecisions.every((x:{evaluatorMode:string})=>x.evaluatorMode==='live_openrouter')).toBe(true);
  // No prose model was specified/configured: native decisions are live, prose is explicitly templated.
  expect(review.synthesis.mode).toBe('DETERMINISTIC_ENGINE');
 });
 it('retries an automatic live fallback after the embedding artifact becomes available',async()=>{
  const before=fetchImpl.mock.calls.length;
  const response=await fetch(url+'/api/reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'PMMA flame spread',useLiveAi:true,retrievalK:2})});
  expect(response.status).toBe(201);
  expect(fetchImpl.mock.calls.length).toBeGreaterThan(before);
  expect((await response.json()).warnings).toEqual([]);
 });
 it('does not replay a deterministic request when live models are requested',async()=>{
  const question='PMMA mode cache isolation 22% oxygen';
  const post=(useLiveAi:boolean)=>fetch(url+'/api/reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,useLiveAi,retrievalK:2})});
  expect((await post(false)).status).toBe(201);
  const before=fetchImpl.mock.calls.length;
  const live=await post(true);
  expect(live.status).toBe(201);
  expect(fetchImpl.mock.calls.length).toBeGreaterThan(before);
 });
 it('rejects reuse of an explicit idempotency key for a different request',async()=>{
  const post=(question:string)=>fetch(url+'/api/reviews',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'explicit-conflict'},body:JSON.stringify({question})});
  expect((await post('PMMA explicit key first')).status).toBe(201);
  expect((await post('polyethylene explicit key second')).status).toBe(409);
 });

});
