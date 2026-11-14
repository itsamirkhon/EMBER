import {readFileSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import {runReviewSync} from '../src/core/reviewEngine';
import {generateSynthesis,generateDeterministicSynthesis} from '../src/core/generator';
import type {CorpusV2,GeneratedSynthesis} from '../src/core/types';
const corpus:CorpusV2=JSON.parse(readFileSync('public/data/corpus_v2.json','utf8'));
const pkg=runReviewSync({question:'PMMA thin film flame spread in microgravity',corpus,retrievalK:4}).evidencePackage;
function transport(prose:unknown){return vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(prose)}}]}),{status:200}));}
function live(prose:unknown,strictLive=true){return generateSynthesis(pkg,{apiKey:'test-only',mode:'LIVE_AI',strictLive,fetchImpl:transport(prose)});}
describe('Interpret generation boundary',()=>{
 it('passes structured comparisons, applicability and segment/source traces to the model',async()=>{
  const fetchImpl=transport(generateDeterministicSynthesis(pkg));
  await generateSynthesis(pkg,{apiKey:'test-only',mode:'LIVE_AI',fetchImpl});
  const request=JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
  const context=JSON.parse(request.messages[1].content);
  expect(context.comparisons).toEqual(pkg.contrasts);
  expect(context.sourceBoundDraft).toEqual({observedFact:generateDeterministicSynthesis(pkg).observedFact,engineeringImplication:generateDeterministicSynthesis(pkg).engineeringImplication});
  expect(context.applicabilityDecisions.length).toBeGreaterThan(0);
  expect(context.experimentalRecords.some((t:{segments:unknown[],sourceRef:unknown})=>t.segments.length>0&&t.sourceRef)).toBe(true);
 });
 it('rejects a malformed claim instead of exposing it as LIVE_AI',async()=>{
  const prose=generateDeterministicSynthesis(pkg);prose.observedFact=[{id:'bad',text:'Invented result',citations:'not-an-array',provenance:'reported'} as unknown as GeneratedSynthesis['observedFact'][number]];
  await expect(live(prose)).rejects.toThrow(/synthesis|claim|citation/i);
 });
 it('rejects unknown provenance labels',async()=>{
  const prose=generateDeterministicSynthesis(pkg);prose.observedFact[0].provenance='observed' as never;
  await expect(live(prose)).rejects.toThrow(/provenance/i);
 });
 it('rejects model claims with an invented citation even if the JSON is shaped correctly',async()=>{
  const prose=generateDeterministicSynthesis(pkg);prose.observedFact[0].citations=['nonexistent-source'];
  await expect(live(prose)).rejects.toThrow(/citation/i);
 });
 it('does not show unsupported universal safety prose as a successful live review',async()=>{
  const prose=generateDeterministicSynthesis(pkg);prose.observedFact[0].text+=' This configuration is guaranteed safe for crewed spacecraft.';
  const result=await live(prose,false);
  expect(result.mode).toBe('DETERMINISTIC_ENGINE');
 });
 it('derives the summary from checked claims instead of exposing unchecked model assertions',async()=>{
  const prose=generateDeterministicSynthesis(pkg);
  prose.rawSummary='These experiments prove oxygen alone caused ignition at 99999 kPa.';
  const result=await live(prose);
  expect(result.rawSummary).not.toContain('99999');
  expect(result.rawSummary).toContain(result.observedFact[0].text);
 });
 it('constructs its summary even when the model omits the unused summary field',async()=>{
  const prose=generateDeterministicSynthesis(pkg);
  const {rawSummary:unused,...withoutSummary}=prose;void unused;
  const result=await live(withoutSummary);
  expect(result.rawSummary).toContain(result.observedFact[0].text);
 });
 it('rejects causal assertions that override descriptive-only comparisons',async()=>{
  const prose=generateDeterministicSynthesis(pkg),fact=prose.observedFact[0];
  prose.engineeringImplication=[{id:'causal-bad',text:`Increasing oxygen alone caused the observed ignition [${fact.citations[0]}].`,citations:fact.citations,provenance:'interpretation'}];
  await expect(live(prose)).rejects.toThrow(/causal/i);
 });
 it('requires engineering deductions to remain interpretations, not reported observations',async()=>{
  const prose=generateDeterministicSynthesis(pkg);prose.engineeringImplication[0].provenance='reported';
  await expect(live(prose)).rejects.toThrow(/provenance/i);
 });

});
