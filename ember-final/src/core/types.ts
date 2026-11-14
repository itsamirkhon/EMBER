/**
 * Authoritative domain contracts for EMBER v2.
 * Pure TypeScript types — illegal states are ruled out by construction:
 * - Gas concentrations require an explicit physical role (ambient vs oxidizer_stream vs fuel vs diluent).
 * - Gravity specifications carry regime + platform + mode (actual_flight vs simulated_analogue vs ground_1g).
 * - Test outcomes are represented via stage-bound ProtocolSteps and Events (never collapsed binary BURN).
 * - Every ScientificValue carries explicit provenance (reported | series_level | derived | assumed | unknown).
 */

export type FuelPhase = 'solid' | 'liquid' | 'gas';
export type Family = 'ACME-CIR' | 'MDCA-CIR' | 'MSG-SPICE' | 'Saffire-Cygnus' | 'SAME-MSG' | 'other';
export type Direction = 'prevention' | 'detection' | 'suppression' | 'fundamental';
export type Range = [number, number] | null;

export type Provenance = 'reported' | 'series_level' | 'derived' | 'assumed' | 'unknown';
export type GasRole = 'ambient' | 'oxidizer_stream' | 'fuel' | 'diluent';

export interface SourceLocator {
  page?: number | null;
  table?: string | null;
  row?: number | null;
  cell?: string | null;
  section?: string | null;
}

export interface SourceRef {
  sourceId: string;
  url: string | null;
  doi: string | null;
  fileHash?: string | null;
  corpusVersion?: string;
  locator?: SourceLocator;
  quote?: string | null;
  context?: string | null;
}

export interface ScientificValue<T extends number | string = number | string> {
  value: T | null;
  unit: string;
  originalValue?: string | number | null;
  originalUnit?: string | null;
  role?: GasRole | string;
  provenance: Provenance;
  sourceRef?: SourceRef;
}

/** Gas concentration value where physical role is mandatory to prevent ambient vs burner stream conflation. */
export interface GasValue extends ScientificValue<number> {
  role: GasRole;
}

export type FlowDirection = 'concurrent' | 'opposed' | 'quiescent' | 'axial_stagnation' | 'coflow' | 'unknown';
export type FlowHistory = 'steady' | 'stepped_down' | 'stepped_up' | 'abrupt_cutoff' | 'pulsed' | 'unknown';

export interface FlowSpec {
  initialFlowCmS: ScientificValue<number>;
  direction: FlowDirection;
  history: FlowHistory;
  sequenceCmS?: number[];
}

export type GravityRegime = 'microgravity' | 'partial_gravity' | 'normal_gravity';
export type GravityPlatform =
  | 'ISS'
  | 'Cygnus'
  | 'DropTower'
  | 'ParabolicFlight'
  | 'Ground1g'
  | 'SimulatedAnalogue'
  | 'Unknown';
export type GravityMode = 'actual_flight' | 'simulated_analogue' | 'ground_1g';

export interface GravitySpec {
  gravityG: ScientificValue<number>;
  regime: GravityRegime;
  platform: GravityPlatform;
  mode: GravityMode;
}

export type StageType =
  | 'preparation'
  | 'ignition'
  | 'steady_burn'
  | 'flow_modification'
  | 'gas_intervention'
  | 'aging'
  | 'termination';

export type InterventionType =
  | 'none'
  | 'igniter_energized'
  | 'flow_stepped_down'
  | 'flow_stepped_up'
  | 'flow_shutoff'
  | 'n2_jet_applied'
  | 'suppressant_added'
  | 'sample_reused'
  | 'heater_cutoff'
  | 'unknown';

export interface ProtocolStep {
  segmentId: string;
  testId: string;
  order: number;
  timeStartS: number | null;
  timeEndS: number | null;
  stageType: StageType;
  description: string;
  flowCmS: ScientificValue<number>;
  o2Pct: ScientificValue<number>;
  pressureKpa: ScientificValue<number>;
  intervention: InterventionType;
  sourceRef: SourceRef;
}

