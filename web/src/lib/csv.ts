import type { Investigation, TestRow } from './types';

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = [
  'inv', 'psi', 'doi', 'testId', 'fuel', 'fuelPhase', 'geometry', 'thicknessMm', 'diameterMm',
  'o2Pct', 'pressureKpa', 'flowCmS', 'gravityG', 'diluent', 'diluentPct', 'outcome', 'outcomeRaw',
  'spreadRateMmS', 'burningRateMm2S', 'particleSizeNm', 'sourceId', 'sourceFile', 'sourceRow', 'psiUrl', 'extra',
] as const;

export function testsToCsv(tests: TestRow[], invs: Investigation[]): string {
  const byId = new Map(invs.map((i) => [i.id, i]));
  const lines = [CSV_COLUMNS.join(',')];
  for (const t of tests) {
    const inv = byId.get(t.inv);
    const row: Record<(typeof CSV_COLUMNS)[number], unknown> = {
      inv: t.inv,
      psi: inv?.psi,
      doi: inv?.doi,
      testId: t.testId,
      fuel: t.fuel,
      fuelPhase: t.fuelPhase,
      geometry: t.geometry,
      thicknessMm: t.thicknessMm,
      diameterMm: t.diameterMm,
      o2Pct: t.o2Pct,
      pressureKpa: t.pressureKpa,
      flowCmS: t.flowCmS,
      gravityG: t.gravityG,
      diluent: t.diluent,
      diluentPct: t.diluentPct,
      outcome: t.outcome,
      outcomeRaw: t.outcomeRaw,
      spreadRateMmS: t.spreadRateMmS,
      burningRateMm2S: t.burningRateMm2S,
      particleSizeNm: t.particleSizeNm,
      sourceId: t.source?.sourceId,
      sourceFile: t.source?.file,
      sourceRow: t.source?.row,
      psiUrl: inv?.psiUrl,
      extra: t.extra && Object.keys(t.extra).length ? t.extra : null,
    };
    lines.push(CSV_COLUMNS.map((c) => csvCell(row[c])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
