import { describe, expect, it } from 'vitest';
import { auditFlameLabels, flameEstablishmentLabel } from '../src/core/trustAudit';
import type { Test } from '../src/core/types';

const record = (initialOutcome: string) => ({ initialOutcome } as Test);
describe('flame-establishment audit', () => {
  it('never labels extinction or non-flaming pyrolysis as failure to establish a flame', () => {
    for (const outcome of ['self_extinguished', 'non_flaming_pyrolysis', 'unknown']) {
      expect(flameEstablishmentLabel(outcome)).toBeNull();
    }
    expect(flameEstablishmentLabel('no_ignition')).toBe('no');
    expect(flameEstablishmentLabel('ignited_burned')).toBe('yes');
  });
  it('counts ambiguous records separately and does not invent accuracy', () => {
    const audit = auditFlameLabels([record('burned'), record('no_ignition'), record('self_extinguished')]);
    expect(audit).toEqual({ records: 3, positive: 1, negative: 1, ambiguous: 1 });
    expect(audit).not.toHaveProperty('accuracy');
  });
});
