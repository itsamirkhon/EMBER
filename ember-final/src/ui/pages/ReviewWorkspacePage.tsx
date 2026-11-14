import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  FlowDirection,
  FuelPhase,
  GasRole,
  HabitableEnvironment,
  ResearchQuery,
  RetrievalMode,
  SafetyTask,
  TargetEndpoint,
} from '../../core';
import { parseQuery } from '../apiClient';
import { ProvenanceTrace } from '../components/ProvenanceTrace';
import {
  AnswerBoundaryBadge,
  GasRoleBadge,
  ModeBadge,
  ProvenanceBadge,
  StatusPill,
} from '../components/StatusPill';
import { useEmber } from '../context/EmberContext';

interface HabitatPresetOption {
  id: HabitableEnvironment;
  label: string;
  o2Pct: string;
  pressureKpa: string;
  flowCmS: string;
  gravityG: string;
}

const HABITAT_PRESETS: HabitatPresetOption[] = [
  { id: 'iss', label: 'ISS (21% O2 · 101.3 kPa · 0g)', o2Pct: '21', pressureKpa: '101.3', flowCmS: '10', gravityG: '0' },
  { id: 'spacecraft', label: 'Crew Capsule (21% O2 · 101.3 kPa · 0g)', o2Pct: '21', pressureKpa: '101.3', flowCmS: '10', gravityG: '0' },
  { id: 'lunar_base', label: 'Lunar Base (34% O2 · 56.5 kPa · 0.166g)', o2Pct: '34', pressureKpa: '56.5', flowCmS: '12', gravityG: '0.166' },
  { id: 'lunar_rover', label: 'Pressurized Lunar Rover (30% O2 · 70.3 kPa · 0.166g)', o2Pct: '30', pressureKpa: '70.3', flowCmS: '5', gravityG: '0.166' },
  { id: 'mars_base', label: 'Mars Base (34% O2 · 56.5 kPa · 0.38g)', o2Pct: '34', pressureKpa: '56.5', flowCmS: '12', gravityG: '0.38' },
  { id: 'eva_suit', label: 'EVA Suit (100% O2 · 29.6 kPa)', o2Pct: '100', pressureKpa: '29.6', flowCmS: '', gravityG: '0.166' },
  { id: 'custom', label: 'Custom Condition Specification', o2Pct: '', pressureKpa: '', flowCmS: '', gravityG: '' },
];

const SAFETY_TASKS: Array<{ id: SafetyTask; label: string }> = [
  { id: 'material_screening', label: 'Prevention / Material Screening' },
  { id: 'ventilation_setting', label: 'Ventilation Setting' },
  { id: 'smoke_detection', label: 'Smoke Detection' },
  { id: 'fire_suppression', label: 'Fire Suppression' },
  { id: 'atmosphere_selection', label: 'Atmosphere Selection' },
  { id: 'general_comparison', label: 'General Scientific Comparison' },
];

const TARGET_ENDPOINTS: Array<{ id: TargetEndpoint; label: string }> = [
  { id: 'flame_establishment', label: 'flame_establishment' },
  { id: 'sustained_spread', label: 'sustained_spread' },
  { id: 'extinction_under_flow_change', label: 'extinction_under_flow_change' },
  { id: 'spread_rate', label: 'spread_rate (mm/s)' },
  { id: 'burning_rate_constant', label: 'burning_rate_constant (mm²/s)' },
  { id: 'hot_flame_extinction', label: 'hot_flame_extinction' },
  { id: 'cool_flame_continuation', label: 'cool_flame_continuation' },
  { id: 'smoke_particle_size', label: 'smoke_particle_size (nm)' },
  { id: 'smoke_point_length', label: 'smoke_point_length (mm)' },
  { id: 'suppressant_extinction', label: 'suppressant_extinction' },
  { id: 'blowoff_limit', label: 'blowoff_limit' },
  { id: 'quench_limit', label: 'quench_limit' },
];