export type TargetEndpoint =
  | 'flame_establishment'
  | 'sustained_spread'
  | 'extinction_under_flow_change'
  | 'blowoff_limit'
  | 'quench_limit'
  | 'spread_rate'
  | 'burning_rate_constant'
  | 'hot_flame_extinction'
  | 'cool_flame_continuation'
  | 'smoke_particle_size'
  | 'smoke_point_length'
  | 'suppressant_extinction';

export interface TestEvent {
  id: string;
  testId: string;
  segmentId: string;
  endpoint: TargetEndpoint;
  eventType: string;
  observedValue: ScientificValue;
  sensorOrMethod: string | null;
  sourceRef: SourceRef;
}

export interface AtmosphereSpec {
  o2: GasValue;
  pressure: ScientificValue<number>;
  diluent: string | null;
  diluentPct: ScientificValue<number>;
}

export interface Test {
  testId: string;
  inv: string;
  seriesId: string;
  sampleId: string;
  groupId: string;
  fuel: string | null;
  fuelPhase: FuelPhase | null;
  geometry: string | null;
  thicknessMm: ScientificValue<number>;
  diameterMm: ScientificValue<number>;
  widthCm: ScientificValue<number>;
  substrateConfinement: string | null;
  orientation: string | null;
  atmosphere: AtmosphereSpec;
  flow: FlowSpec;
  gravity: GravitySpec;
  initialOutcome: string;
  terminalEvent: string | null;
  outcomeRaw: string | null;
  segments: ProtocolStep[];
  events: TestEvent[];
  spreadRateMmS: ScientificValue<number>;
  burningRateMm2S: ScientificValue<number>;
  particleSizeNm: ScientificValue<number>;
  smokePointLengthMm: ScientificValue<number>;
  extra: Record<string, unknown>;
  sourceRef: SourceRef;
}

export interface SourceLink {
  id?: string;
  label: string;
  url: string;
  type?: string;
}

export interface CoverageSummary {
  totalRows: number;
  withObservedOutcome: number;
  withNumericTarget: number;
  withProtocolSegments: number;
  completenessNote: string;
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
    assumed?: string[];
    assumptionNote?: string;
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
  sources: SourceLink[];
  dataNotes: string[];
  methodSummary: string;
  limitations: string[];
  epistemicStatus: 'observed' | 'planned_only';
  verificationStatus: 'verified' | 'preliminary_team_reviewed';
  coverageSummary: CoverageSummary;
}

export type ClaimEpistemicStatus =
  | 'observed'
  | 'planned'
  | 'hypothesis'
  | 'source_interpretation'
  | 'derived_interpretation';

export interface Claim {
  id: string;
  inv: string | null;
  text: string;
  epistemicStatus: ClaimEpistemicStatus;
  evidenceIds: string[];
  conditionsScope: string;
  limitations: string[];
  verificationStatus: 'verified' | 'quote_checked' | 'corrected' | 'preliminary';
  sourceRef: SourceRef;
  topics: string[];
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
  assumptionDetail?: Record<string, boolean | null>;
  sources: SourceLink[];
}

export interface StoryItem {
  id: string;
  title: string;
  summary: string;
  linkedInvestigations: string[];
  sources: SourceLink[];
  year?: string | number | null;
}

export interface SourceRecord {
  sourceId: string;
  title?: string;
  url: string | null;
  doi?: string | null;
  type?: string;
  fileHash?: string | null;
  notes?: string | null;
}

export interface CorpusV2 {
  corpusVersion: string;
  generatedAt: string;
  investigations: Investigation[];
  tests: Test[];
  claims: Claim[];
  missions: Mission[];
  earth: StoryItem[];
  history: StoryItem[];
  sources: SourceRecord[];
  extractionEval: Record<string, unknown>;
  outcomeAudit: Record<string, unknown>;
}

export interface ChunkRecord {
  chunkId: string;
  kind: string;
  inv: string | null;
  testId: string | null;
  epistemicStatus: string;
  sectionHeader: string | null;
  tableUnits: string | null;
  text: string;
  vector: number[];
  sourceRef: SourceRef;
}

