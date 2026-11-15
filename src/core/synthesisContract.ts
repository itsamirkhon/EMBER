import {classifySynthesisEvidence} from './synthesisEvidence';
/** Parse external prose once. Structural validation is not scientific entailment. */
import type {EvidencePackage,GeneratedSynthesis,SynthesisClaimItem} from './types';
const provenance=new Set(['reported','series_level','derived','assumed','unknown','planned','interpretation']);
function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid synthesis object');
 return value as Record<string,unknown>;
}
function strings(value:unknown,label:string):string[]{
 if(!Array.isArray(value)||value.some(x=>typeof x!=='string'))throw new Error(`Invalid synthesis ${label}`);
 return value;
}
export function buildSynthesisContext(pkg:EvidencePackage,det?:GeneratedSynthesis){
 const selected=new Set(pkg.retrievedHits.map(h=>h.chunk.testId).filter((id):id is string=>!!id));
 for(const contrast of pkg.contrasts){selected.add(contrast.testAId);selected.add(contrast.testBId);}
 for(const d of pkg.applicabilityDecisions.slice(0,8))selected.add(d.testId);
 for(const claim of [...(det?.observedFact??[]),...(det?.authorInterpretation??[]),...(det?.engineeringImplication??[])]){
  for(const id of claim.citations)selected.add(id);
 }
 const experimentalRecords=(pkg.evaluatedTests??[]).filter(t=>selected.has(t.testId));
 const evidence=pkg.retrievedHits.map(h=>({...h.chunk}));
 const allowedCitationIds=[...new Set([...evidence.flatMap(c=>[c.chunkId,...(c.testId?[c.testId]:[]),...(c.inv?[c.inv,`card:${c.inv}`]:[])]),...experimentalRecords.map(t=>t.testId),...pkg.conflictChunks.map(c=>c.chunkId),...pkg.rankings.flatMap(r=>[r.inv.id,`card:${r.inv.id}`])])];
 return {question:pkg.query.rawQuestion,query:pkg.query,investigations:pkg.rankings.map(r=>r.inv),comparisons:pkg.contrasts,applicabilityDecisions:pkg.applicabilityDecisions.filter(d=>selected.has(d.testId)),experimentalRecords,evidence,allowedCitationIds};
}
export function parseSynthesisClaims(value:unknown,allowedIds:string[],usedIds:Set<string>,kind:string):SynthesisClaimItem[]{
 if(!Array.isArray(value))throw new Error(`Invalid synthesis ${kind} claims`);
 const allowed=new Set(allowedIds);
 return value.map(raw=>{
  const item=object(raw);
  if(typeof item.id!=='string'||!item.id.trim()||usedIds.has(item.id)||typeof item.text!=='string'||!item.text.trim())throw new Error('Invalid synthesis claim ID/text');
  usedIds.add(item.id);
  const citations=strings(item.citations,'citations');
  if(!citations.length||citations.some(id=>!allowed.has(id)))throw new Error('Invalid synthesis citation');
  if(typeof item.provenance!=='string'||!provenance.has(item.provenance))throw new Error('Invalid synthesis provenance');
  if(kind==='engineeringImplication'&&!['interpretation','derived'].includes(item.provenance))throw new Error('Invalid engineering synthesis provenance');
  if(kind==='observedFact'&&['planned','interpretation'].includes(item.provenance))throw new Error('Invalid observed synthesis provenance');
  return {id:item.id,text:item.text,citations:[...new Set(citations)],provenance:item.provenance as SynthesisClaimItem['provenance']};
 });
}
export function parseSynthesis(value:unknown,allowedIds:string[],det:GeneratedSynthesis):GeneratedSynthesis{
 const data=object(value),seen=new Set<string>();
 const observedFact=parseSynthesisClaims(data.observedFact,allowedIds,seen,'observedFact');
 const authorInterpretation=parseSynthesisClaims(data.authorInterpretation,allowedIds,seen,'authorInterpretation');
 const engineeringImplication=parseSynthesisClaims(data.engineeringImplication,allowedIds,seen,'engineeringImplication');
 if(det.observedFact.length&&!observedFact.length)throw new Error('Invalid synthesis: supported observations omitted');
 return {...det,mode:'LIVE_AI',observedFact,authorInterpretation,engineeringImplication,
  applicabilityConditions:[...new Set([...det.applicabilityConditions,...strings(data.applicabilityConditions,'applicabilityConditions')])],
  openQuestions:[...new Set([...det.openQuestions,...strings(data.openQuestions,'openQuestions')])],
  rawSummary:[...observedFact,...engineeringImplication].map(claim=>claim.text).join(' ')||det.rawSummary};
}

export function validateAuthorAttribution(synthesis:GeneratedSynthesis,pkg:EvidencePackage):void{
 for(const claim of synthesis.authorInterpretation){
  const source=pkg.retrievedHits.filter(h=>claim.citations.includes(h.chunk.chunkId));
  if(!source.length||source.some(h=>!classifySynthesisEvidence(h.chunk).authorStatus)) {
   throw new Error('Invalid synthesis author attribution: cited evidence is not a source interpretation or planned context');
  }
  if(source.some(h=>['planned','planned_only','hypothesis'].includes(h.chunk.epistemicStatus))&&claim.provenance!=='planned')throw new Error('Invalid planned context provenance');
 }
}

/** Explicit positive causal assertions cannot override a descriptive record comparison. This is a rejection guard, not semantic proof. */
export function enforceDescriptiveBoundary(synthesis:GeneratedSynthesis):void{
 const pattern=/\b(?:caus(?:ed|es|al effect)|prove[sd]?|solely due to|because of)\b/ig;
 for(const claim of [...synthesis.observedFact,...synthesis.authorInterpretation,...synthesis.engineeringImplication]){
  for(const clause of claim.text.split(/[.!?;](?:\s+|$)|\bbut\b|\bhowever\b/i)){
   for(const match of clause.matchAll(pattern)){
    const before=clause.slice(0,match.index).slice(-110);
    if(!/\b(?:not|no|cannot|insufficient|without|doesn't|don't|requires?|would need|to establish)\b/i.test(before))throw new Error('Unsupported causal assertion in descriptive-only synthesis');
   }
  }
 }
}
