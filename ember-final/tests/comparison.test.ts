import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {compareTests,parseResearchQuery,type CorpusV2,type Test,type TargetEndpoint} from '../src/core/index';
const corpus=JSON.parse(readFileSync('public/data/corpus_v2.json','utf8')) as CorpusV2;
const record=(id:string):Test=>structuredClone(corpus.tests.find(t=>t.testId===id)!);
const query=(ep:TargetEndpoint)=>parseResearchQuery('historical comparison',{targetEndpoint:ep});
function pair(){const a=record('BASS-II-B9');const b=structuredClone(a);b.testId='other';b.sourceRef={...a.sourceRef};b.segments=b.segments.map(s=>({...s,testId:b.testId}));b.events=b.events.map(e=>({...e,id:`b-${e.id}`,testId:b.testId}));return {a,b};}
describe('endpoint-specific scientific comparisons',()=>{
 it('keeps unknown factors out of matched factors',()=>{const {a,b}=pair();a.orientation=b.orientation=null;const r=compareTests(query('quench_limit'),a,b);expect(r.factors.find(f=>f.factor==='orientation')?.status).toBe('unknown');expect(r.matchedFactors.join(' ')).not.toMatch(/orientation/);});
 it('retains useful positive historical observations without causal proof',()=>{const {a,b}=pair();const r=compareTests(query('quench_limit'),a,b);expect(r.observations.a.status).toBe('observed');expect(r.observationComparability.status).not.toBe('insufficient_information');expect(r.causalSupport.status).toBe('descriptive_only');expect(r.sourceRefs.length).toBeGreaterThan(0);expect(r.observations.a.eventIds.length).toBeGreaterThan(0);});
 it('does not turn operator cutoff into physical quench',()=>{const r=compareTests(query('quench_limit'),record('BASS-II-B1'),record('BASS-II-B9'));expect(r.observationComparability.status).toBe('insufficient_information');expect(r.observations.a.status).toBe('not_measured');expect(r.numericDelta).toBeNull();});
 it('preserves hot extinction and subsequent cool continuation separately',()=>{const a=record('CFI-1206');const hot=compareTests(query('hot_flame_extinction'),a,a);const cool=compareTests(query('cool_flame_continuation'),a,a);expect(hot.observations.a.label).toMatch(/hot/);expect(cool.observations.a.label).toMatch(/cool/);expect(hot.prohibitedInferences.join(' ')).toMatch(/cool/i);});
 it('distinguishes negative no-ignition from unknown',()=>{const {a,b}=pair();a.initialOutcome='no_ignition';a.events=[];b.initialOutcome='unknown';b.events=[];const r=compareTests(query('flame_establishment'),a,b);expect(r.observations.a.status).toBe('negative');expect(r.observations.b.status).toBe('unknown');});
 it('separates different oxygen roles despite equal numbers',()=>{const {a,b}=pair();b.atmosphere.o2.role='oxidizer_stream';const r=compareTests(query('quench_limit'),a,b);expect(r.factors.find(f=>f.factor==='o2Role')?.status).toBe('different');expect(r.observationComparability.status).toBe('descriptive_only');expect(r.numericDelta).toBeNull();});
 it('compares geometry and gravity separately from applicability to query',()=>{const {a,b}=pair();b.geometry='rod';b.gravity.mode='simulated_analogue';const r=compareTests(query('quench_limit'),a,b);expect(r.factors.find(f=>f.factor==='geometry')?.status).toBe('different');expect(r.factors.find(f=>f.factor==='gravityMode')?.status).toBe('different');expect(r.applicabilityToQuery.a.testId).toBe(a.testId);expect(r.applicabilityToQuery.b.testId).toBe(b.testId);expect(r.observationComparability.status).toBe('descriptive_only');});
 it('never treats assumed values as measured matches',()=>{const {a,b}=pair();a.atmosphere.pressure.provenance=b.atmosphere.pressure.provenance='assumed';const r=compareTests(query('quench_limit'),a,b);expect(r.factors.find(f=>f.factor==='pressureKpa')?.status).toBe('unknown');});
 it('is symmetric in verdict and factors when observations are swapped',()=>{const a=record('BASS-II-B9'),b=record('BASS-II-B1');const ab=compareTests(query('quench_limit'),a,b),ba=compareTests(query('quench_limit'),b,a);expect(ab.observationComparability.status).toBe(ba.observationComparability.status);expect(ab.factors.map(f=>[f.factor,f.status])).toEqual(ba.factors.map(f=>[f.factor,f.status]));});
 it('does not call identical source/sample rows independent repetitions',()=>{const {a,b}=pair();const r=compareTests(query('quench_limit'),a,b);expect(r.limitations.join(' ')).toMatch(/dependen|same sample/i);});
});
function measuredPair(){
 const {a,b}=pair();
 for(const t of [a,b]){
  t.extra.sampleHistory='fresh unused specimen';t.extra.metricDefinition='leading-edge spread speed';t.extra.measurementMethod='video leading-edge regression';
  t.spreadRateMmS={value:1,unit:'mm/s',provenance:'reported',sourceRef:t.sourceRef};
 }
 return {a,b};
}
describe('numeric scope and field-data conflicts',()=>{
 it('computes an exactly unit-converted descriptive delta with documented definitions and context',()=>{const {a,b}=measuredPair();b.spreadRateMmS.value=0.2;b.spreadRateMmS.unit='cm/s';const r=compareTests(query('spread_rate'),a,b);expect(r.numericDelta?.value).toBe(1);expect(r.numericDelta?.unit).toBe('mm/s');expect(compareTests(query('spread_rate'),b,a).numericDelta?.value).toBe(-1);});
 it('does not calculate across different definitions',()=>{const {a,b}=measuredPair();b.extra.metricDefinition='centroid speed';expect(compareTests(query('spread_rate'),a,b).numericDelta).toBeNull();});
 it('does not calculate with an unknown definition or measurement method',()=>{const {a,b}=measuredPair();delete a.extra.measurementMethod;expect(compareTests(query('spread_rate'),a,b).numericDelta).toBeNull();});
 it('does not calculate with incompatible units',()=>{const {a,b}=measuredPair();b.spreadRateMmS.unit='mm2/s';expect(compareTests(query('spread_rate'),a,b).numericDelta).toBeNull();});
 it('does not compare aggregate-day outcomes as individual parameter observations',()=>{const r=compareTests(query('flame_establishment'),record('BRE-2019-Feb-8-21'),record('BRE-2019-Feb-8-26.5'));expect(r.observationComparability.status).toBe('insufficient_information');expect(r.limitations.join(' ')).toMatch(/aggregate/i);});
 it('exposes contradictory SE coding and manual cutoff source comments',()=>{const a=record('CFI-G-N-21102A1-D2');const r=compareTests(query('hot_flame_extinction'),a,a);expect(r.fieldDataConflicts.join(' ')).toMatch(/manual|cutoff/i);expect(r.observations.a.status).toBe('unknown');});
 it('does not claim an assumed endpoint was measured',()=>{const {a,b}=measuredPair();a.spreadRateMmS.provenance='assumed';expect(compareTests(query('spread_rate'),a,b).observations.a.status).toBe('not_measured');});
});
describe('endpoint semantics and essential instrument history',()=>{
 it('does not interpret heated nonflaming smoke as ignition or sustained spread',()=>{for(const ep of ['flame_establishment','sustained_spread'] as const){const a=record('SAME-R-51');expect(compareTests(query(ep),a,a).observations.a.status).toBe('not_measured');}});
 it('does not infer sustained spread from ignition alone',()=>{const {a,b}=pair();a.initialOutcome='hot_ignition';a.events=a.events.filter(e=>e.endpoint!=='sustained_spread');a.outcomeRaw='hot ignition only';expect(compareTests(query('sustained_spread'),a,b).observations.a.status).toBe('not_measured');});
 it('tracks smoke aging time rather than treating ages as matched',()=>{const r=compareTests(query('smoke_particle_size'),record('SAME-R-51'),record('SAME-R-51a'));expect(r.factors.find(f=>f.factor==='aerosolAgingTime')?.status).toBe('different');expect(r.observationComparability.status).toBe('descriptive_only');});
 it('includes burner composition and mass flow for gas experiments',()=>{const a=record('CFI-G-N-21088A1-D1'),b=record('CFI-G-N-21088B1-D1');const r=compareTests(query('flame_establishment'),a,b);expect(r.factors.some(f=>f.factor==='fuelMassFlow'&&f.relevance==='essential')).toBe(true);expect(r.factors.some(f=>f.factor==='fuelComposition'&&f.relevance==='essential')).toBe(true);});
});
describe('source-audited numerical comparison',()=>{
 it('reports the rounded SAME-R arithmetic mean diameter contrast under different aging, not a causal effect',()=>{const a=record('SAME-R-51'),b=record('SAME-R-51a');const r=compareTests(query('smoke_particle_size'),a,b);expect(r.numericDelta?.value).toBe(10.4);expect(r.numericDelta?.unit).toBe('nm');expect(r.numericDelta?.definition).toMatch(/arithmetic mean|M1\/M0/);expect(r.sourceRefs.some(s=>s.locator?.cell==='BI6')).toBe(true);expect(r.sourceRefs.some(s=>s.locator?.cell==='BI7')).toBe(true);expect(r.observationComparability.status).toBe('descriptive_only');expect(r.causalSupport.status).toBe('descriptive_only');expect(compareTests(query('smoke_particle_size'),b,a).numericDelta?.value).toBe(-10.4);});
 it('does not apply the audited registry to mutated values or another metric definition',()=>{const a=record('SAME-R-51'),b=record('SAME-R-51a');b.particleSizeNm.value=115.5;expect(compareTests(query('smoke_particle_size'),a,b).numericDelta).toBeNull();});
});
describe('source-audited PMMA rate arithmetic',()=>{
 it('computes the Table 5.1 M1/M20 descriptive contrast despite different conditions',()=>{const a=record('BASS-II-M1'),b=record('BASS-II-M20');const r=compareTests(query('spread_rate'),a,b);expect(r.numericDelta?.value).toBe(-0.059);expect(r.numericDelta?.unit).toBe('mm/s');expect(r.observationComparability.status).toBe('descriptive_only');expect(r.sourceRefs.some(s=>s.locator?.table==='Table 5.1'&&s.locator.cell==='M1')).toBe(true);expect(r.changedFactors.some(f=>f.factor==='thicknessMm')).toBe(true);expect(r.causalSupport.status).toBe('descriptive_only');});
});
