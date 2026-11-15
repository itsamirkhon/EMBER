/* EMBER presentation support gate. Additive: does not modify evidence.ts.
 * Pure UMD module. Runtime data uses the existing TestRow field names.
 * Relevance is not predictive validity. No probability is generated here.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EmberSupport=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const DIMS=['o2Pct','pressureKpa','flowCmS','gravityG'];
 const LABELS={o2Pct:'oxygen',pressureKpa:'pressure',flowCmS:'airflow',gravityG:'gravity'};
 const SCALES={o2Pct:3,pressureKpa:15,flowCmS:8,gravityG:.5};
 const text=v=>typeof v==='string'?v.trim().toLowerCase().replace(/\s+/g,' '):'';
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 const eps=1e-6;
 const EXPLICIT_OUTCOMES=new Set(['burned','flame_spread','extinguished','self_extinguished','no_ignition']);
 function validate(q){
  const errors=[];
  for(const k of DIMS){const v=q[k];if(!finite(v))errors.push(`${LABELS[k]} must be a finite scalar.`);}
  if(finite(q.o2Pct)&&(q.o2Pct<0||q.o2Pct>100))errors.push('Oxygen must be in [0,100] percent.');
  if(finite(q.pressureKpa)&&q.pressureKpa<=0)errors.push('Pressure must be positive.');
  if(finite(q.flowCmS)&&q.flowCmS<0)errors.push('Airflow cannot be negative.');
  if(finite(q.gravityG)&&q.gravityG<0)errors.push('Gravity cannot be negative.');
  if(!['solid','liquid','gas'].includes(q.fuelPhase))errors.push('Specify a supported fuel phase.');
  if(!text(q.fuel))errors.push('Specify the material or fuel.');
  if(!text(q.geometry))errors.push('Specify specimen geometry.');
  if(q.thicknessMm!=null&&(!finite(q.thicknessMm)||q.thicknessMm<=0))errors.push('Thickness must be positive.');
  if(q.diameterMm!=null&&(!finite(q.diameterMm)||q.diameterMm<=0))errors.push('Diameter must be positive.');
  return errors;
 }
 function compare(q,t){
  const reasons=[],missing=[],differences={};let sum=0;
  if(t.fuelPhase!==q.fuelPhase)reasons.push('Different or undocumented fuel phase.');
  if(text(t.fuel)!==text(q.fuel))reasons.push('Different or undocumented material.');
  if(text(t.geometry)!==text(q.geometry))reasons.push('Different or undocumented specimen geometry.');
  if(!finite(t.gravityG))missing.push('gravity');
  else if(Math.abs(t.gravityG-q.gravityG)>eps)reasons.push('Different gravity regime; no transfer model validated.');
  for(const k of DIMS){
   if(!finite(t[k])){if(!missing.includes(LABELS[k]))missing.push(LABELS[k]);sum+=4;differences[k]=null;}
   else{differences[k]=t[k]-q[k];sum+=((t[k]-q[k])/SCALES[k])**2;}
  }
  for(const k of ['thicknessMm','diameterMm']){
   if(q[k]!=null){if(!finite(t[k]))missing.push(k);else if(Math.abs(q[k]-t[k])>eps)reasons.push(`Different specimen ${k==='thicknessMm'?'thickness':'diameter'}.`);}
  }
  if(q.diluent && text(q.diluent)!==text(t.diluent))reasons.push('Different or undocumented diluent.');
  if(finite(q.diluentPct)&&(!finite(t.diluentPct)||Math.abs(q.diluentPct-t.diluentPct)>eps))reasons.push('Diluent concentration does not match.');
  const sourced=!!(t.source&&t.source.file&&Number.isInteger(t.source.row)&&t.source.row>0);
  if(!sourced)reasons.push('No row-level source locator.');
  const explicit=EXPLICIT_OUTCOMES.has(t.outcome);
  if(!explicit)reasons.push('No explicit physical outcome; completion/disruption is not a safety label.');
  const exact=reasons.length===0&&missing.length===0&&DIMS.every(k=>Math.abs(differences[k])<=eps);
  const sameContext=reasons.length===0&&missing.length===0;
  return {test:t,distance:Math.sqrt(sum),differences,reasons,missing,exact,sameContext,sourced,explicit};
 }
 function assess(q,rows){
  const errors=validate(q);
  if(errors.length)return {status:'invalid',title:'Invalid query',reasons:errors,observations:[],related:[],canPredict:false,pBurn:null};
  // Identical source rows do not become independent corroborating tests.
  const seen=new Set();const clean=[];
  for(const t of Array.isArray(rows)?rows:[]){if(!t||typeof t!=='object')continue;const key=JSON.stringify([t.inv,t.testId,t.source?.file,t.source?.row]);if(!seen.has(key)){seen.add(key);clean.push(t);}}
  const all=clean.map(t=>compare(q,t));
  const related=all.filter(x=>x.test.fuelPhase===q.fuelPhase&&text(x.test.fuel)===text(q.fuel)).sort((a,b)=>a.distance-b.distance);
  const exact=related.filter(x=>x.exact);
  if(exact.length){return {status:'observed',title:'Matching source observation',reasons:['This is a recorded outcome, not a safety certification or a validated risk probability.'],observations:exact.map(x=>x.test),related:related.slice(0,5),canPredict:false,pBurn:null};}
  const context=related.filter(x=>x.sameContext);
  if(context.length){return {status:'nearby',title:'Nearby evidence, not a measured answer',reasons:['Conditions differ from the source rows. Interpolation requires a separately validated model.'],observations:[],related:related.slice(0,5),canPredict:false,pBurn:null};}
  const gravityMatch=related.some(x=>finite(x.test.gravityG)&&Math.abs(x.test.gravityG-q.gravityG)<=eps);
  const reasons=[];
  if(!related.length)reasons.push('No source rows for the requested fuel phase and material.');
  else if(!gravityMatch)reasons.push('No matching gravity regime in the loaded source rows.');
  if(related[0]){
   if(related[0].missing.length)reasons.push('Source row does not report: '+related[0].missing.join(', ')+'.');
   reasons.push(...related[0].reasons.filter(r=>!r.startsWith('Different gravity')));
  }
  return {status:'unsupported',title:'Not established by these records',reasons:[...new Set(reasons)],observations:[],related:related.slice(0,5),canPredict:false,pBurn:null};
 }
 // Wrap the existing engine without misrepresenting its kNN vote as validated risk.
 function gateEstimate(query,engineEstimate){
  const rows=[...(engineEstimate?.measuredTests||[]),...(engineEstimate?.neighbours||[]).map(n=>n.test)];
  const support=assess(query,rows);
  return {support,originalStatus:engineEstimate?.status||null,rawEngineVote:engineEstimate?.pBurn??null,displayRisk:null,displayInterval:null,explanation:'The raw engine vote is retained for debugging only; it is not displayed as a calibrated probability.'};
 }
 return {validate,compare,assess,gateEstimate};
});
