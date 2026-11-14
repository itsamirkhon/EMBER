// Types transcribed from SPEC.md. Parsed once at the boundary (see parse.ts).
export type SVKind = 'reported' | 'series' | 'derived' | 'assumed' | 'unknown';
export interface SourceRef { source_id: string; url: string; locator: string; quote: string | null }
export interface ScientificValue {
  kind: SVKind;
  value: number | string | null;
  unit: string | null;
  role: string | null;
  source_ref: SourceRef | null;
}
export type Verification = 'provisional' | 'verified' | string;
export type Mode = 'live_ai' | 'deterministic' | 'saved_example';
export type Topic = 'prevention' | 'detection' | 'suppression';

export interface Meta {
  version: string; corpus_version: string; rules_version: string; mode: Mode;
  flags: { jev: boolean; dense: boolean; live_ai: boolean };
  coverage: { deep: string[]; catalog: string[] };
  saved_example_id: string | null; recovered_runs: number;
}

export interface InvestigationCard {
  id: string; name: string; summary_goal: string; platform: string; families: string[];
  materials: string[]; topics: string[]; status: string; verification: Verification;
  coverage: 'deep' | 'catalog'; score: number; why: string; n_tests: number;
}

export interface Geometry { shape: string | null; thickness_mm: ScientificValue; width_mm: ScientificValue; diameter_mm: ScientificValue }
export interface ProtocolStep { order: number; kind: string; description: string; time_s: ScientificValue; source_ref: SourceRef | null }
export interface TestEvent { kind: string; step_order: number | null; time_s: ScientificValue; source_ref: SourceRef | null; observed: boolean; note: string }
export interface Measurement { name: string; unit: string | null; kind: string; description: string; source_ref: SourceRef | null }
export interface TestRecord {
  id: string; investigation_id: string; series: string | null; sample_id: string | null;
  material: string; phase: string | null; geometry: Geometry;
  substrate_confinement: string | null; orientation: string | null;
  atmosphere: { o2_fraction: ScientificValue; pressure_kpa: ScientificValue; diluent: ScientificValue };
  gravity: { regime: string; platform: string | null; actual: boolean; value_g: ScientificValue };
  flow: { direction: ScientificValue; initial_velocity_cm_s: ScientificValue; history_summary: string | null; history_kind: string | null };
  protocol: ProtocolStep[]; events: TestEvent[]; measurements: Measurement[];
  observation_status: string; events_complete: boolean; record_type: string; curation_note: string; verification: Verification;
}
export interface SummaryEntry { text: string; items: string[]; source_refs: SourceRef[]; verification: Verification; extra: Record<string, unknown> }
export interface InvestigationSummary {
  goal: SummaryEntry; method: SummaryEntry; materials: SummaryEntry; conditions_range: SummaryEntry;
  measurements: SummaryEntry; key_results: SummaryEntry; limitations: SummaryEntry;
}
export interface TextChunk { id: string; section: string; text: string }
export interface CorpusClaim { id: string; text: string; type: string; evidence: string[]; conditions: Record<string, unknown>; limitations: string[]; verification: Verification }
export interface InvestigationFull {
  id: string; name: string; summary_goal: string; platform: string; families: string[];
  materials: string[]; measurements: string[]; topics: string[]; status: string; verification: Verification;
  coverage: 'deep' | 'catalog'; sources: SourceRef[]; limitations: string[]; tests: string[];
  text_chunks: TextChunk[]; test_records: TestRecord[]; claims: CorpusClaim[]; summary: InvestigationSummary;
}
export interface SourceManifest { id: string; url: string; title: string; retrieved: string; hash: string; type: string }

export type Environment = 'iss' | 'gateway' | 'lunar_base' | 'mars_transit' | 'rover' | 'other';
export type Endpoint =
  | 'ignition' | 'flame_establishment' | 'sustained_spread' | 'extinction_under_flow_reduction'
  | 'cool_burning' | 'smoke_detection' | 'suppression';
export interface QueryConfig {
  o2_role: 'ambient' | 'oxidizer_stream' | null; substrate: string | null; flow_history: 'constant' | 'stepwise_reduction' | 'continuous_ramp' | null;
  material: string | null; shape: string | null; thickness_mm: number | null; o2_fraction: number | null;
  pressure_kpa: number | null; gravity_regime: string | null;
  flow_direction: 'concurrent' | 'opposed' | 'quiescent' | null;
  flow_velocity_cm_s: number | null; ignition: string | null;
}
export interface ResearchQuery { question: string; environment: Environment; topic: string | null; endpoint: Endpoint | null; config: QueryConfig }
export interface ParsedQuery { query: ResearchQuery; missing: string[]; confirm: string[] }

