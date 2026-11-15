import { describe, expect, it } from 'vitest';
import {
  comparisonSeed,
  protocolHref,
  resolveProtocolTest,
  scopedProtocolTests,
} from '../src/ui/protocolSelection';

const records = [
  { testId: 'BASS-II-B1', inv: 'BASS-II', fuel: 'PMMA', seriesId: 'BASS-II-B' },
  { testId: 'BASS-II-B10', inv: 'BASS-II', fuel: 'PMMA', seriesId: 'BASS-II-B' },
  { testId: 'BASS-II-M1', inv: 'BASS-II', fuel: 'PMMA', seriesId: 'BASS-II-M' },
  { testId: 'CFI-1206', inv: 'CFI', fuel: 'n-decane', seriesId: 'CFI-12' },
  { testId: 'CFI-1207', inv: 'CFI', fuel: 'n-decane', seriesId: 'CFI-12' },
  { testId: 'CFI-1208', inv: 'CFI', fuel: 'n-heptane', seriesId: 'CFI-12' },
  { testId: 'SPICE-001', inv: 'SPICE', fuel: 'C2H4', seriesId: 'SPICE-A' },
];

describe('protocol deep links from recorded investigation tests', () => {
  it('includes investigation ID and correctly encodes the exact test ID', () => {
    expect(protocolHref('CFI', 'CFI-1206')).toBe('/compare?inv=CFI&testId=CFI-1206');
    expect(protocolHref('ACME-CFI-G', 'run #2/4')).toBe('/compare?inv=ACME-CFI-G&testId=run%20%232%2F4');
  });

  it('resolves a requested CFI test rather than the default BASS-II protocol', () => {
    expect(resolveProtocolTest(records, 'CFI-1206', 'CFI', ['BASS-II-B1'])?.testId).toBe('CFI-1206');
  });

  it('never substitutes a BASS-II or other investigation when the requested test is missing', () => {
    expect(resolveProtocolTest(records, 'CFI-9999', 'CFI', ['BASS-II-B1'])).toBeNull();
    expect(resolveProtocolTest(records, 'BASS-II-B1', 'CFI', ['BASS-II-B1'])).toBeNull();
    expect(resolveProtocolTest(records, 'not-a-test', null, ['BASS-II-B1'])).toBeNull();
  });

  it('keeps the entire protocol picker within the linked investigation', () => {
    expect(scopedProtocolTests(records, 'CFI').map((t) => t.testId)).toEqual(['CFI-1206', 'CFI-1207', 'CFI-1208']);
    expect(scopedProtocolTests(records, 'NO-SUCH-INV')).toEqual([]);
  });

  it('seeds comparison with the selected CFI test and only peer tests from CFI', () => {
    const result = comparisonSeed(records, 'CFI-1206', 'CFI', ['BASS-II-B1']);
    expect(result).toEqual(['CFI-1206', 'CFI-1207', 'CFI-1208']);
    expect(result.every((id) => id.startsWith('CFI-'))).toBe(true);
  });

  it('blocks comparison seeding for missing or mismatched deep-linked tests', () => {
    expect(comparisonSeed(records, 'CFI-9999', 'CFI', ['BASS-II-B1'])).toEqual([]);
    expect(comparisonSeed(records, 'BASS-II-B1', 'CFI', ['BASS-II-B1'])).toEqual([]);
  });

  it('preserves default example behavior for standalone Compare, not for scoped links', () => {
    expect(resolveProtocolTest(records, null, null, ['BASS-II-B1'])?.testId).toBe('BASS-II-B1');
    expect(resolveProtocolTest(records, null, 'SPICE', ['BASS-II-B1'])?.testId).toBe('SPICE-001');
    expect(comparisonSeed(records, null, 'SPICE', ['BASS-II-B1'])).toEqual(['SPICE-001']);
  });
});
