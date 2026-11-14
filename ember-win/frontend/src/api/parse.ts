// Tiny hand-written validators. Every API response is parsed once here;
// the rest of the app only sees typed, normalised data.
import type * as T from './types';

export class ParseError extends Error {
  constructor(public path: string, expected: string, got: unknown) {
    super(`Malformed API response at ${path}: expected ${expected}, got ${describe(got)}`);
    this.name = 'ParseError';
  }
}
function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

export type P<X> = (v: unknown, path: string) => X;
type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export const str: P<string> = (v, p) => { if (typeof v !== 'string') throw new ParseError(p, 'string', v); return v; };
export const num: P<number> = (v, p) => { if (typeof v !== 'number' || Number.isNaN(v)) throw new ParseError(p, 'number', v); return v; };
export const bool: P<boolean> = (v, p) => { if (typeof v !== 'boolean') throw new ParseError(p, 'boolean', v); return v; };
export const unk: P<unknown> = (v) => v;
export const nullable = <X,>(f: P<X>): P<X | null> => (v, p) => (v === null || v === undefined ? null : f(v, p));
export const arr = <X,>(f: P<X>): P<X[]> => (v, p) => {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new ParseError(p, 'array', v);
  return v.map((x, i) => f(x, `${p}[${i}]`));
};
export const oneOf = <X extends string>(vals: readonly X[]): P<X> => (v, p) => {
  if (typeof v !== 'string' || !vals.includes(v as X)) throw new ParseError(p, vals.join('|'), v);
  return v as X;
};
/** Accepts any string but keeps unknown enum members visible rather than failing. */
export const looseStr = (def: string): P<string> => (v) => (typeof v === 'string' ? v : def);
export const withDefault = <X,>(f: P<X>, def: X): P<X> => (v, p) => (v === undefined || v === null ? def : f(v, p));
export const record = <X,>(f: P<X>): P<Record<string, X>> => (v, p) => {
  if (v === null || v === undefined) return {};
  if (!isRec(v)) throw new ParseError(p, 'object', v);
  const out: Record<string, X> = {};
  for (const k of Object.keys(v)) out[k] = f(v[k], `${p}.${k}`);
  return out;
};
const scalar: P<string | number | null> = (v, p) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'boolean') return String(v);
  throw new ParseError(p, 'scalar', v);
};
export function obj<S extends Record<string, P<unknown>>>(shape: S): P<{ [K in keyof S]: ReturnType<S[K]> }> {
  return (v, p) => {
    if (!isRec(v)) throw new ParseError(p, 'object', v);
    const out: Rec = {};
    for (const k of Object.keys(shape)) out[k] = shape[k](v[k], `${p}.${k}`);
    return out as { [K in keyof S]: ReturnType<S[K]> };
  };
}

// ---- domain parsers ---------------------------------------------------------
export const sourceRef: P<T.SourceRef> = obj({
  source_id: str, url: withDefault(str, ''), locator: withDefault(str, ''), quote: nullable(str),
});
export const svKinds = ['reported', 'series', 'derived', 'assumed', 'unknown'] as const;
const rawSV: P<T.ScientificValue> = obj({
  kind: oneOf(svKinds), value: scalar, unit: nullable(str), role: nullable(str), source_ref: nullable(sourceRef),
});
/** Missing/null value is explicitly an unknown ScientificValue, never a number. */
export const unknownSV = (): T.ScientificValue => ({ kind: 'unknown', value: null, unit: null, role: null, source_ref: null });
export const sv: P<T.ScientificValue> = (v, p) => {
  if (v === undefined || v === null) return unknownSV();
  const x = rawSV(v, p);
  if (x.kind === 'unknown') return { ...x, value: null };
  return x;
};

export const verification: P<string> = looseStr('provisional');
const mode = oneOf(['live_ai', 'deterministic', 'saved_example'] as const);

export const meta: P<T.Meta> = obj({
  version: str, corpus_version: str, rules_version: str, mode,
  flags: obj({ jev: withDefault(bool, false), dense: withDefault(bool, false), live_ai: withDefault(bool, false) }),
  coverage: obj({ deep: arr(str), catalog: arr(str) }),
  saved_example_id: nullable(str), recovered_runs: withDefault(num, 0),
});

