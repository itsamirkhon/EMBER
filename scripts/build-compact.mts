/**
 * Builds public/data/compact.json: a compact slice of corpus_v2 for the intro, the evidence map,
 * the mission lens's nearest-test view, Back to Earth and Trust. The full corpus (26 MB) is only
 * loaded where the applicability engine or full records are needed.
 *
 *   npx tsx scripts/build-compact.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { CorpusV2 } from '../src/core';

const corpus = JSON.parse(readFileSync('public/data/corpus_v2.json', 'utf8')) as CorpusV2;

/** One row per test: [testId, inv, phase, fuel, o2, o2Prov, kPa, kPaProv, flow, g, outcome, terminal, gravityMode, table, row, url, geometry, thicknessMm, spreadMmS, optional oxygen/pressure/observation SourceRefs] */
const tests = corpus.tests.map((t) => [
  t.testId,
  t.inv,
  t.fuelPhase,
  t.fuel,
  t.atmosphere.o2.value,
  t.atmosphere.o2.provenance,
  t.atmosphere.pressure.value,
  t.atmosphere.pressure.provenance,
  t.flow.initialFlowCmS.value,
  t.gravity.gravityG.value,
  t.initialOutcome,
  t.terminalEvent,
  t.gravity.mode,
  t.sourceRef.locator?.table ?? null,
  t.sourceRef.locator?.row ?? null,
  t.sourceRef.url,
  t.geometry,
  t.thicknessMm.value,
  t.spreadRateMmS.value,
  ...(t.observationSourceRef ? [t.atmosphere.o2.sourceRef, t.atmosphere.pressure.sourceRef, t.observationSourceRef] : []),
]);

const investigations = corpus.investigations.map((i) => ({
  id: i.id, name: i.name, psi: i.psi, psiUrl: i.psiUrl, doi: i.doi, family: i.family, fuelPhase: i.fuelPhase,
  direction: i.direction, years: i.years, nTests: i.nTests, flight: i.flight, platform: i.platform,
  objective: i.objective, resultSummary: i.resultSummary, earthRelevance: (i as { earthRelevance?: string | null }).earthRelevance ?? null,
  assumed: i.conditions?.assumed ?? [],
}));

writeFileSync(
  'public/data/compact.json',
  JSON.stringify({
    corpusVersion: corpus.corpusVersion,
    generatedAt: corpus.generatedAt,
    counts: { investigations: corpus.investigations.length, tests: corpus.tests.length, claims: corpus.claims.length, sources: corpus.sources.length },
    tests,
    investigations,
    missions: corpus.missions,
    history: corpus.history,
    earth: corpus.earth,
    extractionEval: corpus.extractionEval,
    outcomeAudit: corpus.outcomeAudit,
  }),
);
console.log('compact.json written', tests.length, 'tests');
