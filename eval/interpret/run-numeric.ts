/** Expanded development source check; values frozen before arithmetic engine adjustment. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compareTests } from '../../src/core/comparison.ts';
import { parseResearchQuery } from '../../src/core/queryParser.ts';
import type { CorpusV2, TargetEndpoint } from '../../src/core/types.ts';
interface NumericCase { id:string;testAId:string;testBId:string;endpoint:TargetEndpoint;expectedDelta:number;unit:string;expectedComparability:string; }
const raw = readFileSync(resolve('eval/interpret/numeric-cases.json'),'utf8');
const fixture = JSON.parse(raw) as {cases:NumericCase[]};
const corpus = JSON.parse(readFileSync(resolve('public/data/corpus_v2.json'),'utf8')) as CorpusV2;
const results = fixture.cases.map(item => {
  const a = corpus.tests.find(t=>t.testId===item.testAId), b = corpus.tests.find(t=>t.testId===item.testBId);
  if(!a||!b) throw new Error(`Absent source record ${item.id}`);
  const q = {...parseResearchQuery('Compare the reported measurements'),targetEndpoint:item.endpoint};
  const forward = compareTests(q,a,b), reverse = compareTests(q,b,a);
  const delta=forward.numericDelta, reverseDelta=reverse.numericDelta;
  const passed=!!delta&&!!reverseDelta&&Math.abs(delta.value-item.expectedDelta)<1e-9&&Math.abs(delta.value+reverseDelta.value)<1e-9&&delta.unit===item.unit&&forward.observationComparability.status===item.expectedComparability&&forward.causalSupport.status==='descriptive_only';
  return {caseId:item.id,passed,expectedDelta:item.expectedDelta,expectedUnit:item.unit,actualDelta:delta,comparison:forward,reverseDelta};
});
const report={schemaVersion:'interpret-numeric-development-v1',fixtureSha256:createHash('sha256').update(raw).digest('hex'),independentValidation:false,heldout:false,corpusVersion:corpus.corpusVersion,cases:results.length,passed:results.filter(r=>r.passed).length,results};
writeFileSync(resolve('eval/interpret/numeric-report.json'),`${JSON.stringify(report,null,2)}\n`);
console.log(JSON.stringify({cases:report.cases,passed:report.passed,independentValidation:false}));
if(report.passed!==report.cases)process.exitCode=1;
