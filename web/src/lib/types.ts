// Types mirroring docs/DATA_CONTRACT.md. Keep in sync with the contract.

export type FuelPhase = 'solid' | 'liquid' | 'gas';
export type Family = 'ACME-CIR' | 'MDCA-CIR' | 'MSG-SPICE' | 'Saffire-Cygnus' | 'SAME-MSG' | 'other';
export type Direction = 'prevention' | 'detection' | 'suppression' | 'fundamental';
export type Range = [number, number] | null;

export interface Source {
  id?: string;
  label: string;
  url: string;
  type?: 'psi' | 'ntrs' | 'doi' | 'nasa-web' | 'paper' | string;
}

export interface Investigation {
  id: string;
  name: string;
  psi: string | null;
  psiUrl: string | null;
  doi: string | null;
  doiVerified: boolean;
  family: Family | string;
  hardware: string | null;
  platform: string | null;
  fuelPhase: FuelPhase | null;
  direction: Direction[];
  safetyConsequence: number;
  objective: string | null;
  fuel: { types: string[]; geometry: string | null; size: string | null } | null;
  conditions: {
    o2Pct: Range;
    pressureKpa: Range;
    flowCmS: Range;
    gravityG: Range;
    diluents: string[] | null;
  } | null;
  varied: string[];
  constant: string[];
  diagnostics: string[];
  resultSummary: string | null;
  keyFindings: { text: string; sourceId: string | null }[];
  nTests: number | null;
  flight: boolean | null;
  rawDataAvailable: boolean | null;
  years: string | null;
  earthRelevance?: string | null;
  sources: Source[];
  dataNotes: string[];
}

export type Outcome =
  | 'burned'
  | 'extinguished'
  | 'no_ignition'
  | 'flame_spread'
  | 'self_extinguished'
  | 'completed'
  | 'disruption'
  | 'unknown';

export interface TestRow {
  inv: string;
  testId: string;
  fuel: string | null;
  fuelPhase: FuelPhase | null;
  geometry: string | null;
  thicknessMm: number | null;
  diameterMm: number | null;
  o2Pct: number | null;
  pressureKpa: number | null;
  flowCmS: number | null;
  gravityG: number | null;
  diluent: string | null;
  diluentPct: number | null;
  outcome: Outcome | string;
  outcomeRaw: string | null;
  spreadRateMmS: number | null;
  burningRateMm2S: number | null;
  particleSizeNm: number | null;
  /** SPICE-style smoke-point flame length; optional until the data pipeline publishes it */
  smokePointLengthMm?: number | null;
  /** extra.outcomeDerivation (optional): "source-table" | "report" | "keyword-rule" */
  extra: Record<string, unknown>;
  source: { sourceId: string | null; file: string | null; row: number | null };
}

export interface Mission {
  id: string;
  label: string;
  o2Pct: number | null;
  pressureKpa: number | null;
  flowCmS: number | [number, number] | null;
  gravityG: number | null;
  notes?: string | null;
  assumption: boolean;
  sources: Source[];
}

export interface Claim {
  id: string;
  inv: string | null;
  text: string;
  quote: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  topic: string[];
  extractedBy: 'llm' | 'manual' | string;
}

export interface ExtractionEval {
  method: string;
  n: number;
  correct: number;
  partial: number;
  wrong: number;
  items: { claimId: string; goldText: string; llmText: string; verdict: 'correct' | 'partial' | 'wrong'; note?: string | null }[];
}

export interface StoryItem {
  id: string;
  title: string;
  summary: string;
  linkedInvestigations: string[];
  sources: Source[];
  year?: string | number | null;
}

export interface BacktestDetail {
  [k: string]: unknown;
}

export interface Backtest {
  name: string;
  description?: string;
  n: number;
  correct: number;
  details: BacktestDetail[];
  [k: string]: unknown;
}

export interface Validation {
  generatedAt: string;
  dataset?: string;
  method?: string;
  backtests: Backtest[];
  physicsModel: Record<string, unknown> | null;
  /** numeric-target backtests (kNN regression), see evidence.leaveOneOutNumeric */
  numeric?: Record<string, unknown>[];
  /** rows per investigation and what they can be used for, see evidence.dataCoverage */
  coverage?: Record<string, unknown>;
  /** plain-language summary numbers for the Trust page headline */
  headline?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
}

export interface DatasetsManifest {
  generatedAt: string;
  files: { inv: string; file: string; url: string; sha256: string; rows: number; license: string }[];
}