const investigationCard: P<T.InvestigationCard> = obj({
  id: str, name: str, summary_goal: withDefault(str, ''), platform: withDefault(str, ''),
  families: arr(str), materials: arr(str), topics: arr(str), status: looseStr('planned'),
  verification, coverage: oneOf(['deep', 'catalog'] as const), score: withDefault(num, 0), why: withDefault(str, ''), n_tests: withDefault(num, 0),
});
export const investigationList: P<{ items: T.InvestigationCard[] }> = obj({ items: arr(investigationCard) });

const geometry: P<T.Geometry> = (v, p) => {
  const o = isRec(v) ? v : {};
  return {
    shape: nullable(str)(o.shape, `${p}.shape`),
    thickness_mm: sv(o.thickness_mm, `${p}.thickness_mm`),
    width_mm: sv(o.width_mm, `${p}.width_mm`),
    diameter_mm: sv(o.diameter_mm, `${p}.diameter_mm`),
  };
};
const protocolStep: P<T.ProtocolStep> = obj({
  order: num, kind: looseStr('prep'), description: withDefault(str, ''), time_s: sv, source_ref: nullable(sourceRef),
});
const testEvent: P<T.TestEvent> = obj({ kind: str, step_order: nullable(num), time_s: sv, source_ref: nullable(sourceRef), observed: withDefault(bool, true), note: withDefault(str, '') });
const measurement: P<T.Measurement> = obj({
  name: str, unit: nullable(str), kind: looseStr('unknown'), description: withDefault(str, ''), source_ref: nullable(sourceRef),
});
const testRecord: P<T.TestRecord> = (v, p) => {
  if (!isRec(v)) throw new ParseError(p, 'object', v);
  const atm = isRec(v.atmosphere) ? v.atmosphere : {};
  const grav = isRec(v.gravity) ? v.gravity : {};
  const flow = isRec(v.flow) ? v.flow : {};
  return {
    id: str(v.id, `${p}.id`), investigation_id: withDefault(str, '')(v.investigation_id, `${p}.investigation_id`),
    series: nullable(str)(v.series, `${p}.series`), sample_id: nullable(str)(v.sample_id, `${p}.sample_id`),
    material: withDefault(str, 'unknown')(v.material, `${p}.material`), phase: nullable(str)(v.phase, `${p}.phase`),
    geometry: geometry(v.geometry, `${p}.geometry`),
    substrate_confinement: nullable(str)(v.substrate_confinement, `${p}.substrate_confinement`),
    orientation: nullable(str)(v.orientation, `${p}.orientation`),
    atmosphere: { o2_fraction: sv(atm.o2_fraction, `${p}.atmosphere.o2_fraction`), pressure_kpa: sv(atm.pressure_kpa, `${p}.atmosphere.pressure_kpa`), diluent: sv(atm.diluent, `${p}.atmosphere.diluent`) },
    gravity: {
      regime: withDefault(str, 'unknown')(grav.regime, `${p}.gravity.regime`), platform: nullable(str)(grav.platform, `${p}.gravity.platform`),
      actual: withDefault(bool, false)(grav.actual, `${p}.gravity.actual`), value_g: sv(grav.value_g, `${p}.gravity.value_g`),
    },
    flow: {
      direction: sv(flow.direction, `${p}.flow.direction`), initial_velocity_cm_s: sv(flow.initial_velocity_cm_s, `${p}.flow.initial_velocity_cm_s`),
      history_summary: nullable(str)(flow.history_summary, `${p}.flow.history_summary`), history_kind: nullable(str)(flow.history_kind, `${p}.flow.history_kind`),
    },
    protocol: arr(protocolStep)(v.protocol, `${p}.protocol`), events: arr(testEvent)(v.events, `${p}.events`),
    measurements: arr(measurement)(v.measurements, `${p}.measurements`),
    observation_status: looseStr('observed')(v.observation_status, `${p}.observation_status`), events_complete: withDefault(bool, false)(v.events_complete, `${p}.events_complete`),
    record_type: looseStr('series_description')(v.record_type, `${p}.record_type`), curation_note: looseStr('')(v.curation_note, `${p}.curation_note`),
    verification: verification(v.verification, `${p}.verification`),
  };
};

