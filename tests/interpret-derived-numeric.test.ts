import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {compareTests,evaluateApplicability,parseResearchQuery,verifySynthesis,type CorpusV2,type EvidencePackage,type GeneratedSynthesis,type SynthesisClaimItem,type TargetEndpoint} from '../src/core';
const corpus=JSON.parse(readFileSync('public/data/corpus_v2.json','utf8')) as CorpusV2;
function evidence(ids:string[],endpoint:TargetEndpoint):EvidencePackage {
 const query=parseResearchQuery('descriptive numeric comparison',{targetEndpoint:endpoint});
 const tests=ids.map(id=>corpus.tests.find(t=>t.testId===id)!);
 return {query,evaluatedTests:tests,retrievedHits:[],jevDecisions:[],evidenceChunks:[],contextChunks:[],conflictChunks:[],rankings:[],applicabilityDecisions:tests.map(t=>evaluateApplicability(query,t)),contrasts:[compareTests(query,tests[0],tests[1])],gaps:[]};
}
function synthesis(item:SynthesisClaimItem,section:'engineeringImplication'|'observedFact'|'authorInterpretation'='engineeringImplication'):GeneratedSynthesis {
 return {mode:'DETERMINISTIC_ENGINE',answerBoundary:'conditional_or_partial',observedFact:[],authorInterpretation:[],engineeringImplication:[],applicabilityConditions:[],openQuestions:[],conflictsPreserved:[],rawSummary:'Descriptive arithmetic only.',[section]:[item]};
}
const smoke=evidence(['SAME-R-51','SAME-R-51a'],'smoke_particle_size');
const rate=evidence(['BASS-II-M1','BASS-II-M20'],'spread_rate');
const claim=(text='Calculated B minus A arithmetic mean diameter difference is 10.4 nm; this is descriptive only.',citations=['SAME-R-51','SAME-R-51a']):SynthesisClaimItem=>({id:'delta',text,citations,provenance:'derived'});
describe('verifier scope for structured derived numeric differences',()=>{
 it('accepts a calculated engineering delta supported by both compared records',()=>{expect(verifySynthesis(synthesis(claim()),smoke).numericUnitCheck).toEqual({passed:true,issues:[]});});
 it('accepts the negative PMMA rate difference with correct sign and unit',()=>{const item=claim('Calculated B minus A spread-rate difference is -0.059 mm/s; this is descriptive only.',['BASS-II-M1','BASS-II-M20']);expect(verifySynthesis(synthesis(item),rate).passed).toBe(true);});
 it.each(['Calculated difference is 10.45 nm.','Calculated difference is -10.4 nm.','Calculated difference is 10.4 mm.','Calculated difference is 56.4 nm.'] )('rejects incorrect delta value, sign, unit, or a borrowed operand: %s',text=>{expect(verifySynthesis(synthesis(claim(text)),smoke).numericUnitCheck.passed).toBe(false);});
 it('rejects a calculated delta citing only one compared record',()=>{expect(verifySynthesis(synthesis(claim(undefined,['SAME-R-51'])),smoke).numericUnitCheck.passed).toBe(false);});
 it('does not introduce a computed delta as a reported observed fact',()=>{expect(verifySynthesis(synthesis({...claim(),provenance:'reported'},'observedFact'),smoke).numericUnitCheck.passed).toBe(false);});
 it('does not attribute an EMBER-calculated delta to the source author',()=>{expect(verifySynthesis(synthesis(claim(),'authorInterpretation'),smoke).numericUnitCheck.passed).toBe(false);});
 it('does not accept a derived delta with reported provenance',()=>{expect(verifySynthesis(synthesis({...claim(),provenance:'reported'}),smoke).numericUnitCheck.passed).toBe(false);});
 it('does not let an observed fact borrow a derived allowance through a duplicate claim ID',()=>{const value=synthesis(claim());value.observedFact=[{...claim()}];expect(verifySynthesis(value,smoke).numericUnitCheck.passed).toBe(false);});
 it('does not accept a calculated delta when structured comparisons are absent',()=>{expect(verifySynthesis(synthesis(claim()),{...smoke,contrasts:[]}).numericUnitCheck.passed).toBe(false);});
});