export interface ChunksIndex {
  corpusVersion: string;
  embeddingModel: string;
  embeddingDim: number;
  vocabulary: Record<string, number>;
  idf: number[];
  svdComponents: number[][];
  chunks: ChunkRecord[];
}

// ---------------------------------------------------------------------------
// Query & Scientific Engine Domain Contracts

export type HabitableEnvironment =
  | 'iss'
  | 'spacecraft'
  | 'lunar_base'
  | 'lunar_rover'
  | 'mars_base'
  | 'eva_suit'
  | 'custom';

export type SafetyTask =
  | 'material_screening'
  | 'ventilation_setting'
  | 'smoke_detection'
  | 'fire_suppression'
  | 'atmosphere_selection'
  | 'general_comparison';

export type EnclosureScale = 'small_duct' | 'large_enclosure' | 'chamber';

export interface ResearchQuery {
  rawQuestion: string;
  habitableEnvironment: HabitableEnvironment;
  safetyTask: SafetyTask;
  targetEndpoint: TargetEndpoint | null;
  fuelPhase: FuelPhase | null;
  material: string | null;
  geometry: string | null;
  thicknessMm: number | null;
  diameterMm: number | null;
  o2Pct: number | null;
  o2Role: GasRole;
  pressureKpa: number | null;
  flowCmS: number | [number, number] | null;
  flowDirection: FlowDirection | null;
  flowHistory: FlowHistory | null;
  gravityG: number | null;
  gravityRegime: GravityRegime | null;
  platform: GravityPlatform | null;
  requestedMode: GravityMode | null;
  enclosureScale: EnclosureScale | null;
  unknownFields: string[];
  validationWarnings: string[];
  targetInvIds?: string[];
}

export type RuleId =
  | 'RULE-EP-01'
  | 'RULE-MAT-01'
  | 'RULE-GEOM-01'
  | 'RULE-UNK-01'
  | 'RULE-GAS-01'
  | 'RULE-PROV-01'
  | 'RULE-GRAV-01'
  | 'RULE-PROT-01'
  | 'RULE-JOINT-01';

export type ApplicabilityVerdict = 'admissible' | 'conditional_support' | 'inadmissible' | 'planned_only';

export interface RuleEvaluation {
  ruleId: RuleId;
  status: 'pass' | 'conditional' | 'fail';
  reason: string;
  detail?: string;
}

export interface MatchedProtocolSegment {
  matchedSegmentIds: string[];
  matchedEventIds: string[];
  endpointMatched: boolean;
  operatorTerminated: boolean;
  coolFlamePresent: boolean;
  hotFlameExtinguished: boolean;
  flowHistoryMismatch: boolean;
  segmentSummary: string;
  matchedOutcomeLabel: string | null;
  warnings: string[];
}

export interface ApplicabilityDecision {
  testId: string;
  inv: string;
  groupId: string;
  verdict: ApplicabilityVerdict;
  admissible: boolean;
  conditional: boolean;
  reasonCodes: string[];
  rules: RuleEvaluation[];
  protocolMatch: MatchedProtocolSegment;
  jointDistance: number | null;
  marginalOverlapButJointMissing: boolean;
  matchedFactors: string[];
  changedFactors: string[];
  unknownFactors: string[];
  sourceRef?: SourceRef;
}

export interface InvestigationRankV2 {
  inv: Investigation;
  relevanceScore: number;
  applicabilityScore: number;
  evidenceQualityScore: number;
  overallScore: number;
  status: ApplicabilityVerdict;
  admissibleCount: number;
  conditionalCount: number;
  inadmissibleCount: number;
  topReasonCodes: string[];
  unsupportedJointWarning: boolean;
}

export interface Contrast {
  id: string;
  testAId: string;
  testBId: string;
  invA: string;
  invB: string;
  matchedFactors: string[];
  changedFactors: { factor: string; valueA: string; valueB: string }[];
  unknownFactors: string[];
  outcomeComparison: string;
  causalWarning: string;
}