function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function ReviewWorkspacePage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const {
    reviews,
    activeSnapshot,
    activeLoading,
    activeError,
    warnings,
    loadReview,
    submitReview,
    openSourceRef,
  } = useEmber();

  const [question, setQuestion] = useState(
    'PMMA flame establishment, sustained spread, and extinction under flow reduction in oxygen-enriched lunar rover 30% O2 / 70.3 kPa, 5 cm/s concurrent flow vs ISS BASS-II',
  );
  const [habitat, setHabitat] = useState<HabitableEnvironment>('lunar_rover');
  const [safetyTask, setSafetyTask] = useState<SafetyTask>('material_screening');
  const [targetEndpoint, setTargetEndpoint] = useState<TargetEndpoint | ''>('extinction_under_flow_change');
  const [fuelPhase, setFuelPhase] = useState<FuelPhase | ''>('solid');
  const [material, setMaterial] = useState('PMMA');
  const [geometry, setGeometry] = useState('');
  const [thicknessMm, setThicknessMm] = useState('');
  const [o2Pct, setO2Pct] = useState('30');
  const [o2Role, setO2Role] = useState<GasRole>('ambient');
  const [pressureKpa, setPressureKpa] = useState('70.3');
  const [flowCmS, setFlowCmS] = useState('5');
  const [flowDirection, setFlowDirection] = useState<FlowDirection | ''>('concurrent');
  const [gravityG, setGravityG] = useState('0.166');
  const [retrievalMode, setRetrievalMode] = useState<RetrievalMode>('hybrid');
  const [useLiveAi, setUseLiveAi] = useState(false);

  const [parsedPreview, setParsedPreview] = useState<ResearchQuery | null>(null);
  const [touchedInvalid, setTouchedInvalid] = useState(false);
  const loadedTargetRef = useRef<string | null>(null);

  useEffect(() => {
    if (id) {
      if (activeSnapshot?.reviewId === id) {
        loadedTargetRef.current = id;
        return;
      }
      if (!activeLoading && loadedTargetRef.current !== id) {
        loadedTargetRef.current = id;
        void loadReview(id);
      }
    } else if (!activeSnapshot && !activeLoading && loadedTargetRef.current !== 'demo-pmma-lunar') {
      loadedTargetRef.current = 'demo-pmma-lunar';
      void loadReview('demo-pmma-lunar');
    }
  }, [id, activeSnapshot, activeLoading, loadReview]);

  useEffect(() => {
    if (!activeSnapshot) return;
    const q = activeSnapshot.review.query;
    setQuestion(q.rawQuestion);
    setHabitat(q.habitableEnvironment);
    setSafetyTask(q.safetyTask);
    setTargetEndpoint(q.targetEndpoint ?? '');
    setFuelPhase(q.fuelPhase ?? '');
    setMaterial(q.material ?? '');
    setGeometry(q.geometry ?? '');
    setThicknessMm(q.thicknessMm !== null ? String(q.thicknessMm) : '');
    setO2Pct(q.o2Pct !== null ? String(q.o2Pct) : '');
    setO2Role(q.o2Role);
    setPressureKpa(q.pressureKpa !== null ? String(q.pressureKpa) : '');
    setFlowCmS(
      Array.isArray(q.flowCmS)
        ? `${q.flowCmS[0]}`
        : q.flowCmS !== null
          ? String(q.flowCmS)
          : '',
    );
    setFlowDirection(q.flowDirection ?? '');
    setGravityG(q.gravityG !== null ? String(q.gravityG) : '');
  }, [activeSnapshot?.reviewId]);

  const buildOverrides = (): Partial<ResearchQuery> => {
    const overrides: Partial<ResearchQuery> = {
      habitableEnvironment: habitat,
      safetyTask,
      o2Role,
    };
    if (targetEndpoint) overrides.targetEndpoint = targetEndpoint;
    if (fuelPhase) overrides.fuelPhase = fuelPhase;
    if (material.trim()) overrides.material = material.trim();
    if (geometry.trim()) overrides.geometry = geometry.trim();
    const tVal = parseOptionalNumber(thicknessMm);
    if (tVal !== null) overrides.thicknessMm = tVal;
    const o2Val = parseOptionalNumber(o2Pct);
    if (o2Val !== null) overrides.o2Pct = o2Val;
    const pVal = parseOptionalNumber(pressureKpa);
    if (pVal !== null) overrides.pressureKpa = pVal;
    const fVal = parseOptionalNumber(flowCmS);
    if (fVal !== null) overrides.flowCmS = fVal;
    if (flowDirection) overrides.flowDirection = flowDirection;
    const gVal = parseOptionalNumber(gravityG);
    if (gVal !== null) overrides.gravityG = gVal;
    return overrides;
  };

  useEffect(() => {
    let cancelled = false;
    const overrides: Partial<ResearchQuery> = {
      habitableEnvironment: habitat,
      safetyTask,
      o2Role,
    };
    if (targetEndpoint) overrides.targetEndpoint = targetEndpoint;
    if (fuelPhase) overrides.fuelPhase = fuelPhase;
    if (material.trim()) overrides.material = material.trim();
    if (geometry.trim()) overrides.geometry = geometry.trim();
    const tVal = parseOptionalNumber(thicknessMm);
    if (tVal !== null) overrides.thicknessMm = tVal;
    const o2Val = parseOptionalNumber(o2Pct);
    if (o2Val !== null) overrides.o2Pct = o2Val;
    const pVal = parseOptionalNumber(pressureKpa);
    if (pVal !== null) overrides.pressureKpa = pVal;
    const fVal = parseOptionalNumber(flowCmS);
    if (fVal !== null) overrides.flowCmS = fVal;
    if (flowDirection) overrides.flowDirection = flowDirection;
    const gVal = parseOptionalNumber(gravityG);
    if (gVal !== null) overrides.gravityG = gVal;

    const timer = window.setTimeout(() => {
      parseQuery(question, overrides)
        .then((res) => {
          if (!cancelled) setParsedPreview(res.query);
        })
        .catch(() => {
          // Ignore transient preview errors while typing
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    question,
    habitat,
    safetyTask,
    targetEndpoint,
    fuelPhase,
    material,
    geometry,
    thicknessMm,
    o2Pct,
    o2Role,
    pressureKpa,
    flowCmS,
    flowDirection,
    gravityG,
  ]);

  const o2Num = parseOptionalNumber(o2Pct);
  const o2Invalid = o2Pct.trim() !== '' && (o2Num === null || o2Num < 0 || o2Num > 100);
  const pNum = parseOptionalNumber(pressureKpa);
  const pressureInvalid = pressureKpa.trim() !== '' && (pNum === null || pNum <= 0);
  const tNum = parseOptionalNumber(thicknessMm);
  const thicknessInvalid = thicknessMm.trim() !== '' && (tNum === null || tNum <= 0);
  const questionInvalid = question.trim().length < 4;

  const handlePresetChange = (presetId: HabitableEnvironment) => {
    setHabitat(presetId);
    const preset = HABITAT_PRESETS.find((p) => p.id === presetId);
    if (!preset || presetId === 'custom') return;
    setO2Pct(preset.o2Pct);
    setPressureKpa(preset.pressureKpa);
    if (preset.flowCmS) setFlowCmS(preset.flowCmS);
    setGravityG(preset.gravityG);
  };

  const handleRunReview = async (e: FormEvent) => {
    e.preventDefault();
    setTouchedInvalid(true);
    if (questionInvalid || o2Invalid || pressureInvalid || thicknessInvalid) return;
    const snap = await submitReview({
      question,
      overrides: buildOverrides(),
      retrievalMode,
      useLiveAi,
      budgetRuns: 10,
      forceNew: true,
    });
    navigate(`/reviews/${encodeURIComponent(snap.reviewId)}`);
  };

  const review = activeSnapshot?.review;

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>Scientific Evidence Review Workspace</h1>
          <p className="page-lead">
            Query NASA PSI microgravity combustion experiments with role-checked atmosphere specs, stage-bound protocol matching, applicability rule gates, and expandable citation provenance.
          </p>
        </div>

        <div className="btn-group">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => navigate('/reviews/demo-pmma-lunar')}
          >
            Demo 1: PMMA Lunar Rover
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => navigate('/reviews/demo-cool-flame')}
          >
            Demo 2: CFI/FLEX Cool Flames
          </button>
        </div>
      </div>

      {/* Saved / Judge Snapshots Switcher */}
      {reviews.length > 0 ? (
        <section className="card" aria-label="Saved and Pre-Seeded Reviews">
          <div className="card-header">
            <h2 className="card-title">Saved &amp; Pre-Seeded Review Snapshots ({reviews.length})</h2>
            <span className="muted" style={{ fontSize: '0.82rem' }}>
              HashRouter links preserve state across page reloads
            </span>
          </div>
          <div className="btn-group">
            {reviews.map((rev) => {
              const isSelected = activeSnapshot?.reviewId === rev.reviewId;
              return (
                <Link
                  key={rev.reviewId}
                  to={`/reviews/${encodeURIComponent(rev.reviewId)}`}
                  className={`btn btn-sm ${isSelected ? 'btn-primary' : ''}`}
                >
                  <span>{rev.isDemo ? `★ ${rev.reviewId}` : rev.title.slice(0, 36)}</span>
                  <span className="mono" style={{ opacity: 0.85 }}>
                    [{rev.mode === 'SAVED_DEMO_SNAPSHOT' ? 'DEMO' : rev.mode === 'LIVE_AI' ? 'AI' : 'DET'}]
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Review Query Form */}
      <form className="card stack-md" onSubmit={handleRunReview} noValidate>
        <div className="card-header">
          <h2 className="card-title">1. Research Question &amp; Physical Condition Specification</h2>
          {review ? <ModeBadge mode={review.synthesis.mode} /> : null}
        </div>

        <div className="field">
          <label htmlFor="review-question" className="field-label">
            Scientific / Spacecraft Fire Safety Question
          </label>
          <span id="review-question-hint" className="field-hint">
            Specify material, fuel geometry, O2%, pressure (kPa/psi/atm), flow speed &amp; direction, gravity regime, and target combustion endpoint.
          </span>
          <textarea
            id="review-question"
            aria-describedby="review-question-hint"
            className={touchedInvalid && questionInvalid ? 'user-invalid-fallback' : undefined}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            required
          />
          {touchedInvalid && questionInvalid ? (
            <span className="field-error" role="alert">
              Enter a research question of at least 4 characters.
            </span>
          ) : null}
        </div>

        <fieldset>
          <legend>Scenario Presets, Safety Task &amp; Target Endpoint</legend>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="habitat-preset" className="field-label">Habitat / Scenario Preset</label>
              <select
                id="habitat-preset"
                value={habitat}
                onChange={(e) => handlePresetChange(e.target.value as HabitableEnvironment)}
              >
                {HABITAT_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="safety-task" className="field-label">Safety Task</label>
              <select
                id="safety-task"
                value={safetyTask}
                onChange={(e) => setSafetyTask(e.target.value as SafetyTask)}
              >
                {SAFETY_TASKS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="target-endpoint" className="field-label">Target Endpoint</label>
              <select
                id="target-endpoint"
                value={targetEndpoint}
                onChange={(e) => setTargetEndpoint(e.target.value as TargetEndpoint | '')}
              >
                <option value="">Auto-detect from question</option>
                {TARGET_ENDPOINTS.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="fuel-phase" className="field-label">Fuel Phase</label>
              <select
                id="fuel-phase"
                value={fuelPhase}
                onChange={(e) => setFuelPhase(e.target.value as FuelPhase | '')}
              >
                <option value="">Auto-detect</option>
                <option value="solid">solid</option>
                <option value="liquid">liquid</option>
                <option value="gas">gas</option>
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Material, Atmosphere, Flow &amp; Gravity Overrides</legend>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="mat-input" className="field-label">Material / Fuel</label>
              <input
                id="mat-input"
                type="text"
                value={material}
                placeholder="e.g. PMMA, Nomex, n-dodecane, methane"
                onChange={(e) => setMaterial(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="geom-input" className="field-label">Geometry</label>
              <input
                id="geom-input"
                type="text"
                value={geometry}
                placeholder="e.g. sheet, slab, droplet, burner"
                onChange={(e) => setGeometry(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="thick-input" className="field-label">Thickness (mm)</label>
              <input
                id="thick-input"
                type="number"
                step="any"
                min="0.01"
                value={thicknessMm}
                placeholder="Optional (leave blank if open)"
                className={thicknessInvalid ? 'user-invalid-fallback' : undefined}
                onChange={(e) => setThicknessMm(e.target.value)}
              />
              {thicknessInvalid ? <span className="field-error">Must be &gt; 0 mm</span> : null}
            </div>

            <div className="field">
              <label htmlFor="o2-input" className="field-label">O2 Concentration (%)</label>
              <input
                id="o2-input"
                type="number"
                step="any"
                min="0"
                max="100"
                value={o2Pct}
                className={o2Invalid ? 'user-invalid-fallback' : undefined}
                onChange={(e) => setO2Pct(e.target.value)}
              />
              {o2Invalid ? <span className="field-error">Must be 0–100%</span> : null}
            </div>

            <div className="field">
              <label htmlFor="o2-role" className="field-label">O2 Physical Role</label>
              <select
                id="o2-role"
                value={o2Role}
                onChange={(e) => setO2Role(e.target.value as GasRole)}
              >
                <option value="ambient">ambient (Cabin / Chamber Atmosphere)</option>
                <option value="oxidizer_stream">oxidizer_stream (Coflow / Burner Jet)</option>
                <option value="diluent">diluent</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="press-input" className="field-label">Pressure (kPa)</label>
              <input
                id="press-input"
                type="number"
                step="any"
                min="0.1"
                value={pressureKpa}
                className={pressureInvalid ? 'user-invalid-fallback' : undefined}
                onChange={(e) => setPressureKpa(e.target.value)}
              />
              {pressureInvalid ? <span className="field-error">Must be &gt; 0 kPa</span> : null}
            </div>

            <div className="field">
              <label htmlFor="flow-input" className="field-label">Flow Speed (cm/s)</label>
              <input
                id="flow-input"
                type="number"
                step="any"
                min="0"
                value={flowCmS}
                onChange={(e) => setFlowCmS(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="flow-dir" className="field-label">Flow Direction</label>
              <select
                id="flow-dir"
                value={flowDirection}
                onChange={(e) => setFlowDirection(e.target.value as FlowDirection | '')}
              >
                <option value="">Any / Unspecified</option>
                <option value="concurrent">concurrent</option>
                <option value="opposed">opposed</option>
                <option value="quiescent">quiescent</option>
                <option value="coflow">coflow</option>
                <option value="axial_stagnation">axial_stagnation</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="grav-input" className="field-label">Gravity (g)</label>
              <input
                id="grav-input"
                type="number"
                step="any"
                min="0"
                value={gravityG}
                onChange={(e) => setGravityG(e.target.value)}
              />
            </div>
          </div>
        </fieldset>

        <div className="btn-group" style={{ justifyContent: 'space-between' }}>
          <div className="btn-group">
            <div className="field" style={{ minInlineSize: 180 }}>
              <label htmlFor="retrieval-mode" className="field-label">Retrieval Mode</label>
              <select
                id="retrieval-mode"
                value={retrievalMode}
                onChange={(e) => setRetrievalMode(e.target.value as RetrievalMode)}
              >
                <option value="hybrid">Hybrid (BM25 + Dense + Structured)</option>
                <option value="bm25">BM25 Lexical</option>
                <option value="structured">Structured Spec Match</option>
              </select>
            </div>

            <label className="checkbox-inline" style={{ marginBlockStart: '1.25rem' }}>
              <input
                type="checkbox"
                checked={useLiveAi}
                onChange={(e) => setUseLiveAi(e.target.checked)}
              />
              <span>Request Live AI Synthesis (strictly verified; falls back only if unavailable)</span>
            </label>
          </div>

          <button type="submit" className="btn btn-primary" disabled={activeLoading}>
            {activeLoading ? 'Running Scientific Review…' : 'Run Evidence Review'}
          </button>
        </div>
      </form>

      {/* Live Parsed Query Confirmation Panel */}
      {parsedPreview ? (
        <section className="card-elevated stack-sm" aria-label="Live Parsed ResearchQuery Confirmation">
          <div className="card-header">
            <h2 className="card-title">2. Live Parsed ResearchQuery Confirmation</h2>
            <GasRoleBadge role={parsedPreview.o2Role} />
          </div>
          <div className="pill-row">
            <StatusPill tone="info" label={`Env: ${parsedPreview.habitableEnvironment}`} />
            <StatusPill tone="info" label={`Task: ${parsedPreview.safetyTask}`} />
            <StatusPill tone="accent" label={`Endpoint: ${parsedPreview.targetEndpoint ?? 'auto'}`} />
            <StatusPill tone="neutral" label={`Material: ${parsedPreview.material ?? 'unspecified'}`} />
            <StatusPill tone="neutral" label={`Phase: ${parsedPreview.fuelPhase ?? 'unspecified'}`} />
            <StatusPill
              tone="neutral"
              label={`O2: ${parsedPreview.o2Pct !== null ? `${parsedPreview.o2Pct}%` : 'unknown'}`}
            />
            <StatusPill
              tone="neutral"
              label={`P: ${parsedPreview.pressureKpa !== null ? `${parsedPreview.pressureKpa} kPa` : 'unknown'}`}
            />
            <StatusPill
              tone="neutral"
              label={`Flow: ${
                Array.isArray(parsedPreview.flowCmS)
                  ? `${parsedPreview.flowCmS[0]}–${parsedPreview.flowCmS[1]} cm/s`
                  : parsedPreview.flowCmS !== null
                    ? `${parsedPreview.flowCmS} cm/s`
                    : 'unknown'
              } (${parsedPreview.flowDirection ?? 'any'})`}
            />
            <StatusPill
              tone="neutral"
              label={`Gravity: ${parsedPreview.gravityG !== null ? `${parsedPreview.gravityG}g` : 'unknown'} (${parsedPreview.gravityRegime ?? 'n/a'})`}
            />
          </div>

          {parsedPreview.unknownFields.length > 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>
              <strong>Open / Unknown Fields (non-blocking):</strong>{' '}
              <span className="mono">{parsedPreview.unknownFields.join(', ')}</span>
            </p>
          ) : null}

          {parsedPreview.validationWarnings.map((w) => (
            <div key={w} className="banner banner-warn">
              <span aria-hidden="true">⚠</span>
              <span>{w}</span>
            </div>
          ))}
        </section>
      ) : null}

      {warnings.map((w) => (
        <div key={w} className="banner banner-warn">
          <span aria-hidden="true">⚠</span>
          <span>{w}</span>
        </div>
      ))}

      {activeError ? (
        <div className="banner banner-danger" role="alert">
          <span aria-hidden="true">✕</span>
          <span>{activeError}</span>
        </div>
      ) : null}

      {/* Review Output */}
      {review ? (
        <section className="stack-lg" aria-label="Review Findings and Provenance">
          <div className="grid-4">
            <div className="kpi-tile">
              <span className="kpi-label">Execution Mode</span>
              <div style={{ marginBlockStart: '0.35rem' }}>
                <ModeBadge mode={review.synthesis.mode} />
              </div>
            </div>
            <div className="kpi-tile">
              <span className="kpi-label">Answer Boundary</span>
              <div style={{ marginBlockStart: '0.35rem' }}>
                <AnswerBoundaryBadge boundary={review.synthesis.answerBoundary} />
              </div>
            </div>
            <div className="kpi-tile">
              <span className="kpi-label">Admissible / Conditional Tests</span>
              <span className="kpi-value tabular">
                {review.evidencePackage.applicabilityDecisions.filter((d) => d.admissible).length} /{' '}
                {review.evidencePackage.applicabilityDecisions.filter((d) => d.conditional).length}
              </span>
            </div>
            <div className="kpi-tile">
              <span className="kpi-label">Verifier Gate</span>
              <div style={{ marginBlockStart: '0.35rem' }}>
                <StatusPill
                  tone={review.verification.passed ? 'ok' : 'danger'}
                  icon={review.verification.passed ? '✓' : '✕'}
                  label={review.verification.passed ? 'All 5 Checks Passed' : 'Flagged Issues'}
                />
              </div>
            </div>
          </div>

          <div className="banner banner-info" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div>
              <strong>Active Review:</strong> {activeSnapshot?.title}{' '}
              <span className="mono muted">({review.envelope.runId} · {review.envelope.timingMs.total} ms)</span>
            </div>
            <div className="btn-group">
              <Link to="/variants" className="btn btn-sm">Inspect Design Variants</Link>
              <Link to="/planner" className="btn btn-sm">Plan Test Budget</Link>
              <Link to="/modeling" className="btn btn-sm">Run Domain Predictor</Link>
              <Link to="/export" className="btn btn-sm">Export Bundle</Link>
            </div>
          </div>

          {/* Supported Observed Facts */}
          <div className="card stack-md">
            <div className="card-header">
              <h2 className="card-title">3. Observed Experimental Facts ({review.synthesis.observedFact.length})</h2>
              <StatusPill tone="ok" icon="●" label="Reported Test Evidence Only" />
            </div>
            {review.synthesis.observedFact.length === 0 ? (
              <div className="banner banner-warn">
                <span aria-hidden="true">∅</span>
                <span>
                  No observed tests satisfy all admissibility criteria simultaneously. See Applicability Conditions, Open Questions, and Explorer for partial or planned context.
                </span>
              </div>
            ) : (
              <div className="stack-md">
                {review.synthesis.observedFact.map((item) => (
                  <article key={item.id} className="card-elevated stack-sm">
                    <div className="pill-row">
                      <span className="mono muted">{item.id}</span>
                      <ProvenanceBadge provenance={item.provenance} />
                    </div>
                    <p style={{ margin: 0 }}>{item.text}</p>
                    <ProvenanceTrace review={review} claimId={item.id} citations={item.citations} />
                  </article>
                ))}
              </div>
            )}
          </div>

          {/* Author Interpretations & Engineering Implications */}
          <div className="grid-2">
            <div className="card stack-sm">
              <h2 className="card-title">4. Author Interpretations &amp; Planned Context ({review.synthesis.authorInterpretation.length})</h2>
              {review.synthesis.authorInterpretation.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>No secondary interpretations attached.</p>
              ) : (
                review.synthesis.authorInterpretation.map((item) => (
                  <div key={item.id} className="card-elevated stack-sm">
                    <ProvenanceBadge provenance={item.provenance} />
                    <p style={{ margin: 0 }}>{item.text}</p>
                    {item.citations.length > 0 ? (
                      <ProvenanceTrace review={review} claimId={item.id} citations={item.citations} />
                    ) : null}
                  </div>
                ))
              )}
            </div>

            <div className="card stack-sm">
              <h2 className="card-title">5. Engineering Implications &amp; Applicability Limits</h2>
              {review.synthesis.engineeringImplication.map((item) => (
                <div key={item.id} className="card-elevated stack-sm">
                  <ProvenanceBadge provenance={item.provenance} />
                  <p style={{ margin: 0 }}>{item.text}</p>
                </div>
              ))}
              {review.synthesis.applicabilityConditions.length > 0 ? (
                <ul style={{ marginBlock: '0.4rem 0', paddingInlineStart: '1.2rem' }}>
                  {review.synthesis.applicabilityConditions.map((cond, idx) => (
                    <li key={idx} className="muted" style={{ fontSize: '0.88rem' }}>
                      {cond}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          {/* Preserved Conflicts & Gaps */}
          <div className="grid-2">
            <div className="card stack-sm">
              <h2 className="card-title">
                6. Preserved Conflicts &amp; Counterevidence ({review.synthesis.conflictsPreserved.length})
              </h2>
              {review.synthesis.conflictsPreserved.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  No contradicting passages flagged across retrieved evidence for this query.
                </p>
              ) : (
                review.synthesis.conflictsPreserved.map((c) => (
                  <div key={c.chunkId} className="banner banner-warn" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <div className="pill-row" style={{ marginBlockEnd: '0.3rem' }}>
                        <StatusPill tone="warn" icon="⚡" label={c.inv ?? 'Corpus Conflict'} />
                        <span className="mono muted">{c.chunkId}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.9rem' }}>{c.summary}</p>
                    </div>
                    {c.sourceRef?.sourceId ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => openSourceRef(c.sourceRef)}
                      >
                        Source
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            <div className="card stack-sm">
              <h2 className="card-title">7. Open Evidence Gaps ({review.synthesis.openQuestions.length})</h2>
              <ul style={{ margin: 0, paddingInlineStart: '1.2rem' }}>
                {review.synthesis.openQuestions.map((g, i) => (
                  <li key={i} style={{ marginBlockEnd: '0.35rem' }}>
                    {g}
                  </li>
                ))}
              </ul>
              {review.evidencePackage.gaps.length > 0 ? (
                <div className="pill-row">
                  <Link to="/planner" className="btn btn-sm btn-primary">
                    Design Test Programme for Gaps →
                  </Link>
                </div>
              ) : null}
            </div>
          </div>

          {/* 5-Gate Verifier Inspection */}
          <div className="card stack-sm">
            <h2 className="card-title">8. Automated Scientific Verification Gates</h2>
            <div className="pill-row">
              {(
                [
                  ['Citations', review.verification.citationCheck],
                  ['Numeric & Units', review.verification.numericUnitCheck],
                  ['Epistemic Provenance', review.verification.epistemicCheck],
                  ['Constraint Preservation', review.verification.constraintPreservationCheck],
                  ['Lexical Entailment', review.verification.lexicalEntailmentCheck],
                ] as const
              ).map(([label, check]) => (
                <StatusPill
                  key={label}
                  tone={check.passed ? 'ok' : 'danger'}
                  icon={check.passed ? '✓' : '✕'}
                  label={`${label}: ${check.passed ? 'PASS' : `${check.issues.length} issue(s)`}`}
                />
              ))}
            </div>
          </div>
        </section>
      ) : activeLoading ? (
        <div className="card">
          <p className="muted">Running retrieval, Passage triage passage evaluation, applicability rules, and synthesis…</p>
        </div>
      ) : null}
    </div>
  );
}
