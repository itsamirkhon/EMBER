/** Authoritative, conservative comparison of recorded observations, never a causal simulator. */
import {evaluateApplicability} from './applicability';
import {normalizeMaterialName} from './materials';
import {matchProtocolSegment} from './protocol';
import type {ComparisonFactor, ComparisonObservation, ComparisonResult, ResearchQuery, ScientificValue, SourceRef, TargetEndpoint, Test} from './types';
export const COMPARISON_VERSION = 'interpret-1.0';

const NUMERIC_ENDPOINTS: Partial<Record<TargetEndpoint, keyof Pick<Test,'spreadRateMmS'|'burningRateMm2S'|'particleSizeNm'|'smokePointLengthMm'>>> = {
  spread_rate:'spreadRateMmS', burning_rate_constant:'burningRateMm2S', smoke_particle_size:'particleSizeNm', smoke_point_length:'smokePointLengthMm',
};
const UNITS: Record<string,{unit:string;scale:number}> = {
  'mm/s':{unit:'mm/s',scale:1}, 'cm/s':{unit:'mm/s',scale:10},
  'mm^2/s':{unit:'mm2/s',scale:1}, 'mm2/s':{unit:'mm2/s',scale:1}, 'mm²/s':{unit:'mm2/s',scale:1}, 'cm2/s':{unit:'mm2/s',scale:100},
  nm:{unit:'nm',scale:1}, 'µm':{unit:'nm',scale:1000}, um:{unit:'nm',scale:1000},
  mm:{unit:'mm',scale:1}, cm:{unit:'mm',scale:10}, kPa:{unit:'kPa',scale:1}, Pa:{unit:'kPa',scale:0.001},
};
function known(v:ScientificValue):boolean {
  return v.value !== null && v.value !== 'unknown' && v.provenance !== 'unknown' && v.provenance !== 'assumed' && (typeof v.value !== 'number' || Number.isFinite(v.value));
}
function field(value:string|number|null,sourceRef:SourceRef,provenance:ScientificValue['provenance']='series_level',unit=''):ScientificValue {
  return {value,unit,provenance:value===null||value==='unknown'?'unknown':provenance,sourceRef};
}
function normalized(v:ScientificValue):ScientificValue {
  const conversion=UNITS[v.unit];
  return conversion && typeof v.value==='number' ? {...v,value:v.value*conversion.scale,unit:conversion.unit}:v;
}
function factor(name:string,a:ScientificValue,b:ScientificValue,relevant=true):ComparisonFactor {
  const aa=normalized(a),bb=normalized(b);
  const status = !relevant ? 'not_applicable' : !known(aa)||!known(bb) ? 'unknown' : aa.unit===bb.unit&&aa.value===bb.value ? 'matched':'different';
  return {factor:name,status,valueA:a,valueB:b,relevance:relevant?'essential':'context',reason:status==='unknown'?'Missing or assumed values cannot establish a match.':status==='matched'?'Same recorded value after exact unit conversion; no empirical tolerance or control of unrecorded factors is asserted.':status==='different'?'Recorded values or definitions differ; descriptive comparison only.':'Not essential for this endpoint and specimen phase.'};
}
function selectedCondition(test:Test,ids:string[],key:'flowCmS'|'o2Pct'|'pressureKpa',fallback:ScientificValue):ScientificValue {
  const values=test.segments.filter(s=>ids.includes(s.segmentId)).map(s=>s[key]);
  if(values.length===0)return fallback;
  if(!known(fallback))return {...fallback,value:null,provenance:'unknown'};
  // Multiple endpoint segments are not collapsed to an arbitrary final/initial condition.
  if(values.every(v=>known(v)&&v.unit===values[0].unit&&v.value===values[0].value))return values[0];
  return {...fallback,value:null,provenance:'unknown'};
}
function metric(test:Test,endpoint:TargetEndpoint|null):ScientificValue|null {
  const key=endpoint?NUMERIC_ENDPOINTS[endpoint]:undefined;
  return key?test[key]:null;
}
function sourceConflicts(test:Test):string[] {
  const text=JSON.stringify(test.extra)+' '+(test.outcomeRaw??'')+' '+(test.sourceRef.quote??'');
  const conflicts:string[]=[];
  if(/self.extinguish/i.test(test.terminalEvent??'') && /manual(?:ly)?.{0,35}(stop|shut|flow)/i.test(text)) conflicts.push(`${test.testId}: coded self-extinction conflicts with source comment reporting manual flow cutoff.`);
  if(/^(hot_ignition|ignited_burned)$/.test(test.initialOutcome) && /no ignition/i.test(String(test.extra.Comments??''))) conflicts.push(`${test.testId}: positive ignition code conflicts with source comment reporting no ignition.`);
  return conflicts;
}
function isAggregate(test:Test):boolean {return /not individual|aggregate|test.day/i.test(String(test.extra.granularity??''));}
function observation(query:ResearchQuery,test:Test):ComparisonObservation {
  const match=matchProtocolSegment(query,test);
  const events=test.events.filter(e=>match.matchedEventIds.includes(e.id));
  const numeric=metric(test,query.targetEndpoint);
  const eventValue=events.find(e=>known(e.observedValue))?.observedValue??null;
  const initialEndpoint=query.targetEndpoint==='flame_establishment'||query.targetEndpoint==='sustained_spread';
  let status:ComparisonObservation['status']='not_measured';
  if(!query.targetEndpoint || test.initialOutcome==='unknown'&&initialEndpoint) status='unknown';
  else if(match.endpointMatched) {
    if(initialEndpoint && /^(no_ignition|no_spread|not_ignited)$/.test(test.initialOutcome))status='negative';
    else if(numeric ? known(numeric) : events.length>0 ? events.some(e=>known(e.observedValue)) : initialEndpoint&&test.initialOutcome!=='not_applicable')status='observed';
  }
  if(sourceConflicts(test).length||isAggregate(test)) status='unknown';
  if(initialEndpoint && /non_flaming|not_applicable/.test(test.initialOutcome)) status='not_measured';
  if(query.targetEndpoint==='sustained_spread' && status==='observed' && !events.some(e=>e.endpoint==='sustained_spread') && !/spread/i.test(test.outcomeRaw??'')) status='not_measured';
  const refs=[test.sourceRef,...events.map(e=>e.sourceRef),...(numeric?.sourceRef?[numeric.sourceRef]:[])];
  return {testId:test.testId,endpoint:query.targetEndpoint,status,label:status==='unknown'?'Unknown outcome':status==='not_measured'?`No supported observation of ${query.targetEndpoint??'specified endpoint'}`:match.matchedOutcomeLabel??test.initialOutcome,value:numeric??eventValue,segmentIds:match.matchedSegmentIds,eventIds:match.matchedEventIds,sourceRefs:refs};
}
function factorsFor(query:ResearchQuery,a:Test,b:Test,oa:ComparisonObservation,ob:ComparisonObservation):ComparisonFactor[] {
  const fa=(v:string|number|null)=>field(v,a.sourceRef), fb=(v:string|number|null)=>field(v,b.sourceRef);
  const solid=a.fuelPhase==='solid'||b.fuelPhase==='solid';
  const liquid=a.fuelPhase==='liquid'||b.fuelPhase==='liquid';
  const gas=a.fuelPhase==='gas'||b.fuelPhase==='gas';
  const smoke=query.targetEndpoint==='smoke_particle_size';
  const geometry=/spread|establishment|extinction|limit/.test(query.targetEndpoint??'')||solid||liquid||gas;
  const extraValue=(test:Test,keys:string[],unit=''):ScientificValue=>{
    const key=keys.find(k=>typeof test.extra[k]==='string'||typeof test.extra[k]==='number');
    const raw=key?test.extra[key]:null;
    return field(typeof raw==='string'||typeof raw==='number'?raw:null,test.sourceRef,'reported',unit);
  };
  const instrument=(name:string,keys:string[],relevant:boolean,unit='')=>factor(name,extraValue(a,keys,unit),extraValue(b,keys,unit),relevant);
  const history=(test:Test)=>JSON.stringify({history:test.flow.history,sequence:test.flow.sequenceCmS??null,interventions:test.segments.filter(s=>s.stageType!=='preparation').map(s=>({stage:s.stageType,intervention:s.intervention,flow:s.flowCmS.value,flowUnit:s.flowCmS.unit}))});
  const protocol=(test:Test)=>test.segments.find(s=>s.stageType==='ignition')?.description??null;
  const out=[
    factor('material',fa(a.fuel?normalizeMaterialName(a.fuel):null),fb(b.fuel?normalizeMaterialName(b.fuel):null)),
    factor('fuelPhase',fa(a.fuelPhase),fb(b.fuelPhase)),
    factor('geometry',fa(a.geometry),fb(b.geometry),geometry),
    factor('thicknessMm',a.thicknessMm,b.thicknessMm,solid&&!/rod|cylinder/.test(`${a.geometry} ${b.geometry}`)),
    factor('diameterMm',a.diameterMm,b.diameterMm,liquid||/rod|cylinder|burner|jet/.test(`${a.geometry} ${b.geometry}`)),
    factor('widthCm',a.widthCm,b.widthCm,solid&&!/rod|cylinder/.test(`${a.geometry} ${b.geometry}`)),
    factor('substrateConfinement',fa(a.substrateConfinement),fb(b.substrateConfinement),solid||liquid),
    factor('orientation',fa(a.orientation),fb(b.orientation),solid),
    factor('o2Role',fa(a.atmosphere.o2.role),fb(b.atmosphere.o2.role)),
    factor('o2Pct',selectedCondition(a,oa.segmentIds,'o2Pct',a.atmosphere.o2),selectedCondition(b,ob.segmentIds,'o2Pct',b.atmosphere.o2)),
    factor('pressureKpa',selectedCondition(a,oa.segmentIds,'pressureKpa',a.atmosphere.pressure),selectedCondition(b,ob.segmentIds,'pressureKpa',b.atmosphere.pressure)),
    factor('diluent',fa(a.atmosphere.diluent),fb(b.atmosphere.diluent)),
    factor('flowCmS',selectedCondition(a,oa.segmentIds,'flowCmS',a.flow.initialFlowCmS),selectedCondition(b,ob.segmentIds,'flowCmS',b.flow.initialFlowCmS)),
    factor('flowDirection',fa(a.flow.direction),fb(b.flow.direction)),
    factor('flowHistory',fa(a.flow.history==='unknown'?null:history(a)),fb(b.flow.history==='unknown'?null:history(b))),
    factor('gravityG',a.gravity.gravityG,b.gravity.gravityG),
    factor('gravityRegime',fa(a.gravity.regime),fb(b.gravity.regime)),
    factor('gravityMode',fa(a.gravity.mode),fb(b.gravity.mode)),
    factor('gravityPlatform',fa(a.gravity.platform==='Unknown'?null:a.gravity.platform),fb(b.gravity.platform==='Unknown'?null:b.gravity.platform)),
    factor('ignitionProtocol',fa(protocol(a)),fb(protocol(b)),!/smoke/.test(query.targetEndpoint??'')),
    instrument('ignitionPower',['Ignition Power (W)'],solid),
    instrument('ignitionDuration',['Ignition Time (s)'],solid),
    instrument('fuelMassFlow',['mHC (mg/s)'],gas,'mg/s'),
    instrument('fuelComposition',['Xf'],gas),
    instrument('burnerThermalHistory',['burnerThermalHistory','initialBurnerTemperatureC'],gas),
    instrument('heaterRatio',['Rt/R0','heaterRt_R0'],smoke),
    instrument('sampleTemperature',['sampleTemperatureC'],smoke,'C'),
    instrument('heatingDuration',['Duration (sec)','smokeDurationS'],smoke,'s'),
    instrument('aerosolAgingTime',['Net aging time (sec)'],smoke,'s'),
    instrument('particleMetricDefinition',['metricDefinition'],smoke),
    factor('sampleHistory',fa(typeof a.extra.sampleHistory==='string'?a.extra.sampleHistory:null),fb(typeof b.extra.sampleHistory==='string'?b.extra.sampleHistory:null)),
  ];
  return out;
}
interface MetricBasis { definition: string; method: string; sourceRef: SourceRef }
/** Narrow source-audited mappings, not a family-wide assumption. See INTERPRET_SOURCE_REVIEW.md. */
function metricBasis(test:Test,endpoint:TargetEndpoint|null):MetricBasis|null {
  const numeric=metric(test,endpoint);
  if(!numeric||!known(numeric))return null;
  if(typeof test.extra.metricDefinition==='string' && test.extra.metricDefinition.length && typeof test.extra.measurementMethod==='string' && test.extra.measurementMethod.length) {
    return {definition:test.extra.metricDefinition,method:test.extra.measurementMethod,sourceRef:numeric.sourceRef??test.sourceRef};
  }
  if(endpoint==='smoke_particle_size' && test.inv==='SAME-R' && test.sourceRef.sourceId==='psi-101') {
    const audited:Record<string,{value:number;row:number;raw:string}>={'SAME-R-51':{value:56.4,row:6,raw:'0.0563731190105457'},'SAME-R-51a':{value:66.8,row:7,raw:'0.0668156766313406'}};
    const entry=audited[test.testId];
    if(entry&&numeric.value===entry.value&&numeric.unit==='nm')return {
      definition:'Particle arithmetic mean diameter M1/M0',method:'Analyzed aerosol moment ratio M1/M0 from SAME R Results column BI',
      sourceRef:{...test.sourceRef,fileHash:'6d3a539ccf425b1fa8edc19cc75d828f57d650c7ce734d4e7aa686fea9593218',locator:{table:'PSI-101_Analyzed Data_SAME, SAME-R_Results.xlsx / SAME R Results',row:entry.row,cell:`BI${entry.row}`,section:'BI2: M1/M0 (micro-m)--AMD'},quote:entry.raw,context:`Cell values are micrometres under BI2; converted and rounded to ${entry.value} nm in the corpus. Dependent source observations; different net aerosol aging times. No uncertainty or causal effect inferred.`},
    };
  }
  if(endpoint==='spread_rate' && test.inv==='BASS-II' && test.sourceRef.sourceId==='psi-25') {
    const audited:Record<string,{value:number;flow:number}>={'BASS-II-M1':{value:0.071,flow:9},'BASS-II-M20':{value:0.012,flow:10}};
    const entry=audited[test.testId];
    if(entry&&numeric.value===entry.value&&numeric.unit==='mm/s')return {
      definition:'PMMA steady flame spread rate from tracked flame position versus time',method:'NASA/TM-20210011385 section 5.3: Spotlight16 image/video tracking and position-time analysis',
      sourceRef:{sourceId:'ntrs-20210011385',url:'https://ntrs.nasa.gov/citations/20210011385',doi:null,corpusVersion:test.sourceRef.corpusVersion,locator:{table:'Table 5.1',section:'Report pages 56–57, section 5.3',cell:test.testId.replace('BASS-II-','')},quote:`${entry.value} mm/s at ${entry.flow} cm/s`,context:'Different thickness, exposed sides, oxygen and flow conditions; arithmetic contrast only, not a thickness effect.'},
    };
  }
  return null;
}
function deltaFor(endpoint:TargetEndpoint|null,a:ComparisonObservation,b:ComparisonObservation,allowed:boolean,basis:MetricBasis|null):ComparisonResult['numericDelta'] {
  if(!allowed||!endpoint||!NUMERIC_ENDPOINTS[endpoint]||!a.value||!b.value)return null;
  const av=normalized(a.value),bv=normalized(b.value);
  if(!known(av)||!known(bv)||typeof av.value!=='number'||typeof bv.value!=='number'||av.unit!==bv.unit)return null;
  const expected:Partial<Record<TargetEndpoint,string>>={spread_rate:'mm/s',burning_rate_constant:'mm2/s',smoke_particle_size:'nm',smoke_point_length:'mm'};
  if(av.unit!==expected[endpoint])return null;
  return {value:Number((bv.value-av.value).toPrecision(12)),unit:av.unit,definition:`B minus A of recorded ${basis?.definition??endpoint}; descriptive difference from reported values (rounded where supplied), not a treatment effect or population estimate; measurement method: ${basis?.method??'unknown'}`};
}
function display(v:ScientificValue):string {return v.value===null?'unknown':`${v.value}${v.unit?` ${v.unit}`:''} (${v.provenance})`;}
export function compareTests(query:ResearchQuery,a:Test,b:Test):ComparisonResult {
  const oa=observation(query,a),ob=observation(query,b),factors=factorsFor(query,a,b,oa,ob);
  const changed=factors.filter(f=>f.status==='different'),unknown=factors.filter(f=>f.status==='unknown');
  const available=[oa,ob].every(o=>o.status==='observed'||o.status==='negative');
  const status:ComparisonResult['observationComparability']['status']=!available?'insufficient_information':changed.length?'descriptive_only':unknown.length?'conditional':'comparable';
  const reasons=!available?['One or both requested endpoint observations are absent, unknown, assumed, or protocol-inconsistent.']:changed.length?['Recorded conditions differ; endpoint observations remain useful descriptively but differences cannot isolate a factor.']:unknown.length?['Recorded endpoint observations can be compared with explicit limitations; essential conditions remain unknown.']:['Recorded essential conditions match exactly; descriptive comparison of the endpoint is supported.'];
  const causal='Descriptive historical contrast is NOT automatic proof of causation: record similarity does not establish control of unrecorded factors, randomization, or a causal effect.';
  const limitations=[...unknown.map(f=>`Unknown or assumed ${f.factor}.`),...changed.map(f=>`Different ${f.factor}.`),...matchProtocolSegment(query,a).warnings,...matchProtocolSegment(query,b).warnings];
  if(a.testId===b.testId||a.sampleId&&a.sampleId===b.sampleId||a.groupId&&a.groupId===b.groupId||a.seriesId&&a.seriesId===b.seriesId) limitations.push('Same sample, record, or dependent series/group: rows are not established independent repetitions.');
  if([a,b].some(t=>t.gravity.mode==='simulated_analogue'))limitations.push('Simulated analogue observations are not direct actual-flight observations.');
  const basisA=metricBasis(a,query.targetEndpoint),basisB=metricBasis(b,query.targetEndpoint);
  const numericDefinitionKnown=basisA!==null && basisB!==null && basisA.definition===basisB.definition && basisA.method===basisB.method;
  // A descriptive difference may retain known environmental contrasts and unknown covariates.
  // It is not an estimate at equal conditions or a treatment effect.
  const incompatibleContext=factors.some(f=>['fuelPhase','o2Role','gravityRegime','gravityMode'].includes(f.factor)&&f.status==='different');
  const quantitativeCandidate=available&&oa.status==='observed'&&ob.status==='observed'&&numericDefinitionKnown&&!incompatibleContext;
  if(query.targetEndpoint && NUMERIC_ENDPOINTS[query.targetEndpoint] && !numericDefinitionKnown)limitations.push('Matching metric definition and measurement method are not documented; no numerical delta is calculated.');
  const fieldDataConflicts=[...sourceConflicts(a),...sourceConflicts(b)];
  limitations.push(...fieldDataConflicts);
  if(isAggregate(a)||isAggregate(b)) limitations.push('Aggregate-day records do not establish individual outcomes at every listed parameter combination.');
  const numericDelta=deltaFor(query.targetEndpoint,oa,ob,quantitativeCandidate,basisA);
  if(numericDelta)limitations.push('Numerical difference describes these reported observations only; unknown covariates and differing conditions remain, and no uncertainty or independent-repeat statistics are supplied.');
  return {
    id:`contrast-${a.testId}-vs-${b.testId}`,testAId:a.testId,testBId:b.testId,invA:a.inv,invB:b.inv,
    matchedFactors:factors.filter(f=>f.status==='matched').map(f=>`${f.factor}:${display(f.valueA)}`),
    changedFactors:changed.map(f=>({factor:f.factor,valueA:display(f.valueA),valueB:display(f.valueB)})),unknownFactors:unknown.map(f=>f.factor),
    outcomeComparison:`${a.testId}: ${oa.label} [${oa.status}] vs ${b.testId}: ${ob.label} [${ob.status}]`,causalWarning:causal,
    comparisonVersion:COMPARISON_VERSION,endpoint:query.targetEndpoint,observations:{a:oa,b:ob},factors,
    observationComparability:{status,quantitativeAllowed:numericDelta!==null,reasons},applicabilityToQuery:{a:evaluateApplicability(query,a),b:evaluateApplicability(query,b)},causalSupport:{status:'descriptive_only',reasons:[causal]},numericDelta,
    fieldDataConflicts,sourceRefs:[...oa.sourceRefs,...ob.sourceRefs,...(basisA?[basisA.sourceRef]:[]),...(basisB?[basisB.sourceRef]:[])],limitations:[...new Set(limitations)],
    prohibitedInferences:['Do not infer a causal effect or safety/certification guarantee.','Do not transfer observations directly across geometry, gas roles, gravity regimes, or unobserved joint conditions.','Operator flow cutoff is not a natural quench or blowoff limit.','Hot-flame extinction does not establish absence of subsequent cool-flame combustion.','Missing measurement or unknown outcome is not a negative observation.'],
    nextAction:!available?'Check the cited source for the missing endpoint and protocol; do not invent an observation.':unknown.length?'Verify missing conditions in the primary source before controlled quantitative or configuration-specific transfer; any displayed arithmetic remains descriptive only.':changed.length?'Use the observed descriptive difference; a controlled prospective comparison is needed to isolate a factor.':'Use the recorded endpoint comparison within its stated conditions; verify independent repeats before statistical inference.',
  };
}
