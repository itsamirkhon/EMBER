import {readFileSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import {runReviewSync} from '../src/core/reviewEngine';
import {generateSynthesis,generateDeterministicSynthesis} from '../src/core/generator';
import type {CorpusV2} from '../src/core/types';
const corpus:CorpusV2=JSON.parse(readFileSync('public/data/corpus_v2.json','utf8'));
const pkg=runReviewSync({question:'PMMA flame spread',corpus,retrievalK:2}).evidencePackage;
describe('OpenAI generation model',()=>{
 it('requests the selected GPT-6 Luna model and records that model on generated prose',async()=>{
  const prose=generateDeterministicSynthesis(pkg);
  const fetchImpl=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(prose)}}]}),{status:200}));
  const result=await generateSynthesis(pkg,{mode:'LIVE_AI',apiKey:'test-only-key',fetchImpl});
  expect(fetchImpl.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
  const request=JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
  expect(request.model).toBe('gpt-6-luna');
  expect(request.reasoning_effort).toBe('none');
  expect(result.mode).toBe('LIVE_AI');
  expect(result.modelName).toBe('gpt-6-luna');
 });
 it('keeps generation failure explicit for strict callers',async()=>{
  const fetchImpl=vi.fn<typeof fetch>(async()=>new Response('{}',{status:403}));
  await expect(generateSynthesis(pkg,{mode:'LIVE_AI',apiKey:'test-only-key',fetchImpl,strictLive:true})).rejects.toThrow('403');
 });
});