export interface RunStatus { run_id: string; status: 'queued' | 'running' | 'done' | 'error'; stage: string | null; error: string | null; review_id: string | null }
export interface RunCreated { run_id: string; review_id: string }

export interface QualityInfo { level: string; verification: string; coverage: string; factors: string[]; note: string }
export interface RankingItem { investigation_id: string; relevance: number; applicability_summary: Record<string, number>; quality: QualityInfo; why: string }
export type DecisionStatus = 'direct' | 'limited_context' | 'incompatible' | 'insufficient_data';
export interface Ground { rule_id: string; field: string; effect: 'pass' | 'fail' | 'unknown'; text: string }
export interface ApplicabilityDecision { test_id: string; status: DecisionStatus; grounds: Ground[]; unknown_fields: string[]; rule_version: string }
export interface TestConsidered { test_id: string; endpoint_support: string; decisions: ApplicabilityDecision[] }
export interface Contrast {
  id: string; test_a: string; test_b: string; question: string; allowed: boolean;
  changed_factors: string[]; shared: string[]; unknown: string[]; statement: string; rule_ids: string[];
}
export type ClaimStatus = 'supported' | 'needs_new_comparison' | 'not_applicable';
export interface ReviewClaim {
  id: string; text: string; type: string; evidence: string[]; rule_ids: string[];
  conditions: Record<string, unknown>; status: ClaimStatus; why: string; depends_on_fields: string[];
}
export interface Insight {
  id: string; topic: string; observation: string; interpretation: string; possible_application: string;
  conditions: Record<string, unknown>; open_questions: string[]; claim_ids: string[];
}
export interface OpenQuestion { id: string; kind: string; text: string; field: string | null; endpoint: string | null; test_ids: string[] }
export interface TestBlock {
  id: string; question_id: string; target: Record<string, unknown>; control: Record<string, unknown>; fixed: Record<string, unknown>; changed: Record<string, unknown>; covers: string[];
  endpoint: string; measurements: string[]; replicates: number; replicate_rationale: string;
  equipment: string[]; runs: number; assumptions: string[];
}
export interface TestProgramme {
  blocks: TestBlock[]; selected: string[]; runs_used: number; budget_runs: number;
  covered: string[]; uncovered: string[]; method: 'exact' | 'greedy'; note: string;
}
export interface Review {
  id: string; revision: number; created: string; query: ResearchQuery; mode: Mode;
  manifest: Record<string, unknown>;
  ranking: RankingItem[]; tests_considered: TestConsidered[]; contrasts: Contrast[];
  claims: ReviewClaim[]; safety_insights: Insight[]; conflicts: unknown[]; limitations: string[];
  open_questions: OpenQuestion[]; programme: TestProgramme | null; warnings: string[];
  explanation: Explanation | null; parent_id: string | null; variant_patch: Record<string, unknown> | null;
}
export interface Explanation { mode: Mode; summary: string; paragraphs: string[]; warnings: string[]; model: string | null }
export interface ReviewListItem { id: string; created: string; mode: Mode; question: string; revision: number; endpoint: string | null; parent_id: string | null }
export interface RevisionItem { revision: number; created: string; reason: string }
export interface RuleInfo { id: string; title: string; severity: string; description: string; heuristic: boolean }
export interface RulesDoc { rules_version: string; rules: RuleInfo[]; endpoint_requirements: Record<string, Record<string, unknown>> }
export interface DiffEntry { claim_id: string; before: string | null; after: string | null; changed_parameter: string; reason: string }
export interface VariantResult { variant_id: string; diff: DiffEntry[]; review: Review }

export interface ReplaySegment { label: string; kind: string; time_s: number | null; order: number }
export interface Replay { segments: ReplaySegment[]; events: TestEvent[]; measurements: Measurement[]; disclaimer: string }
export interface EvalSummary { status: 'measured' | 'not_measured'; [k: string]: unknown }

export interface ApiErrorEnvelope { error: { code: string; message: string } }
