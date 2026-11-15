import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const home = read('../src/ui/v3/pages/HomePage.tsx');
const scene = read('../src/ui/v3/EvidenceSpace.tsx');
const styles = read('../src/ui/v3/v3.css');
const nav = read('../src/ui/components/Layout.tsx');

describe('focused EMBER evidence workflow', () => {
  it('has one primary user action instead of competing demo modules', () => {
    expect(home.match(/v3-btn-primary/g)).toHaveLength(1);
    expect(home).toContain('Check your cabin');
    expect(home).toContain('to="/lens?mission=lunar-rover&material=PMMA"');
    expect(home).toContain('navigate(\'/lens?mission=\'');
    expect(home).not.toContain('<iframe');
    expect(home).not.toContain('Same fire, different rules');
    expect(home).not.toContain('Three tools, all running');
  });

  it('keeps the scientific boundary scoped and distinguishable from fire predictions', () => {
    expect(home).toContain('cliffStats(data.rows)');
    expect(home).toContain('A coverage boundary is not a physical flammability threshold.');
    expect(home).toContain('Not a fire simulation or a safety certification.');
    expect(home).toContain('cliff.solidFlight');
    expect(home).toContain('Inspect NASA records');
  });

  it('moves the real 3D field with reduced-motion respect and 2D fallback', () => {
    expect(home).toContain('lazy(() => import(\'../EvidenceSpace\'))');
    expect(home).toContain('EvidenceMap');
    expect(home).toContain('onFail={() => setRenderFailed(true)}');
    expect(scene).toContain('controls.autoRotate = !reduced;');
    expect(scene).toContain('controls.autoRotate = false;');
    expect(scene).toContain('if (!visible || document.hidden) return;');
  });

  it('never invents gravity or jittered measurements in the plotted flight data', () => {
    expect(scene).toContain("r.gravityMode === 'actual_flight' && r.g !== null");
    expect(scene).toContain('pos.set([xOf(r.o2 as number), yOf(r.kPa as number), zOf(r.g as number)]');
    expect(scene).not.toContain('Math.random() - 0.5');
    expect(scene).toContain("r.o2Prov === 'assumed' || r.kPaProv === 'assumed'");
  });

  it('uses one restrained color-token source, with research paths still available', () => {
    // Oxygen Green: pad ground, oxygen-cylinder green action, one highlighter reserved for the coverage boundary
    expect(styles).toContain('--v3-bg: #eef2e2');
    expect(styles).toContain('--v3-accent: #1e7a46');
    expect(styles).toContain('--v3-cliff: #c8e62e');
    expect(styles).not.toContain('--v3-accent: #3d7bff');
    for (const label of ['Evidence map', 'Mission lens', 'Ask EMBER', 'Trust']) {
      expect(nav.slice(nav.indexOf('const PRIMARY'), nav.indexOf('const MORE'))).toContain("label: '" + label + "'");
    }
    expect(nav.slice(nav.indexOf('<footer'))).not.toContain('/review');
    for (const path of ['/map', '/export', '/compare', '/investigations', '/ask', '/trust']) {
      expect(nav).toContain("to: '" + path + "'");
    }
  });
});
