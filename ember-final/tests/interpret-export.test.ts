import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {runReviewSync,exportReviewMarkdown,exportReviewJson,compareTests} from '../src/core';
import type {CorpusV2} from '../src/core';
const corpus:CorpusV2=JSON.parse(readFileSync('public/data/corpus_v2.json','utf8'));
describe('reproducible Interpret review export',()=>{
 it('preserves comparison decisions, source locators and limits in a readable report and JSON',()=>{
  const review=runReviewSync({question:'PMMA thin film quench in microgravity',corpus});
  const a=corpus.tests.find(t=>t.testId==='BASS-II-B1')!,b=corpus.tests.find(t=>t.testId==='BASS-II-B9')!;
  const comparison=compareTests(review.query,a,b);
  review.evidencePackage.contrasts=[comparison];
  const md=exportReviewMarkdown(review);
  expect(md).toContain('Observation Comparisons');
  expect(md).toContain(comparison.observationComparability.status);
  expect(md).toContain(comparison.causalSupport.status);
  expect(md).toContain(comparison.prohibitedInferences[0]);
  expect(md).toContain(comparison.sourceRefs[0].sourceId);
  expect(md).toContain(review.envelope.engineVersion);
  const json=JSON.parse(exportReviewJson(review));
  expect(json.evidencePackage.contrasts[0]).toEqual(comparison);
 });
});
