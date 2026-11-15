import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const code = readFileSync(new URL('../src/ui/v3/pages/LensPage.tsx', import.meta.url), 'utf8');

describe('mission evidence flow stays focused', () => {
  it('starts from one environment dropdown, not a wall of competing cards', () => {
    expect(code).toContain('id="lens-mission"');
    expect(code).toContain('Environment to compare');
    expect(code).not.toContain('className="v3-missions"');
    expect(code).toContain('lensFromMission(next, prev)');
  });

  it('puts optional research tasks and airflow/gravity under disclosure controls', () => {
    expect(code).toContain('<summary>Advanced: research question</summary>');
    expect(code).toContain('<summary>Advanced: airflow {l.flow[0]}–{l.flow[1]} cm/s · gravity {fmtG(l.g)}</summary>');
    expect(code).toContain('clampFlowInput(e.target.value)');
  });

  it('shows no verdict or nearest-test list before an explicit evidence check', () => {
    expect(code).toContain('const engine = lastCheck?.signature === signature ? lastCheck.result : null');
    expect(code).toContain('onClick={() => void checkHistoricalEvidence()}');
    expect(code).toContain('{engine && (\n          <section className="v3-card" aria-labelledby="near-h">');
    expect(code).toContain('No evidence check run for these settings.');
  });

  it('keeps full investigation ranking available without making it primary', () => {
    expect(code).toContain('<summary>Advanced: investigation rankings</summary>');
    expect(code).toContain("rankInvestigationsV2(");
    expect(code).toContain('Source: <Ext href={n.row.url}>');
    expect(code).toContain('not a new fire test, simulation or safety recommendation');
  });
});