const summaryEntry: P<T.SummaryEntry> = (v, p) => {
  if (!isRec(v)) return { text: '', items: [], source_refs: [], verification: 'provisional', extra: {} };
  const { text, items, source_refs, verification: ver, ...extra } = v;
  return {
    text: withDefault(str, '')(text, `${p}.text`), items: arr(str)(items, `${p}.items`),
    source_refs: arr(sourceRef)(source_refs, `${p}.source_refs`), verification: verification(ver, `${p}.verification`), extra,
  };
};
const corpusClaim: P<T.CorpusClaim> = obj({
  id: str, text: str, type: looseStr('observation'), evidence: arr(str), conditions: record(unk), limitations: arr(str), verification,
});
export const investigationFull: P<T.InvestigationFull> = (v, p) => {
  if (!isRec(v)) throw new ParseError(p, 'object', v);
  const s = isRec(v.summary) ? v.summary : {};
  const strs = arr(str);
  const e = (k: string) => summaryEntry(s[k], `${p}.summary.${k}`);
  return {
    id: str(v.id, `${p}.id`), name: str(v.name, `${p}.name`), summary_goal: withDefault(str, '')(v.summary_goal, `${p}.summary_goal`),
    platform: withDefault(str, '')(v.platform, `${p}.platform`), families: strs(v.families, `${p}.families`),
    materials: strs(v.materials, `${p}.materials`), measurements: strs(v.measurements, `${p}.measurements`), topics: strs(v.topics, `${p}.topics`),
    status: looseStr('planned')(v.status, `${p}.status`), verification: verification(v.verification, `${p}.verification`),
    coverage: oneOf(['deep', 'catalog'] as const)(v.coverage, `${p}.coverage`), sources: arr(sourceRef)(v.sources, `${p}.sources`),
    limitations: strs(v.limitations, `${p}.limitations`), tests: strs(v.tests, `${p}.tests`),
    text_chunks: arr(obj({ id: str, section: withDefault(str, ''), text: str }))(v.text_chunks, `${p}.text_chunks`),
    test_records: arr(testRecord)(v.test_records, `${p}.test_records`), claims: arr(corpusClaim)(v.claims, `${p}.claims`),
    summary: { goal: e('goal'), method: e('method'), materials: e('materials'), conditions_range: e('conditions_range'), measurements: e('measurements'), key_results: e('key_results'), limitations: e('limitations') },
  };
};

export const sourceManifest: P<T.SourceManifest> = obj({
  id: str, url: withDefault(str, ''), title: withDefault(str, ''), retrieved: withDefault(str, ''), hash: withDefault(str, ''), type: withDefault(str, ''),
});

const environments = ['iss', 'gateway', 'lunar_base', 'mars_transit', 'rover', 'other'] as const;
const endpoints = ['ignition', 'flame_establishment', 'sustained_spread', 'extinction_under_flow_reduction', 'cool_burning', 'smoke_detection', 'suppression'] as const;
const flowDirs = ['concurrent', 'opposed', 'quiescent'] as const;
const queryConfig: P<T.QueryConfig> = (v, p) => {
  const o = isRec(v) ? v : {};
  return {
    o2_role: nullable(oneOf(['ambient', 'oxidizer_stream'] as const))(o.o2_role, `${p}.o2_role`), substrate: nullable(str)(o.substrate, `${p}.substrate`),
    flow_history: nullable(oneOf(['constant', 'stepwise_reduction', 'continuous_ramp'] as const))(o.flow_history, `${p}.flow_history`),
    material: nullable(str)(o.material, `${p}.material`), shape: nullable(str)(o.shape, `${p}.shape`),
    thickness_mm: nullable(num)(o.thickness_mm, `${p}.thickness_mm`), o2_fraction: nullable(num)(o.o2_fraction, `${p}.o2_fraction`),
    pressure_kpa: nullable(num)(o.pressure_kpa, `${p}.pressure_kpa`), gravity_regime: nullable(str)(o.gravity_regime, `${p}.gravity_regime`),
    flow_direction: nullable(oneOf(flowDirs))(o.flow_direction, `${p}.flow_direction`),
    flow_velocity_cm_s: nullable(num)(o.flow_velocity_cm_s, `${p}.flow_velocity_cm_s`), ignition: nullable(str)(o.ignition, `${p}.ignition`),
  };
};
export const researchQuery: P<T.ResearchQuery> = obj({
  question: withDefault(str, ''), environment: oneOf(environments), topic: nullable(str),
  endpoint: nullable(oneOf(endpoints)), config: queryConfig,
});
export const parsedQuery: P<T.ParsedQuery> = obj({ query: researchQuery, missing: arr(str), confirm: arr(str) });

