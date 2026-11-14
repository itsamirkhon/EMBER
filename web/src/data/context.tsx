import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadAll, type EmberData } from './load';
import type { FuelPhase, Mission } from '../lib/types';
import type { Query, RelevanceWeights } from '../lib/evidence';
import { DEFAULT_WEIGHTS } from '../lib/evidence';

export interface Scenario {
  missionId: string; // mission id or 'custom'
  o2Pct: number;
  pressureKpa: number;
  flowMin: number;
  flowMax: number;
  gravityG: number;
  fuelPhase: FuelPhase | 'any';
  material: string; // '' = any material of the phase
  materialLabel: string;
}

/** Demo default (concept section 3): lunar rover, 30% O2 @ 70.3 kPa (10.2 psi), cabin lining (solid). */
export const DEFAULT_SCENARIO: Scenario = {
  missionId: 'lunar-rover',
  o2Pct: 30,
  pressureKpa: 70.3,
  flowMin: 0,
  flowMax: 20,
  gravityG: 0.166,
  fuelPhase: 'solid',
  material: '',
  materialLabel: 'Cabin lining material',
};

export function scenarioFromMission(m: Mission, prev: Scenario): Scenario {
  const flow = m.flowCmS;
  const [fmin, fmax] = Array.isArray(flow) ? flow : flow === null || flow === undefined ? [prev.flowMin, prev.flowMax] : [flow, flow];
  return {
    ...prev,
    missionId: m.id,
    o2Pct: m.o2Pct ?? prev.o2Pct,
    pressureKpa: m.pressureKpa ?? prev.pressureKpa,
    flowMin: fmin,
    flowMax: fmax,
    gravityG: m.gravityG ?? prev.gravityG,
  };
}

export function scenarioQuery(s: Scenario): Query {
  return {
    o2Pct: s.o2Pct,
    pressureKpa: s.pressureKpa,
    flowCmS: s.flowMin === s.flowMax ? s.flowMin : [s.flowMin, s.flowMax],
    fuelPhase: s.fuelPhase === 'any' ? null : s.fuelPhase,
    fuel: s.material || null,
    gravityG: s.gravityG,
  };
}

interface Ctx {
  data: EmberData | null;
  error: string | null;
  scenario: Scenario;
  setScenario: (s: Scenario | ((p: Scenario) => Scenario)) => void;
  weights: RelevanceWeights;
  setWeights: (w: RelevanceWeights) => void;
}

const DataCtx = createContext<Ctx | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<EmberData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario>(DEFAULT_SCENARIO);
  const [weights, setWeights] = useState<RelevanceWeights>(DEFAULT_WEIGHTS);
  useEffect(() => {
    loadAll().then(setData, (e: unknown) => setError(String(e)));
  }, []);
  const value = useMemo(() => ({ data, error, scenario, setScenario, weights, setWeights }), [data, error, scenario, weights]);
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useEmber(): Ctx {
  const c = useContext(DataCtx);
  if (!c) throw new Error('useEmber outside DataProvider');
  return c;
}

/** Data is guaranteed loaded inside routed pages (App gates rendering). */
export function useData(): EmberData {
  const { data } = useEmber();
  if (!data) throw new Error('data not loaded');
  return data;
}
