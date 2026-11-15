/** Endpoint-label audit only. The former nearest-neighbour backtest is withdrawn. */
import { readFileSync, writeFileSync } from 'node:fs';
import type { CorpusV2 } from '../src/core/types';
import { auditFlameLabels } from '../src/core/trustAudit';

const corpus = JSON.parse(readFileSync('public/data/corpus_v2.json', 'utf8')) as CorpusV2;
const phases = Object.fromEntries((['solid', 'gas', 'liquid'] as const).map((phase) => {
  const flight = corpus.tests.filter((t) => t.fuelPhase === phase && t.gravity.mode === 'actual_flight');
  const reported = flight.filter((t) => t.atmosphere.o2.value !== null && t.atmosphere.pressure.value !== null
    && t.atmosphere.o2.provenance !== 'assumed' && t.atmosphere.pressure.provenance !== 'assumed');
  return [phase, { ...auditFlameLabels(reported), excludedAtmosphere: flight.length - reported.length }];
}));
writeFileSync('public/data/trust.json', JSON.stringify({
  schemaVersion: 2,
  status: 'withdrawn_pending_independent_validation',
  generatedAt: new Date().toISOString(),
  corpusVersion: corpus.corpusVersion,
  method: 'Descriptive audit of corpus outcome labels in actual-flight records with non-assumed, available oxygen and pressure. Counts include reconstructed protocols and series aggregates; they are not independent experiments or verified endpoint truth.',
  outcome: 'Candidate flame-establishment labels: explicit ignition/burning labels vs no_ignition. Self-extinction, non-flaming pyrolysis and unknown outcomes are unscored; extinction does not mean a flame never formed.',
  phases,
}, null, 2) + '\n');
console.log('Trust endpoint audit rebuilt; no predictive accuracy is published.');