export const runStatus: P<T.RunStatus> = obj({
  run_id: str, status: oneOf(['queued', 'running', 'done', 'error'] as const), stage: nullable(str), error: nullable(str), review_id: nullable(str),
});
export const runCreated: P<T.RunCreated> = obj({ run_id: str, review_id: str });

const ground: P<T.Ground> = obj({ rule_id: str, field: withDefault(str, ''), effect: oneOf(['pass', 'fail', 'unknown'] as const), text: withDefault(str, '') });
const decision: P<T.ApplicabilityDecision> = obj({
  test_id: str, status: oneOf(['direct', 'limited_context', 'incompatible', 'insufficient_data'] as const),
  grounds: arr(ground), unknown_fields: arr(str), rule_version: withDefault(str, ''),
});
const contrast: P<T.Contrast> = obj({
  id: str, test_a: str, test_b: str, question: withDefault(str, ''), allowed: bool, changed_factors: arr(str), shared: arr(str),
  unknown: arr(str), statement: withDefault(str, ''), rule_ids: arr(str),
});
const claim: P<T.ReviewClaim> = obj({
  id: str, text: str, type: looseStr('observation'), evidence: arr(str), rule_ids: arr(str), conditions: record(unk),
  status: oneOf(['supported', 'needs_new_comparison', 'not_applicable'] as const), why: withDefault(str, ''), depends_on_fields: arr(str),
});
const insight: P<T.Insight> = (v, p) => {
  if (!isRec(v)) throw new ParseError(p, 'object', v);
  const c = v.conditions;
  return {
    id: str(v.id, `${p}.id`), topic: withDefault(str, '')(v.topic, `${p}.topic`),
    observation: withDefault(str, '')(v.observation, `${p}.observation`), interpretation: withDefault(str, '')(v.interpretation, `${p}.interpretation`),
    possible_application: withDefault(str, '')(v.possible_application, `${p}.possible_application`),
    conditions: record(unk)(Array.isArray(c) ? undefined : c, `${p}.conditions`),
    open_questions: arr(str)(v.open_questions, `${p}.open_questions`), claim_ids: arr(str)(v.claim_ids, `${p}.claim_ids`),
  };
};
const openQuestion: P<T.OpenQuestion> = obj({
  id: str, kind: looseStr(''), text: str, field: nullable(str), endpoint: nullable(str), test_ids: arr(str),
});
const dict = record(unk);
const testBlock: P<T.TestBlock> = obj({
  id: str, question_id: withDefault(str, ''), target: dict, control: dict, fixed: dict, changed: dict,
  endpoint: withDefault(str, ''), measurements: arr(str), replicates: num, replicate_rationale: withDefault(str, ''),
  equipment: arr(str), runs: num, assumptions: arr(str), covers: arr(str),
});
export const programme: P<T.TestProgramme> = obj({
  blocks: arr(testBlock), selected: arr(str), runs_used: num, budget_runs: num, covered: arr(str), uncovered: arr(str),
  method: oneOf(['exact', 'greedy'] as const), note: withDefault(str, ''),
});
export const review: P<T.Review> = (v, p) => {
  if (!isRec(v)) throw new ParseError(p, 'object', v);
  return {
    id: str(v.id, `${p}.id`), revision: withDefault(num, 1)(v.revision, `${p}.revision`), created: withDefault(str, '')(v.created, `${p}.created`),
    query: researchQuery(v.query, `${p}.query`), mode: mode(v.mode, `${p}.mode`),
    manifest: record(unk)(v.manifest, `${p}.manifest`),
    ranking: arr(obj({
      investigation_id: str, relevance: num, applicability_summary: record(num),
      quality: obj({ level: looseStr('unknown'), verification: looseStr('provisional'), coverage: looseStr('unknown'), factors: arr(str), note: withDefault(str, '') }), why: withDefault(str, ''),
    }))(v.ranking, `${p}.ranking`),
    tests_considered: arr(obj({ test_id: str, endpoint_support: withDefault(str, ''), decisions: arr(decision) }))(v.tests_considered, `${p}.tests_considered`),
    contrasts: arr(contrast)(v.contrasts, `${p}.contrasts`), claims: arr(claim)(v.claims, `${p}.claims`),
    safety_insights: arr(insight)(v.safety_insights, `${p}.safety_insights`), conflicts: arr(unk)(v.conflicts, `${p}.conflicts`),
    limitations: arr(str)(v.limitations, `${p}.limitations`), open_questions: arr(openQuestion)(v.open_questions, `${p}.open_questions`),
    programme: nullable(programme)(v.programme, `${p}.programme`), warnings: arr(str)(v.warnings, `${p}.warnings`),
    explanation: nullable(obj({ mode, summary: withDefault(str, ''), paragraphs: arr(str), warnings: arr(str), model: nullable(str) }))(v.explanation, `${p}.explanation`),
    parent_id: nullable(str)(v.parent_id, `${p}.parent_id`), variant_patch: nullable(dict)(v.variant_patch, `${p}.variant_patch`),
  };
};
export const reviewList: P<T.ReviewListItem[]> = (v, p) => {
  const items = isRec(v) && Array.isArray(v.items) ? v.items : v;
  return arr((x, q): T.ReviewListItem => {
    if (!isRec(x)) throw new ParseError(q, 'object', x);
    const query = isRec(x.query) ? x.query : {};
    return {
      id: str(x.id, `${q}.id`), created: withDefault(str, '')(x.created, `${q}.created`), mode: mode(x.mode ?? 'deterministic', `${q}.mode`),
      question: str(x.question ?? query.question ?? '', `${q}.question`), revision: withDefault(num, 1)(x.revision, `${q}.revision`),
      endpoint: nullable(str)(x.endpoint, `${q}.endpoint`), parent_id: nullable(str)(x.parent_id, `${q}.parent_id`),
    };
  })(items, p);
};
export const variantResult: P<T.VariantResult> = (v, p) => {
  if (!isRec(v)) throw new ParseError(p, 'object', v);
  return {
    variant_id: str(v.variant_id, `${p}.variant_id`),
    diff: arr(obj({ claim_id: str, before: nullable(str), after: nullable(str), changed_parameter: withDefault(str, ''), reason: withDefault(str, '') }))(v.diff, `${p}.diff`),
    review: review(v.review, `${p}.review`),
  };
};
/** Replay events carry time_s as a bare number|null rather than a ScientificValue. */
const replayEvent: P<T.TestEvent> = (v, p) => {
  if (!isRec(v)) throw new ParseError(p, 'object', v);
  const t = v.time_s;
  return testEvent({ ...v, time_s: typeof t === 'number' ? { kind: 'reported', value: t, unit: 's', role: null, source_ref: null } : t }, p);
};
export const replay: P<T.Replay> = (v, p) => {
  if (!isRec(v)) throw new ParseError(p, 'object', v);
  return {
    segments: arr(obj({ label: str, kind: looseStr(''), time_s: nullable(num), order: num }))(v.segments, `${p}.segments`),
    events: arr(replayEvent)(v.events, `${p}.events`), measurements: arr(measurement)(v.measurements, `${p}.measurements`),
    disclaimer: withDefault(str, 'Data replay, not a physics simulation.')(v.disclaimer, `${p}.disclaimer`),
  };
};
export const evalSummary: P<T.EvalSummary> = (v, p) => {
  if (!isRec(v)) throw new ParseError(p, 'object', v);
  const status = v.status === 'measured' ? 'measured' : 'not_measured';
  return { ...v, status };
};
export const errorEnvelope = (v: unknown): { code: string; message: string } | null => {
  if (isRec(v) && isRec(v.error) && typeof v.error.message === 'string') {
    return { code: typeof v.error.code === 'string' ? v.error.code : 'error', message: v.error.message };
  }
  return null;
};

export const revisions: P<T.RevisionItem[]> = (v, p) => arr(obj({ revision: num, created: withDefault(str, ''), reason: withDefault(str, '') }))(isRec(v) ? v.items : v, p);
export const rules: P<T.RulesDoc> = obj({
  rules_version: str,
  rules: arr(obj({ id: str, title: withDefault(str, ''), severity: looseStr(''), description: withDefault(str, ''), heuristic: withDefault(bool, false) })),
  endpoint_requirements: record(record(unk)),
});
