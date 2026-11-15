import type {ComparisonResult,Contrast} from './types';
function detailed(value:Contrast):value is ComparisonResult{return 'comparisonVersion' in value && 'observationComparability' in value;}
export function comparisonReport(contrasts:Contrast[]):string[]{
 return ['## Observation Comparisons',...contrasts.flatMap(c=>{
  if(!detailed(c))return [`### ${c.testAId} / ${c.testBId}`,'Historical comparison without current structured verdict; regenerate before transfer.',c.causalWarning,''];
  return [`### ${c.testAId} / ${c.testBId} — ${c.endpoint??'endpoint unspecified'}`,
   `Comparison version: ${c.comparisonVersion}`,
   `Observation comparability: ${c.observationComparability.status}. ${c.observationComparability.reasons.join(' ')}`,
   `Applicability to query: A=${c.applicabilityToQuery.a.verdict}; B=${c.applicabilityToQuery.b.verdict}.`,
   `Causal support: ${c.causalSupport.status}. ${c.causalSupport.reasons.join(' ')}`,
   `A: ${c.observations.a.label} (${c.observations.a.status}); segments=${c.observations.a.segmentIds.join(', ')||'none'}.`,
   `B: ${c.observations.b.label} (${c.observations.b.status}); segments=${c.observations.b.segmentIds.join(', ')||'none'}.`,
   ...(c.numericDelta?[`Observed descriptive difference: ${c.numericDelta.value} ${c.numericDelta.unit}; ${c.numericDelta.definition}.`]:['Quantitative difference: not supported for this comparison.']),
   ...c.factors.map(f=>`- ${f.factor}: ${f.status}; A=${f.valueA.value??'unknown'} ${f.valueA.unit} (${f.valueA.provenance}); B=${f.valueB.value??'unknown'} ${f.valueB.unit} (${f.valueB.provenance}). ${f.reason}`),
   ...c.limitations.map(l=>`- Limitation: ${l}`),...c.prohibitedInferences.map(l=>`- Unsupported inference: ${l}`),
   ...c.sourceRefs.map(r=>`- Source: ${r.sourceId}; locator=${JSON.stringify(r.locator??{})}; ${r.url??r.doi??'local source'}; hash=${r.fileHash??'not available'}.`),
   `Next action: ${c.nextAction}`,''];
 })];
}
