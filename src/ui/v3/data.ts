/**
 * Presentation-layer data helpers. The compact slice (public/data/compact.json) powers the intro,
 * the evidence map and nearest-test views without loading the 26 MB corpus.
 */
import { useEffect, useState } from 'react';
import type { FuelPhase, Mission, ResearchQuery, StoryItem } from '../../core';
import { normalizeGravityRegime } from '../../core';

export interface Row {
  testId: string;
  inv: string;
  phase: FuelPhase | null;
  fuel: string | null;
  o2: number | null;
  o2Prov: string;
  kPa: number | null;
  kPaProv: string;
  flow: number | null;
  g: number | null;
  outcome: string;
  terminal: string | null;
  gravityMode: string;
  table: string | null;
  row: number | null;
  url: string | null;
  geometry: string | null;
  thicknessMm: number | null;
  spreadMmS: number | null;
}

export interface InvBrief {
  id: string;
  name: string;
  psi: string | null;
  psiUrl: string | null;
  doi: string | null;
  family: string;
  fuelPhase: FuelPhase | null;
  direction: string[];
  years: string | null;
  nTests: number | null;
  flight: boolean | null;
  platform: string | null;
  objective: string | null;
  resultSummary: string | null;
  earthRelevance: string | null;
  assumed: string[];
}

export interface Compact {
  corpusVersion: string;
  generatedAt: string;
  counts: { investigations: number; tests: number; claims: number; sources: number };
  rows: Row[];
  investigations: InvBrief[];
  missions: Mission[];
  history: (StoryItem & { quote?: string; lesson?: string; date?: string })[];
  earth: (StoryItem & { quote?: string; linkNote?: string })[];
  extractionEval: Record<string, unknown>;
  outcomeAudit: Record<string, unknown>;
}

type RawRow = [string, string, FuelPhase | null, string | null, number | null, string, number | null, string, number | null, number | null, string, string | null, string, string | null, number | null, string | null, string | null, number | null, number | null];

let compactPromise: Promise<Compact> | null = null;

