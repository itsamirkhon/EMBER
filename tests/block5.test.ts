import { describe, expect, it } from 'vitest';
import { CATALOG_ROUTES } from '../src/ui/context/EmberContext';
import { LUNAR_MATERIAL_BAND } from '../src/ui/v3/data';

describe('corpus loading is limited to catalog screens', () => {
  it('loads the investigation catalog only on routes that list it', () => {
    for (const path of ['/investigations', '/investigations/BASS', '/explorer', '/review', '/reviews/demo-pmma-lunar']) {
      expect(CATALOG_ROUTES.test(path), path).toBe(true);
    }
    for (const path of ['/', '/map', '/lens', '/ask', '/trust', '/earth', '/compare', '/export', '/reviewer']) {
      expect(CATALOG_ROUTES.test(path), path).toBe(false);
    }
  });
});

describe('lunar habitat materials band', () => {
  it('starts at the 34% set point and stops at the sourced 36% rating', () => {
    expect(LUNAR_MATERIAL_BAND).toMatchObject({ missionId: 'lunar-base', o2From: 34, o2To: 36, kPa: 56.5 });
    expect(LUNAR_MATERIAL_BAND.source.url).toBe('https://ntrs.nasa.gov/citations/20200002311');
    expect(LUNAR_MATERIAL_BAND.note).toMatch(/not a cabin control band/);
  });
});
