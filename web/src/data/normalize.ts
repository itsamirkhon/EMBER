import type { Investigation, TestRow } from '../lib/types';

/** Defensive defaults so a partially filled record never crashes the UI. */
export function normalizeInvestigation(i: Investigation): Investigation {
  return {
    ...i,
    direction: i.direction ?? [],
    varied: i.varied ?? [],
    constant: i.constant ?? [],
    diagnostics: i.diagnostics ?? [],
    keyFindings: i.keyFindings ?? [],
    sources: i.sources ?? [],
    dataNotes: i.dataNotes ?? [],
    safetyConsequence: i.safetyConsequence ?? 1,
  };
}

const NUMERIC = ['thicknessMm', 'diameterMm', 'o2Pct', 'pressureKpa', 'flowCmS', 'gravityG', 'diluentPct', 'spreadRateMmS', 'burningRateMm2S', 'particleSizeNm'] as const;

export function normalizeTest(t: TestRow): TestRow {
  const out = { ...t, extra: t.extra ?? {}, source: t.source ?? { sourceId: null, file: null, row: null } } as TestRow;
  for (const k of NUMERIC) {
    const v = out[k] as unknown;
    (out as unknown as Record<string, unknown>)[k] = typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
  }
  return out;
}