export function loadCompact(): Promise<Compact> {
  if (!compactPromise) {
    compactPromise = fetch('./data/compact.json')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load data (${res.status})`);
        const raw = (await res.json()) as Omit<Compact, 'rows'> & { tests: RawRow[] };
        const rows: Row[] = raw.tests.map((r) => ({
          testId: r[0], inv: r[1], phase: r[2], fuel: r[3], o2: r[4], o2Prov: r[5], kPa: r[6], kPaProv: r[7], flow: r[8], g: r[9],
          outcome: r[10], terminal: r[11], gravityMode: r[12], table: r[13], row: r[14], url: r[15], geometry: r[16], thicknessMm: r[17], spreadMmS: r[18],
        }));
        const { tests: _drop, ...rest } = raw;
        void _drop;
        return { ...rest, rows };
      })
      .catch((err) => {
        compactPromise = null;
        throw err;
      });
  }
  return compactPromise;
}

export function useCompact(): { data: Compact | null; error: string | null } {
  const [data, setData] = useState<Compact | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadCompact().then((d) => live && setData(d), (e: unknown) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, []);
  return { data, error };
}

// ------------------------------------------------------------------ the finding

export interface Cliff {
  solidFlight: number;
  o2Min: number;
  o2Max: number;
  kPaMin: number;
  kPaMax: number;
  above225: number;
  above225Inv: string[];
  assumedSmoke: number;
  gasMaxO2: number;
}

/** "Evidence cliff": solid-material flight tests with a reported (not assumed) oxygen value. */
export function cliffStats(rows: Row[]): Cliff | null {
  const solid = rows.filter((r) => r.phase === 'solid' && r.o2 !== null && r.o2Prov !== 'assumed' && r.gravityMode === 'actual_flight');
  // Zero matching flight records is NOT evidence for an O2=0% threshold.
  if (solid.length === 0) return null;
  const withP = solid.filter((r) => r.kPa !== null && r.kPaProv !== 'assumed');
  const above = solid.filter((r) => (r.o2 ?? 0) > 22.5);
  const gas = rows.filter((r) => r.phase === 'gas' && r.o2 !== null && r.o2Prov !== 'assumed');
  return {
    solidFlight: solid.length,
    o2Min: Math.min(...solid.map((r) => r.o2 as number)),
    o2Max: Math.max(...solid.map((r) => r.o2 as number)),
    kPaMin: withP.length ? Math.min(...withP.map((r) => r.kPa as number)) : Number.NaN,
    kPaMax: withP.length ? Math.max(...withP.map((r) => r.kPa as number)) : Number.NaN,
    above225: above.length,
    above225Inv: [...new Set(above.map((r) => r.inv))],
    assumedSmoke: rows.filter((r) => r.phase === 'solid' && r.o2Prov === 'assumed').length,
    gasMaxO2: gas.length ? Math.max(...gas.map((r) => r.o2 as number)) : Number.NaN,
  };
}

/** Published flight tests that are not in NASA PSI, drawn as annotations, never mixed into the corpus. */
export const OUTSIDE_PSI = [
  {
    id: 'saffire-vi-2',
    label: 'Saffire-VI · VI-2',
    o2: 31.0,
    kPa: 54.1,
    g: 0,
    note: 'SIBAL cloth, Cygnus, Jan 2024. Published in NTRS, not in PSI.',
    url: 'https://ntrs.nasa.gov/citations/20240002981',
  },
];

// ------------------------------------------------------------------ Earth and history reference points

/** Familiar atmospheres drawn on the evidence map for scale. They are not tests and not mission scenarios. */
export interface ReferencePoint {
  id: string;
  label: string;
  o2: number;
  kPa: number;
  note: string;
  source: { label: string; url: string };
}

export const REFERENCE_POINTS: ReferencePoint[] = [
  {
    id: 'airliner',
    label: 'Airliner cabin',
    o2: 21,
    kPa: 75.3,
    note: 'Ordinary air at the highest cabin altitude allowed in normal flight, 8,000 ft (75.3 kPa in the standard atmosphere).',
    source: { label: 'US 14 CFR § 25.841(a), pressurized cabins', url: 'https://www.law.cornell.edu/cfr/text/14/25.841' },
  },
  {
    id: 'oxygen-enriched',
    label: '“Oxygen-enriched” on Earth',
    o2: 23.5,
    kPa: 101.3,
    note: 'Health-care fire codes treat air above 23.5% O₂ as an oxygen-enriched atmosphere with added fire precautions. It sits just past the last solid-material flight test.',
    source: { label: 'NFPA 99 Health Care Facilities Code, definition of oxygen-enriched atmosphere', url: 'https://www.nfpa.org/codes-and-standards/nfpa-99-standard-development/99' },
  },
  {
    id: 'apollo-1',
    label: 'Apollo 1 pad test, 1967',
    o2: 100,
    kPa: 115.1,
    note: 'Pure oxygen at 16.7 psia during the plugs-out test in which the fire killed the crew. The review board named this atmosphere a main cause.',
    source: { label: 'Report of the Apollo 204 Review Board', url: 'https://www.nasa.gov/history/Apollo204/desc.html' },
  },
];

/**
 * NASA's 8.2 psia / 34% O₂ exploration atmosphere is a set point. NASA's plan for the 20-foot chamber test of that atmosphere
 * required every material in the chamber to be rated for exposure to 36% O₂, so the band shows oxygen above the set point
 * that cabin materials were required to tolerate. A 37% control band is cited by others but EMBER did not find it in a NASA source.
 */
export const LUNAR_MATERIAL_BAND = {
  missionId: 'lunar-base',
  o2From: 34,
  o2To: 36,
  kPa: 56.5,
  label: 'Materials rated to 36% O₂',
  note: 'NASA’s plan for the 20-foot chamber test of the 8.2 psia / 34% O₂ habitat atmosphere required every material in the chamber to be rated for 36% O₂ at 8.2 psia. This is a materials rating for one test, not a cabin control band.',
  source: {
    label: 'Orndoff and Marmolejo, NASA JSC, Exploration Atmosphere & EVA Prebreathe Protocol Validation: soft goods in 34% O₂ 8.2 psia (NTRS 20200002311)',
    url: 'https://ntrs.nasa.gov/citations/20200002311',
  },
};

// ------------------------------------------------------------------ ground screening vs microgravity

/**
 * Olson, Ruff and Miller, NASA/TM-2008-215260, Table 1. 0 g values come from 5.18 s drops in the NASA Glenn
 * Zero Gravity Research Facility with 30 cm/s concurrent flow; 1 g values are NASA-STD-6001 Test 1 data from WSTF.
 * ULOI = lowest O₂ that burned, MOC = highest O₂ that self-extinguished.
 */
export interface MarginRow {
  material: string;
  kPa: number;
  psia: number;
  uloi1g: number;
  moc1g: number;
  uloi0g: number;
  moc0g: number;
}

export const MARGIN_SOURCE = {
  label: 'Olson, Ruff and Miller, NASA/TM-2008-215260, Table 1',
  url: 'https://ntrs.nasa.gov/citations/20080034883',
};

export const MARGIN_ROWS: MarginRow[] = [
  { material: 'Nomex HT90-40 fabric', kPa: 101.3, psia: 14.7, uloi1g: 25.4, moc1g: 22, uloi0g: 23, moc0g: 22 },
  { material: 'Ultem 1000 film, 10 mil', kPa: 70.3, psia: 10.2, uloi1g: 26.5, moc1g: 24, uloi0g: 24, moc0g: 23 },
  { material: 'Mylar G film', kPa: 70.3, psia: 10.2, uloi1g: 20.8, moc1g: 20, uloi0g: 17, moc0g: 16 },
];

/** The report's equation 1: mean 0 g limit minus mean 1 g limit. Negative = burns at lower O₂ in microgravity. */
export function marginDelta(r: MarginRow): number {
  return (r.uloi0g + r.moc0g) / 2 - (r.uloi1g + r.moc1g) / 2;
}

// ------------------------------------------------------------------ missions → query

export const MISSION_SHORT: Record<string, string> = {
  iss: 'ISS',
  spacecraft: 'Crew capsule',
  'lunar-base': 'Lunar habitat',
  'lunar-rover': 'Lunar rover',
  'mars-base': 'Mars habitat',
  'eva-suit': 'EVA suit',
};

export type Task = 'material_screening' | 'smoke_detection' | 'fire_suppression' | 'atmosphere_selection';
export const TASKS: { id: Task; label: string; hint: string }[] = [
  { id: 'material_screening', label: 'Prevent', hint: 'Will this material burn and spread?' },
  { id: 'smoke_detection', label: 'Detect', hint: 'What smoke does it make?' },
  { id: 'fire_suppression', label: 'Suppress', hint: 'What puts the flame out?' },
  // Atmosphere coverage is controlled by the oxygen/pressure inputs below; it cannot select a safe atmosphere.
];

export interface LensInput {
  missionId: string;
  o2: number;
  kPa: number;
  flow: [number, number];
  g: number;
  phase: FuelPhase;
  material: string;
  task: Task;
}

const ENV: Record<string, ResearchQuery['habitableEnvironment']> = {
  iss: 'iss', spacecraft: 'spacecraft', 'lunar-base': 'lunar_base', 'lunar-rover': 'lunar_rover', 'mars-base': 'mars_base', 'eva-suit': 'eva_suit',
};

export function lensFromMission(m: Mission, prev: LensInput): LensInput {
  const f = m.flowCmS;
  // Missing ventilation speed must not silently inherit the previous mission's values.
  // The form will mark this [0, 20] exploratory range as an assumption.
  const flow: [number, number] = Array.isArray(f) ? [f[0], f[1]] : typeof f === 'number' ? [f, f] : [0, 20];
  return { ...prev, missionId: m.id, o2: m.o2Pct ?? prev.o2, kPa: m.pressureKpa ?? prev.kPa, flow, g: m.gravityG ?? prev.g };
}

export function lensOverrides(l: LensInput): Partial<ResearchQuery> {
  return {
    habitableEnvironment: ENV[l.missionId] ?? 'custom',
    o2Pct: l.o2,
    pressureKpa: l.kPa,
    flowCmS: l.flow[0] === l.flow[1] ? l.flow[0] : l.flow,
    gravityG: l.g,
    gravityRegime: normalizeGravityRegime(l.g),
    fuelPhase: l.phase,
    material: l.material || null,
    safetyTask: l.task,
    targetEndpoint: null,
    geometry: null,
    thicknessMm: null,
    diameterMm: null,
    targetInvIds: [],
  };
}

// ------------------------------------------------------------------ nearest real tests

export interface AxisGap {
  axis: 'o2' | 'kPa' | 'flow' | 'g' | 'material';
  label: string;
  text: string;
  /** 0 = same, 1 = small, 2 = large, 3 = unknown */
  size: 0 | 1 | 2 | 3;
}

export interface Nearest {
  row: Row;
  distance: number;
  gaps: AxisGap[];
}

const SCALE = { o2: 3, kPa: 15, flow: 8 };

function flowGap(range: [number, number], v: number): number {
  return v < range[0] ? range[0] - v : v > range[1] ? v - range[1] : 0;
}

const sign = (x: number, digits = 1) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(digits)}`;

/**
 * The closest real flight tests of the same fuel phase, in the same normalized units the applicability
 * engine uses (3 % O₂, 15 kPa, 8 cm/s). Tests without a reported O₂ and pressure are left out; unreported airflow counts as 1 unit.
 * Gravity is reported as a gap but not used for ranking, because no partial-gravity tests exist.
 */
export function nearestTests(l: LensInput, rows: Row[], k = 3): Nearest[] {
  // A test whose atmosphere was not reported (or was assumed) cannot be shown as "nearest": its distance is unknown.
  const pool = rows.filter((r) => r.phase === l.phase && r.gravityMode === 'actual_flight' && r.o2Prov !== 'assumed' && r.kPaProv !== 'assumed' && r.o2 !== null && r.kPa !== null);
  const mat = l.material.trim().toLowerCase();
  const scored = pool.map((r) => {
    const dO2 = r.o2 === null ? 1 : (l.o2 - r.o2) / SCALE.o2;
    const dP = r.kPa === null ? 1 : (l.kPa - r.kPa) / SCALE.kPa;
    const dF = r.flow === null ? 1 : flowGap(l.flow, r.flow) / SCALE.flow;
    const dM = mat && (r.fuel ?? '').toLowerCase() !== mat ? 1 : 0;
    return { row: r, distance: Math.sqrt(dO2 * dO2 + dP * dP + dF * dF + dM * dM) };
  });
  scored.sort((a, b) => a.distance - b.distance);
  const seen = new Set<string>();
  const out: Nearest[] = [];
  for (const s of scored) {
    // skip exact repeats of the same condition so three different tests are shown
    // Do not collapse opposing outcomes from experiments at identical conditions.
    const key = `${s.row.inv}|${s.row.fuel}|${s.row.o2}|${s.row.kPa}|${s.row.flow}|${s.row.outcome}|${s.row.terminal}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...s, gaps: gapsFor(l, s.row) });
    if (out.length >= k) break;
  }
  return out;
}

export function gapsFor(l: LensInput, r: Row): AxisGap[] {
  const gaps: AxisGap[] = [];
  if (r.o2 === null) gaps.push({ axis: 'o2', label: 'O₂', text: 'not reported', size: 3 });
  else {
    const d = l.o2 - r.o2;
    gaps.push({ axis: 'o2', label: 'O₂', text: Math.abs(d) < 0.6 ? 'same' : `${sign(d)} pts`, size: Math.abs(d) < 0.6 ? 0 : Math.abs(d) <= 3 ? 1 : 2 });
  }
  if (r.kPa === null) gaps.push({ axis: 'kPa', label: 'Pressure', text: 'not reported', size: 3 });
  else {
    const d = l.kPa - r.kPa;
    gaps.push({ axis: 'kPa', label: 'Pressure', text: Math.abs(d) < 3 ? 'same' : `${sign(d)} kPa`, size: Math.abs(d) < 3 ? 0 : Math.abs(d) <= 15 ? 1 : 2 });
  }
  if (r.flow === null) gaps.push({ axis: 'flow', label: 'Airflow', text: 'not reported', size: 3 });
  else {
    const d = flowGap(l.flow, r.flow);
    gaps.push({ axis: 'flow', label: 'Airflow', text: d < 2 ? 'within range' : `${r.flow} cm/s (${sign(r.flow < l.flow[0] ? -d : d)} cm/s)`, size: d < 2 ? 0 : d <= 8 ? 1 : 2 });
  }
  if (r.g === null) gaps.push({ axis: 'g', label: 'Gravity', text: 'not reported', size: 3 });
  else {
    const sameG = Math.abs(r.g - l.g) <= 0.01;
    gaps.push({ axis: 'g', label: 'Gravity', text: sameG ? 'same' : `${fmtG(r.g)} → ${fmtG(l.g)}`, size: sameG ? 0 : 2 });
  }
  const mat = l.material.trim();
  if (mat) {
    const same = (r.fuel ?? '').toLowerCase() === mat.toLowerCase();
    gaps.push({ axis: 'material', label: 'Material', text: same ? 'same' : (r.fuel ?? 'not reported'), size: same ? 0 : 2 });
  }
  return gaps;
}

export function fmtG(g: number): string {
  if (g === 0) return '0 g';
  return `${g.toLocaleString('en-US', { maximumFractionDigits: g < 1 ? 3 : 1 })} g`;
}

// ------------------------------------------------------------------ plain language

export type Plain = 'measured' | 'nearby' | 'beyond';

export const PLAIN: Record<Plain, { label: string; short: string; help: string }> = {
  measured: { label: 'Historical match', short: 'Existing NASA records pass the applicability rules for this question', help: 'This identifies previously recorded matching tests. It does not certify a spacecraft design or predict a new fire.' },
  nearby: { label: 'Related records', short: 'Related tests exist but require caveats', help: 'Existing tests are relevant, but at least one rule has a caveat such as assumed atmosphere or a gravity gap.' },
  beyond: { label: 'No matching flight test', short: 'No existing flight-test record passes the applicability rules', help: 'This is a comparison to historical PSI data, not the result of a newly performed test. It cannot establish a combustion outcome.' },
};

const OUTCOME_TEXT: Record<string, string> = {
  ignited_flame_spread: 'ignited, flame spread',
  ignited_burned: 'ignited and burned',
  burned: 'burned',
  self_extinguished: 'went out by itself',
  no_ignition: 'did not ignite',
  hot_flame_ignited: 'hot flame ignited',
  hot_ignition: 'hot ignition',
  jet_flame_established: 'jet flame established',
  non_flaming_pyrolysis: 'heated, no flame (smoke test)',
  unknown: 'outcome not recorded',
  not_applicable: 'no flame endpoint',
};

const TERMINAL_TEXT: Record<string, string> = {
  flow_turned_off: 'then airflow was turned off',
  extinguished_at_reduced_flow: 'then went out when flow was reduced',
  self_extinguished: 'then went out',
  burned_out: 'then burned out',
  extinguished: 'then went out',
};

export function outcomeText(outcome: string, terminal?: string | null): string {
  const a = OUTCOME_TEXT[outcome] ?? outcome.replace(/_/g, ' ');
  const b = terminal && terminal !== outcome ? TERMINAL_TEXT[terminal] ?? terminal.replace(/_/g, ' ') : '';
  return b ? `${a}; ${b}` : a;
}

/**
 * A note when the test protocol changed conditions during the burn, so the recorded outcome belongs to that
 * sequence rather than to a burn at constant conditions.
 */
export function protocolNote(outcome: string, terminal?: string | null): string | null {
  const t = terminal ?? '';
  if (t === 'extinguished_at_reduced_flow') return 'Airflow was reduced step by step during this test until the flame went out. The result describes that sequence, not a burn at the airflow listed.';
  if (t === 'flow_turned_off') return 'The crew turned the airflow off during this test. The end of the burn was an operator action, not a measured extinction limit.';
  if (t === 'extinguished_by_N2' || outcome === 'extinguished_by_N2') return 'A nitrogen jet was applied to put the flame out. The result describes suppression, not natural extinction.';
  if (t === 'blowoff') return 'Airflow was raised until the flame blew off. The result describes that sequence, not a burn at the airflow listed.';
  return null;
}

export const fmt = (v: number | null | undefined, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(d));
export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const kpaToPsi = (k: number) => k / 6.894757;
