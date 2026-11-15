import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { CorpusV2 } from '../src/core/types';
const corpus = JSON.parse(readFileSync('public/data/corpus_v2.json', 'utf8')) as CorpusV2;
const workbook = 'PSI-26_Science Documents_As Run_Test Matrix.xlsx';
it('separates BASS-50-69 identity from atmospheric and observational sources', () => {
  const test = corpus.tests.find((t) => t.testId === 'BASS-50-69')!;
  expect(test.sourceRef.locator).toMatchObject({ table: 'PSI-26_Experimental table_BASS.csv', row: 52 });
  expect(test.sourceRef.quote).toBeNull();
  const hash = createHash('sha256').update(readFileSync('data/raw/PSI-26/' + workbook)).digest('hex');
  for (const [value, cell] of [[test.atmosphere.o2, 'AA54'], [test.atmosphere.pressure, 'AB54'], [test.flow.initialFlowCmS, 'K54']] as const) {
    expect(value.sourceRef).toMatchObject({ fileHash: hash, locator: { table: workbook, sheet: 'as run matrix', row: 54, cell } });
  }
  expect(test.observationSourceRef?.locator).toMatchObject({ table: workbook, sheet: 'as run matrix', row: 54, cell: 'AD54' });
  expect(test.observationSourceRef?.quote).toContain('got a brief flame');
  for (const segment of test.segments) expect(segment.sourceRef.locator?.table).toBe(workbook);
});
it('does not leave other BASS atmospheric references pointing at a six-column identity CSV', () => {
  for (const test of corpus.tests.filter((t) => t.inv === 'BASS' && t.extra.asRunRow)) {
    expect(test.atmosphere.o2.sourceRef?.locator?.table).toBe(workbook);
    expect(test.atmosphere.pressure.sourceRef?.locator?.row).toBe(test.extra.asRunRow);
  }
});
it('keeps public cached answers on the current corpus and carries BASS condition sources', () => {
  const file = JSON.parse(readFileSync('public/data/ask_answers.json', 'utf8'));
  expect(file.corpusVersion).toBe(corpus.corpusVersion);
  const citations = file.answers.flatMap((answer: { citations: { kind: string; inv?: string; conditionSources?: { oxygen?: { locator?: { table?: string } } } }[] }) => answer.citations);
  for (const citation of citations.filter((entry: { kind: string; inv?: string }) => entry.kind === 'test' && entry.inv === 'BASS')) {
    expect(citation.conditionSources?.oxygen?.locator?.table).toBe(workbook);
  }
});
