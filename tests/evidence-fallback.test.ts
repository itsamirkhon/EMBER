import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Mission } from '../src/core';
import { EvidenceFallback } from '../src/ui/v3/EvidenceFallback';
import type { Cliff, Row } from '../src/ui/v3/data';

function row(testId: string, patch: Partial<Row> = {}): Row {
  return {
    testId, inv: 'BASS-II', phase: 'solid', fuel: 'PMMA',
    o2: 22.2, o2Prov: 'reported', kPa: 101.3, kPaProv: 'series_level',
    flow: 5, g: 0, gravityMode: 'actual_flight', outcome: 'ignited_burned',
    terminal: null, table: 'PSI-25', row: 1, url: 'https://psi.nasa.gov',
    geometry: null, thicknessMm: null, spreadMmS: null,
    ...patch,
  };
}

const cliff: Cliff = {
  solidFlight: 261, o2Min: 17, o2Max: 22.7, kPaMin: 98, kPaMax: 102,
  above225: 3, above225Inv: ['BASS-II'], assumedSmoke: 0, gasMaxO2: 39,
};

describe('WebGL fallback is source-scoped, not decoration', () => {
  it('includes only reported solid flight conditions without invented coordinates', () => {
    const records = [
      row('observed-1'),
      row('assumed-O2', { o2Prov: 'assumed' }),
      row('assumed-P', { kPaProv: 'assumed' }),
      row('unknown-g', { g: null }),
      row('liquid-other-phase', { phase: 'liquid' }),
      row('ground-other-mode', { gravityMode: 'ground_test' }),
    ];
    // The 2D plot only represents oxygen and pressure; it may show a record
    // whose gravity is unknown, unlike the three-dimensional plot.
    const html = renderToStaticMarkup(createElement(EvidenceFallback, {
      rows: records, missions: [], cliff,
    }));
    expect(html).toContain('2 plottable solid-material flight records');
    expect(html).toContain('observed-1');
    expect(html).toContain('unknown-g');
    expect(html).not.toContain('assumed-O2');
    expect(html).not.toContain('assumed-P');
    expect(html).not.toContain('liquid-other-phase');
    expect(html).not.toContain('ground-other-mode');
    expect(html).toContain('data boundary, not a fire limit');
  });

  it('labels proposed mission coordinates separately from recorded experiments', () => {
    const mission = {
      id: 'lunar-rover', label: 'Lunar rover', o2Pct: 30, pressureKpa: 70.3,
      gravityG: 0.166, flowCmS: null, assumption: true, sources: [],
    } as unknown as Mission;
    const html = renderToStaticMarkup(createElement(EvidenceFallback, {
      rows: [row('BASS-II-B1')], missions: [mission], cliff,
    }));
    expect(html).toContain('Lunar scenario');
    expect(html).toContain('not a flight test');
    expect(html).toContain('22.7% observed max');
  });
});