export interface DependencyEdge {
  id: string;
  fromParameter: string;
  ruleId: RuleId | string;
  affectedTestIds: string[];
  affectedInvIds: string[];
  conclusionId: string;
  status: 'retained' | 'weakened' | 'invalidated';
  reason: string;
}

export interface DesignVariantPatch {
  thicknessMm?: number | null;
  flowDirection?: FlowDirection | null;
  flowCmS?: number | [number, number] | null;
  o2Pct?: number | null;
  pressureKpa?: number | null;
  gravityG?: number | null;
  material?: string | null;
  geometry?: string | null;
  o2Role?: GasRole;
  targetEndpoint?: TargetEndpoint | null;
  enclosureScale?: EnclosureScale | null;
}

export interface ImpactChainItem {
  changedParameter: string;
  affectedRuleOrEvidence: string;
  conclusionChange: string;
  severity: 'retained' | 'weakened' | 'invalidated';
}

export interface DesignVariantResult {
  baseQuery: ResearchQuery;
  updatedQuery: ResearchQuery;
  patch: DesignVariantPatch;
  retainedEdges: DependencyEdge[];
  weakenedEdges: DependencyEdge[];
  invalidatedEdges: DependencyEdge[];
  impactChains: ImpactChainItem[];
  updatedDecisions: ApplicabilityDecision[];
  updatedRankings: InvestigationRankV2[];
  verdictDelta: {
    becameAdmissible: string[];
    becameConditional: string[];
    becameInadmissible: string[];
  };
}

// ---------------------------------------------------------------------------
// Retrieval & JEV Contracts

export type RetrievalMode = 'bm25' | 'hybrid' | 'structured';

export interface RetrievalHit {
  chunk: ChunkRecord;
  score: number;
  bm25Score: number;
  denseScore: number;
  structuredScore: number;
  matchedTerms: string[];
  rank: number;
}

export type JevQuestionId = 'Q1_RELEVANCE' | 'Q2_OBSERVATION' | 'Q3_CONTRADICTION';
export type JevRoute = 'evidence' | 'context' | 'conflict';

export type Q1Answer = 'direct_match' | 'partial_context' | 'not_relevant';
export type Q2Answer = 'observed_finding' | 'planned_or_hypothesis' | 'method_or_assumption';
export type Q3Answer = 'consistent' | 'tension_or_conflict' | 'insufficient_to_judge';

export interface JevQuestionScore<T extends string> {
  answer: T;
  probabilities: Record<T, number>;
  confidence: number;
}

export interface JevPassageDecision {
  chunkId: string;
  inv: string | null;
  testId: string | null;
  q1Relevance: JevQuestionScore<Q1Answer>;
  q2Observation: JevQuestionScore<Q2Answer>;
  q3Contradiction: JevQuestionScore<Q3Answer>;
  route: JevRoute;
  concentrationConfidence: number;
  promptVersion: 'jev-v1.0' | 'heuristic-triage-v1' | 'decision-v1.0';
  evaluatorMode: 'deterministic_offline' | 'live_openai' | 'live_openrouter';
  model?: string;
  responseId?: string;
  latencyMs: number;
  sourceRef: SourceRef;
}

export interface EvidencePackage {
  query: ResearchQuery;
  retrievedHits: RetrievalHit[];
  jevDecisions: JevPassageDecision[];
  evidenceChunks: JevPassageDecision[];
  contextChunks: JevPassageDecision[];
  conflictChunks: JevPassageDecision[];
  applicabilityDecisions: ApplicabilityDecision[];
  rankings: InvestigationRankV2[];
  contrasts: Contrast[];
  gaps: string[];
  evaluatedTests?: Test[];
}

// ---------------------------------------------------------------------------
// Planner, Synthesis, Verifier, Prediction, Review Contracts

