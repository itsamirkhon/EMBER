/** Refresh citation metadata only after proving the scientific corpus payload is unchanged.
 * node --import tsx scripts/refresh-ask-provenance.mts /path/to/previous-corpus.json
 * Keeps the original generation date/model/checks; makes no model or validation calls.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { CorpusV2 } from '../src/core/types';
const previousPath = process.argv[2];
if (!previousPath) throw new Error('Previous corpus path required');
const before = JSON.parse(readFileSync(previousPath, 'utf8')) as CorpusV2;
const current = JSON.parse(readFileSync('public/data/corpus_v2.json', 'utf8')) as CorpusV2;
const metadata = new Set(['sourceRef', 'observationSourceRef', 'corpusVersion', 'generatedAt', 'originalValue', 'originalUnit']);
function scientificPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scientificPayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !metadata.has(key)).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => [key, scientificPayload(entry)]));
}
if (JSON.stringify(scientificPayload(before)) !== JSON.stringify(scientificPayload(current))) {
  throw new Error('Scientific payload changed: regenerate answers instead of refreshing provenance');
}
const file = JSON.parse(readFileSync('public/data/ask_answers.json', 'utf8'));
if (file.corpusVersion !== before.corpusVersion) throw new Error('Answers do not match the supplied previous corpus');
const byId = new Map(current.tests.map((test) => [test.testId, test]));
for (const answer of file.answers) {
  for (const citation of answer.citations) {
    if (citation.kind !== 'test') continue;
    const test = byId.get(citation.id.replace(/^chk-test-/, ''));
    if (!test) throw new Error('Missing test citation: ' + citation.id);
    if (test.observationSourceRef) citation.conditionSources = {
      oxygen: test.atmosphere.o2.sourceRef, pressure: test.atmosphere.pressure.sourceRef, observations: test.observationSourceRef,
    };
  }
}
file.corpusVersion = current.corpusVersion;
file.provenanceRefresh = { previousCorpusVersion: before.corpusVersion, refreshedAt: new Date().toISOString(),
  scope: 'Citation metadata only; scientific payload compared unchanged. Original generated prose, date and checks retained, not revalidated.' };
writeFileSync('public/data/ask_answers.json', JSON.stringify(file, null, 1) + '\n');
console.log('Ask citation metadata refreshed; unchanged scientific payload verified.');
