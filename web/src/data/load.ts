/**
 * Data loader. Fetches `data/<file>.json` relative to the page (works under a GitHub Pages
 * sub-path). If a file is missing (404, or the dev server answering with index.html), falls
 * back to the bundled fixtures in `web/fixtures/data/` and records that, so the UI can show
 * a visible "fixture data" banner.
 */
import type {
  Claim, DatasetsManifest, ExtractionEval, Investigation, Mission, OutcomeAudit, StoryItem, TestRow, Validation,
} from '../lib/types';
import { parseJsonLenient } from '../lib/json';
import { normalizeInvestigation, normalizeTest } from './normalize';

export interface EmberData {
  investigations: Investigation[];
  tests: TestRow[];
  missions: Mission[];
  claims: Claim[];
  extractionEval: ExtractionEval | null;
  outcomeAudit: OutcomeAudit | null;
  earth: StoryItem[];
  history: StoryItem[];
  validation: Validation | null;
  manifest: DatasetsManifest | null;
  /** files served from fixtures instead of data/ */
  fixtureFiles: string[];
  /** files missing in both places */
  missingFiles: string[];
}

const fixtureModules = import.meta.glob<{ default: unknown }>('../../fixtures/data/*.json');

async function fetchJson(name: string): Promise<unknown | undefined> {
  try {
    const r = await fetch(`data/${name}.json`, { cache: 'no-cache' });
    if (!r.ok) return undefined;
    const text = await r.text();
    if (text.trimStart().startsWith('<')) return undefined; // SPA fallback html
    const { value, repaired } = parseJsonLenient(text);
    if (repaired) console.warn(`data/${name}.json: ${repaired} NaN/Infinity value(s) treated as null (invalid JSON; fix in pipeline)`);
    return value;
  } catch {
    return undefined;
  }
}

async function fixture(name: string): Promise<unknown | undefined> {
  const key = `../../fixtures/data/${name}.json`;
  const loader = fixtureModules[key];
  if (!loader) return undefined;
  return (await loader()).default;
}

export async function loadAll(): Promise<EmberData> {
  const names = [
    'investigations', 'tests', 'missions', 'claims', 'extraction_eval', 'outcome_audit', 'earth', 'history', 'validation', 'datasets_manifest',
  ] as const;
  const real = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await fetchJson(n)] as const))) as Record<
    (typeof names)[number],
    unknown
  >;
  const fixtureFiles: string[] = [];
  const missingFiles: string[] = [];
  const resolved: Record<string, unknown> = {};

  // investigations + tests must come from the same source (tests reference investigation ids)
  const coreFromFixtures = real.investigations === undefined || real.tests === undefined;
  for (const n of names) {
    const forceFixture = coreFromFixtures && (n === 'investigations' || n === 'tests' || n === 'validation');
    let v = forceFixture ? undefined : real[n];
    if (v === undefined) {
      v = await fixture(n);
      if (v !== undefined) fixtureFiles.push(`${n}.json`);
      else missingFiles.push(`${n}.json`);
    }
    resolved[n] = v;
  }

  return {
    investigations: ((resolved.investigations as Investigation[]) ?? []).map(normalizeInvestigation),
    tests: ((resolved.tests as TestRow[]) ?? []).map(normalizeTest),
    missions: ((resolved.missions as Mission[]) ?? []).map((m) => ({ ...m, sources: m.sources ?? [] })),
    claims: ((resolved.claims as Claim[]) ?? []).map((c) => ({ ...c, topic: c.topic ?? [] })),
    extractionEval: (resolved.extraction_eval as ExtractionEval) ?? null,
    outcomeAudit: (resolved.outcome_audit as OutcomeAudit) ?? null,
    earth: (resolved.earth as StoryItem[]) ?? [],
    history: (resolved.history as StoryItem[]) ?? [],
    validation: (resolved.validation as Validation) ?? null,
    manifest: (resolved.datasets_manifest as DatasetsManifest) ?? null,
    fixtureFiles,
    missingFiles,
  };
}

export { normalizeInvestigation, normalizeTest } from './normalize';