export interface TestBlock {
  blockId: string;
  title: string;
  category: 'mandatory_control' | 'gap_filling' | 'boundary_bracket' | 'replicate_verification';
  priorityQuestions: string[];
  questionCoverageScore: number;
  runsRequired: number;
  replicatesPerCondition: number;
  isMandatoryControl: boolean;
  conditions: {
    material: string;
    geometry: string;
    o2Pct: number | null;
    pressureKpa: number | null;
    flowCmS: number | null;
    gravityG: number | null;
    targetEndpoint: TargetEndpoint | null;
  };
  rationale: string;
  addressesGap: string;
}

export interface TestProgramme {
  budgetRuns: number;
  usedRuns: number;
  remainingRuns: number;
  totalCoverageScore: number;
  selectedBlocks: TestBlock[];
  excludedBlocks: TestBlock[];
  mandatoryControlsPreserved: boolean;
  replicatesPreserved: boolean;
  optimizerMethod: 'exact_branch_and_bound';
  epistemicNote: string;
}

export type SynthesisMode = 'LIVE_AI' | 'DETERMINISTIC_ENGINE' | 'SAVED_DEMO_SNAPSHOT';

export type AnswerBoundary =
  | 'sufficient_observed'
  | 'conditional_or_partial'
  | 'insufficient_data'
  | 'invalid_premise';

export interface SynthesisClaimItem {
  id: string;
  text: string;
  citations: string[];
  provenance: Provenance | 'planned' | 'interpretation';
}

export interface ConflictSummaryItem {
  chunkId: string;
  inv: string | null;
  summary: string;
  sourceRef: SourceRef;
}

export interface GeneratedSynthesis {
  mode: SynthesisMode;
  answerBoundary: AnswerBoundary;
  observedFact: SynthesisClaimItem[];
  authorInterpretation: SynthesisClaimItem[];
  engineeringImplication: SynthesisClaimItem[];
  applicabilityConditions: string[];
  openQuestions: string[];
  conflictsPreserved: ConflictSummaryItem[];
  rawSummary: string;
  modelName?: string | null;
}

export interface VerificationCheckResult {
  passed: boolean;
  issues: string[];
}

export interface VerificationReport {
  passed: boolean;
  citationCheck: VerificationCheckResult;
  numericUnitCheck: VerificationCheckResult;
  epistemicCheck: VerificationCheckResult;
  constraintPreservationCheck: VerificationCheckResult;
  lexicalEntailmentCheck: VerificationCheckResult;
  flaggedClaimIds: string[];
}

export type PredictionTarget = 'spreadRateMmS' | 'particleSizeNm' | 'smokePointLengthMm' | 'burningRateMm2S';

export interface DomainPrediction {
  target: PredictionTarget;
  unit: string;
  status: 'predicted' | 'refused_out_of_domain' | 'refused_insufficient_data' | 'refused_below_baseline';
  refused: boolean;
  refusalReasons: string[];
  method: 'domain_gated_knn_ridge';
  predictedValue: number | null;
  interval: [number, number] | null;
  nTrainGroups: number;
  nTrainRows: number;
  cvMae: number | null;
  baselineInvMeanMae: number | null;
  baselineGlobalMeanMae: number | null;
  beatsBaseline: boolean;
  nearestNeighbours: {
    testId: string;
    inv: string;
    groupId: string;
    distance: number;
    value: number;
  }[];
}

export interface RunEnvelope {
  runId: string;
  timestamp: string;
  corpusVersion: string;
  engineVersion: string;
  mode: SynthesisMode;
  jevPromptVersion: JevPassageDecision['promptVersion'];
  decisionModel?: string;
  embeddingModel?: string;
  embeddingDim?: number;
  retrievalMode: RetrievalMode;
  timingMs: {
    parse: number;
    retrieve: number;
    jev: number;
    applicability: number;
    synthesis: number;
    verify: number;
    plan: number;
    predict: number;
    total: number;
  };
}

export interface Review {
  query: ResearchQuery;
  evidencePackage: EvidencePackage;
  dependencies: DependencyEdge[];
  synthesis: GeneratedSynthesis;
  verification: VerificationReport;
  testProgramme: TestProgramme;
  predictions: DomainPrediction[];
  envelope: RunEnvelope;
}
