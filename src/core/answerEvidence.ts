import { normalizeMaterialName } from './materials';
import type { ResearchQuery, Test } from './types';

export function asksForEffect(question: string): boolean {
  return /\b(?:affect|effects?|influence|caus\w*|depend\w*|relationship|impact)\b/i.test(question);
}

/** Context records, not predictions: prefer the requested material, then known conditions. */
export function nearestEvidenceTests(query: ResearchQuery, tests: Test[], limit = 3): Test[] {
  const flow = Array.isArray(query.flowCmS) ? (query.flowCmS[0] + query.flowCmS[1]) / 2 : query.flowCmS;
  const axes: [number | null, (t: Test) => number | null, number][] = [
    [query.o2Pct, t => t.atmosphere.o2.value, 5],
    [query.pressureKpa, t => t.atmosphere.pressure.value, 20],
    [flow, t => t.flow.initialFlowCmS.value, 5],
    [query.gravityG, t => t.gravity.gravityG.value, 0.2],
  ];
  return tests.filter(t => t.gravity.mode === 'actual_flight' &&
    (!query.fuelPhase || t.fuelPhase === query.fuelPhase) &&
    t.initialOutcome !== 'unknown' && t.initialOutcome !== 'not_applicable' &&
    (t.atmosphere.o2.value !== null || t.atmosphere.pressure.value !== null))
    .map(t => ({ t, materialMismatch: query.material && normalizeMaterialName(t.fuel) !== normalizeMaterialName(query.material) ? 1 : 0,
      distance: axes.reduce((sum, [requested, value, scale]) => requested === null ? sum : sum + (value(t) === null ? 10 : Math.abs(requested - value(t)!) / scale), 0),
    }))
    .sort((a, b) => a.materialMismatch - b.materialMismatch || a.distance - b.distance || a.t.testId.localeCompare(b.t.testId))
    .slice(0, limit).map(x => x.t);
}

/** A listed sequence is not a measured time axis or an exact quench threshold. */
export function recordedFlowSteps(test: Test): number[] {
  const sequence = test.flow.sequenceCmS;
  const raw = test.flow.initialFlowCmS.originalValue;
  if (!sequence || sequence.length < 2 || typeof raw !== 'string' ||
    !['reported', 'series_level'].includes(test.flow.initialFlowCmS.provenance)) return [];
  const sourceValues = raw.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return sourceValues.length === sequence.length && sequence.every((v, i) => Number.isFinite(v) && v === sourceValues[i]) ? sequence : [];
}
