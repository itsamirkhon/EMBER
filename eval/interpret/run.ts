/** Source-audited DEVELOPMENT regression, not independent scientific validation.
 * Run: npx tsx eval/interpret/run.ts [output.json]. No credentials/network used. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compareTests } from '../../src/core/comparison.ts';
import { parseResearchQuery } from '../../src/core/queryParser.ts';
import type { CorpusV2, TargetEndpoint } from '../../src/core/types.ts';

type Verdict = 'comparable' | 'conditional' | 'descriptive_only' | 'insufficient_information';
interface Case { id: string; kind: string; testAId: string; testBId: string; endpoint: TargetEndpoint; expectedComparability: Verdict; usefulSupportedComparison: boolean; expectedCausalSupport: string; rationale: string; historyGroup: string; }
const root = process.cwd();
const rawCases = readFileSync(resolve(root, 'eval/interpret/cases.json'), 'utf8');
const fixture = JSON.parse(rawCases) as { cases: Case[]; evaluationKind: string; splitPolicy: string; };
const corpus = JSON.parse(readFileSync(resolve(root, 'public/data/corpus_v2.json'), 'utf8')) as CorpusV2;
const tests = new Map(corpus.tests.map(test => [test.testId, test]));
const labels: Verdict[] = ['comparable', 'conditional', 'descriptive_only', 'insufficient_information'];
const confusion = Object.fromEntries(labels.map(label => [label, Object.fromEntries(labels.map(other => [other, 0]))])) as Record<Verdict, Record<Verdict, number>>;
const results = fixture.cases.map(item => {
  const a = tests.get(item.testAId), b = tests.get(item.testBId);
  if (!a || !b) throw new Error(`Fixture references absent record: ${item.id}`);
  const query = { ...parseResearchQuery(`Compare observed ${item.endpoint}`), targetEndpoint: item.endpoint };
  const comparison = compareTests(query, a, b);
  const reversed = compareTests(query, b, a);
  const actual = comparison.observationComparability.status;
  confusion[item.expectedComparability][actual] += 1;
  const criticalErrors: string[] = [];
  if (comparison.causalSupport.status !== item.expectedCausalSupport) criticalErrors.push('unsupported_causal_support');
  if (item.expectedComparability === 'insufficient_information' && actual !== 'insufficient_information') criticalErrors.push(item.kind === 'source_conflict' ? 'source_conflict_silently_resolved' : item.kind === 'aggregate_audit' ? 'aggregate_invented_individual_observation' : 'comparison_of_absent_endpoint');
  if (reversed.observationComparability.status !== actual) criticalErrors.push('order_changes_scientific_verdict');
  if (comparison.numericDelta && reversed.numericDelta && Math.abs(comparison.numericDelta.value + reversed.numericDelta.value) > 1e-9) criticalErrors.push('numeric_reversal_inconsistent');
  return { caseId: item.id, kind: item.kind, historyGroup: item.historyGroup, expected: item.expectedComparability, actual, passed: actual === item.expectedComparability && criticalErrors.length === 0, usefulExpected: item.usefulSupportedComparison, usefulReturned: item.usefulSupportedComparison && actual !== 'insufficient_information', criticalErrors, expectedReason: item.rationale, comparison };
});
const f1 = labels.map(label => {
  const tp = confusion[label][label];
  const fp = labels.reduce((sum, other) => sum + (other !== label ? confusion[other][label] : 0), 0);
  const fn = labels.reduce((sum, other) => sum + (other !== label ? confusion[label][other] : 0), 0);
  return { label, support: labels.reduce((sum, predicted) => sum + confusion[label][predicted], 0), f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : null };
});
const supportedF1 = f1.filter(item => item.support > 0 && item.f1 !== null);
const useful = results.filter(item => item.usefulExpected);
const report = {
  schemaVersion: 'interpret-regression-v1', evaluationKind: fixture.evaluationKind,
  corpusVersion: corpus.corpusVersion, fixtureSha256: createHash('sha256').update(rawCases).digest('hex'),
  splitPolicy: fixture.splitPolicy, independentReviewer: false, heldoutEvaluation: false,
  cases: results.length, sourceHistoryGroups: new Set(results.map(item => item.historyGroup)).size,
  sourceHistoryGroupNote: 'Conservative source-family groups, not a count of independent experiments. Overlapping investigation pairs are dependent.',
  accuracy: results.filter(item => item.passed).length / results.length,
  macroF1PresentClasses: supportedF1.reduce((sum, item) => sum + (item.f1 ?? 0), 0) / supportedF1.length,
  classMetrics: f1, confusionMatrix: confusion,
  usefulComparisonRecall: { numerator: useful.filter(item => item.usefulReturned).length, denominator: useful.length, value: useful.length ? useful.filter(item => item.usefulReturned).length / useful.length : null },
  criticalErrors: results.flatMap(item => item.criticalErrors.map(error => ({ caseId: item.caseId, error }))),
  acceptedAsIndependentScientificValidation: false,
  uncoveredGates: ['External domain review', 'Independent closed test groups', 'Same-generator baseline and ablation experiment', 'Scientific explanation correctness of live LLM across supported endpoints'],
  results,
};
const output = resolve(root, process.argv[2] ?? 'eval/interpret/report.json');
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output, cases: report.cases, accuracy: report.accuracy, macroF1: report.macroF1PresentClasses, usefulComparisonRecall: report.usefulComparisonRecall, criticalErrors: report.criticalErrors.length, independentlyValidated: false }, null, 2));
if (report.criticalErrors.length || report.accuracy < 0.9 || (report.usefulComparisonRecall.value ?? 0) < 0.9) process.exitCode = 1;
