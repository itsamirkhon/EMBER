import type { Test } from './types';

const POSITIVE = new Set(['ignited_flame_spread', 'ignited_burned', 'burned', 'hot_flame_ignited', 'hot_ignition', 'jet_flame_established']);
/** Corpus labels are screening candidates, not independently adjudicated endpoint truth. */
export function flameEstablishmentLabel(outcome: string): 'yes' | 'no' | null {
  if (POSITIVE.has(outcome)) return 'yes';
  return outcome === 'no_ignition' ? 'no' : null;
}
export function auditFlameLabels(tests: readonly Test[]) {
  let positive = 0;
  let negative = 0;
  for (const test of tests) {
    const label = flameEstablishmentLabel(test.initialOutcome);
    if (label === 'yes') positive++;
    if (label === 'no') negative++;
  }
  return { records: tests.length, positive, negative, ambiguous: tests.length - positive - negative };
}
