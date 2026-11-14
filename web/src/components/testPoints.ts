import type { ScatterPoint } from './ScatterPlot';
import { binaryOutcome, type Dim } from '../lib/evidence';
import type { TestRow } from '../lib/types';
import { fmtGravity, fmtNum } from './ui';

export function testToPoint(t: TestRow, x: Dim, y: Dim, extra: Partial<ScatterPoint> = {}): ScatterPoint | null {
  const xv = t[x];
  const yv = t[y];
  if (xv === null || yv === null) return null;
  const b = binaryOutcome(t.outcome);
  return {
    id: `${t.inv}::${t.testId}`,
    x: xv,
    y: yv,
    cat: b ?? 'other',
    title: `${t.testId} · ${t.fuel ?? 'fuel n/a'}`,
    rows: [
      ['Outcome', t.outcomeRaw ? `${t.outcome} (“${t.outcomeRaw}”)` : String(t.outcome)],
      ['O₂', `${fmtNum(t.o2Pct)} %`],
      ['Pressure', `${fmtNum(t.pressureKpa)} kPa`],
      ['Flow', t.flowCmS === null ? 'not reported' : `${fmtNum(t.flowCmS)} cm/s`],
      ['Gravity', fmtGravity(t.gravityG)],
      ['Investigation', t.inv],
    ],
    ...extra,
  };
}
