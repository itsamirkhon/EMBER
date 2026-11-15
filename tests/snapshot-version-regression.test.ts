import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {EmberStore,type SavedReviewSnapshot} from '../server/store';
import {createApiHandler} from '../server/api';
import {createServer} from 'node:http';
import {runReviewSync,type CorpusV2} from '../src/core';
const corpus:CorpusV2=JSON.parse(readFileSync('public/data/corpus_v2.json','utf8'));
const review=runReviewSync({question:'PMMA thin film sustained spread',corpus});
function archived(reviewId='archived-review',isDemo=false):SavedReviewSnapshot{
 return {reviewId,title:'Historical result',createdAt:'2025-01-01',updatedAt:'2025-01-01',revision:1,idempotencyKey:reviewId,requestSignature:reviewId,isDemo,
 review:{...review,envelope:{...review.envelope,engineVersion:'old-engine',corpusVersion:'old-corpus'},evidencePackage:{...review.evidencePackage,evaluatedTests:undefined}},evaluatedTestIds:[corpus.tests[0].testId],variants:[],runs:[]};
}
const dirs:string[]=[];
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});vi.unstubAllGlobals();vi.resetModules();});

describe('historical snapshot version boundaries',()=>{
 it('does not attach current experimental records to archived conclusions',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ember-history-'));dirs.push(dir);const storePath=join(dir,'store.json');
  const snap=archived();writeFileSync(storePath,JSON.stringify({reviews:{[snap.reviewId]:snap}}));
  const store=new EmberStore({rootDir:resolve('.'),storePath});const restored=await store.getReview(snap.reviewId);
  expect(restored?.review.envelope.corpusVersion).toBe('old-corpus');
  expect(restored?.review.evidencePackage.evaluatedTests).toBeUndefined();
  expect(restored?.review.synthesis).toEqual(snap.review.synthesis);
 });
 it('preserves any embedded historical records when persisting an archive',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ember-history-'));dirs.push(dir);const storePath=join(dir,'store.json');
  const snap=archived();snap.review.evidencePackage.evaluatedTests=[{...corpus.tests[0],fuel:'archived-original-material'}];
  writeFileSync(storePath,JSON.stringify({reviews:{[snap.reviewId]:snap}}));
  const store=new EmberStore({rootDir:resolve('.'),storePath});await store.ensureInitialized();
  const stored=JSON.parse(readFileSync(storePath,'utf8'));
  expect(stored.reviews[snap.reviewId].review.evidencePackage.evaluatedTests?.[0].fuel).toBe('archived-original-material');
 });
 it('refreshes a server demo when corpus changes even if engine matches',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ember-history-'));dirs.push(dir);const storePath=join(dir,'store.json');
  const snap=archived('demo-pmma-lunar',true);snap.review.envelope.engineVersion=review.envelope.engineVersion;
  writeFileSync(storePath,JSON.stringify({reviews:{[snap.reviewId]:snap}}));
  const store=new EmberStore({rootDir:resolve('.'),storePath});const restored=await store.getReview(snap.reviewId);
  expect(restored?.review.envelope.corpusVersion).toBe(corpus.corpusVersion);
 });
 it('keeps historical API reads but blocks recomputation and current-data CSV',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ember-history-api-'));dirs.push(dir);const storePath=join(dir,'store.json');
  const snap=archived();writeFileSync(storePath,JSON.stringify({reviews:{[snap.reviewId]:snap}}));
  const handler=createApiHandler(resolve('.'),{storePath});const server=createServer((req,res)=>{void handler(req,res);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw new Error('missing test port');
  const base=`http://127.0.0.1:${address.port}/api/reviews/${snap.reviewId}`;
  try{
   expect((await fetch(base)).status).toBe(200);
   expect((await fetch(base+'/export?format=json')).status).toBe(200);
   expect((await fetch(base+'/export?format=markdown')).status).toBe(200);
   for(const path of ['/variants','/test-programmes']){
    const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({patch:{thicknessMm:10},budgetRuns:6})});
    expect(response.status).toBe(409);expect((await response.json()).error.code).toBe('ARCHIVED_REVIEW');
   }
   expect((await fetch(base+'/export?format=csv')).status).toBe(409);
   expect((await fetch(base+'/export?format=modeling_csv')).status).toBe(409);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
 });
 it('refreshes stale static demos and prevents variants on archived static reviews',async()=>{
  const demo=archived('demo-pmma-lunar',true),custom=archived();
  const storage=new Map<string,string>([['ember_v2_static_reviews_v1',JSON.stringify({[demo.reviewId]:demo,[custom.reviewId]:custom})]]);
  vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)});
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
   if(url.startsWith('/api/'))throw new Error('offline');
   if(url.endsWith('corpus_v2.json'))return new Response(JSON.stringify(corpus),{headers:{'Content-Type':'application/json'}});
   if(url.endsWith('chunks_index.json'))return new Response(readFileSync('public/data/chunks_index.json','utf8'),{headers:{'Content-Type':'application/json'}});
   throw new Error('Unexpected fetch');
  }));
  const client=await import('../src/ui/apiClient');
  const fresh=await client.getReviewSnapshot(demo.reviewId);
  expect(fresh.snapshot.review.envelope.engineVersion).toBe(review.envelope.engineVersion);
  const old=await client.getReviewSnapshot(custom.reviewId);
  expect(old.meta.warnings.join(' ')).toMatch(/archiv|historical/i);
  await expect(client.applyDesignVariant(custom.reviewId,{thicknessMm:10})).rejects.toThrow(/archiv|historical|version/i);
 });
});
