import { useEffect, useState } from 'react';
import type {
  DesignVariantPatch,
  DesignVariantResult,
  FlowDirection,
  GasRole,
} from '../../core';
import { applyDesignVariant } from '../apiClient';
import { StatusPill, VerdictBadge } from '../components/StatusPill';
import { useEmber } from '../context/EmberContext';

const VARIANT_PRESETS: Array<{ label: string; patch: DesignVariantPatch }> = [
  {
    label: 'Preset 1: Thin 0.1mm PMMA film → Thick 3.0mm PMMA slab / Opposed flow',
    patch: { thicknessMm: 3.0, flowDirection: 'opposed', geometry: 'slab' },
  },
  {
    label: 'Preset 2: ISS (21% O2 / 101.3 kPa / 0g) → Lunar Rover (30% O2 / 70.3 kPa / 0.166g)',
    patch: { o2Pct: 30, pressureKpa: 70.3, gravityG: 0.166, o2Role: 'ambient' },
  },
  {
    label: 'Preset 3: Reassign O2 Role → Oxidizer Stream (Burner Coflow)',
    patch: { o2Role: 'oxidizer_stream' },
  },
];

export function VariantDiffPage() {
  const { activeSnapshot, loadReview, ensureCorpus, announce } = useEmber();

  const [thicknessMm, setThicknessMm] = useState('3.0');
  const [flowDirection, setFlowDirection] = useState<FlowDirection | ''>('opposed');
  const [flowCmS, setFlowCmS] = useState('');
  const [o2Pct, setO2Pct] = useState('');
  const [o2Role, setO2Role] = useState<GasRole | ''>('');
  const [pressureKpa, setPressureKpa] = useState('');
  const [gravityG, setGravityG] = useState('');

  const [variantResult, setVariantResult] = useState<DesignVariantResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeSnapshot) {
      void loadReview('demo-pmma-lunar');
    }
    void ensureCorpus();
  }, [activeSnapshot, loadReview, ensureCorpus]);

  const runVariant = async (patch: DesignVariantPatch) => {
    if (!activeSnapshot) return;
    setRunning(true);
    setError(null);
    try {
      const res = await applyDesignVariant(activeSnapshot.reviewId, patch, activeSnapshot.review);
      setVariantResult(res.result);
      announce(
        `Variant evaluated: ${res.result.invalidatedEdges.length} invalidated, ${res.result.weakenedEdges.length} weakened, ${res.result.retainedEdges.length} retained edges.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recalculate variant.');
    } finally {
      setRunning(false);
    }
  };

  const applyPreset = (presetPatch: DesignVariantPatch) => {
    setThicknessMm(presetPatch.thicknessMm != null ? String(presetPatch.thicknessMm) : '');
    setFlowDirection(presetPatch.flowDirection ?? '');
    setFlowCmS(typeof presetPatch.flowCmS === 'number' ? String(presetPatch.flowCmS) : '');
    setO2Pct(presetPatch.o2Pct != null ? String(presetPatch.o2Pct) : '');
    setO2Role(presetPatch.o2Role ?? '');
    setPressureKpa(presetPatch.pressureKpa != null ? String(presetPatch.pressureKpa) : '');
    setGravityG(presetPatch.gravityG != null ? String(presetPatch.gravityG) : '');
    void runVariant(presetPatch);
  };

  const handleSubmit = () => {
    const patch: DesignVariantPatch = {};
    if (thicknessMm.trim()) patch.thicknessMm = Number(thicknessMm);
    if (flowDirection) patch.flowDirection = flowDirection;
    if (flowCmS.trim()) patch.flowCmS = Number(flowCmS);
    if (o2Pct.trim()) patch.o2Pct = Number(o2Pct);
    if (o2Role) patch.o2Role = o2Role;
    if (pressureKpa.trim()) patch.pressureKpa = Number(pressureKpa);
    if (gravityG.trim()) patch.gravityG = Number(gravityG);
    void runVariant(patch);
  };

  const baseQ = activeSnapshot?.review.query;

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>Design Variant Comparison &amp; Dependency Diff</h1>
          <p className="page-lead">
            Modify Variant B parameters against Variant A ({activeSnapshot?.reviewId ?? 'loading…'}) to inspect how rule gates invalidate, weaken, or retain supporting experimental conclusions.
          </p>
        </div>
      </div>

      <section className="card stack-sm" aria-label="Variant Quick Presets">
        <h2 className="card-title">Quick Design Perturbation Presets</h2>
        <div className="btn-group">
          {VARIANT_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="btn btn-sm"
              disabled={!activeSnapshot || running}
              onClick={() => applyPreset(p.patch)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <div className="grid-2">
        {/* Variant A */}
        <section className="card stack-sm">
          <h2 className="card-title">Variant A (Active Base Review)</h2>
          {baseQ ? (
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.4rem 1rem' }}>
              <dt className="muted">Material / Geometry</dt>
              <dd style={{ margin: 0 }}>{baseQ.material ?? 'unspecified'} · {baseQ.geometry ?? 'unspecified'}</dd>
              <dt className="muted">Thickness</dt>
              <dd style={{ margin: 0 }} className="tabular">{baseQ.thicknessMm ?? 'unspecified'} mm</dd>
              <dt className="muted">O2 % / Role</dt>
              <dd style={{ margin: 0 }} className="tabular">{baseQ.o2Pct ?? 'unspecified'}% ({baseQ.o2Role})</dd>
              <dt className="muted">Pressure</dt>
              <dd style={{ margin: 0 }} className="tabular">{baseQ.pressureKpa ?? 'unspecified'} kPa</dd>
              <dt className="muted">Flow &amp; Direction</dt>
              <dd style={{ margin: 0 }} className="tabular">
                {Array.isArray(baseQ.flowCmS) ? `${baseQ.flowCmS[0]}–${baseQ.flowCmS[1]}` : baseQ.flowCmS ?? 'unspecified'} cm/s · {baseQ.flowDirection ?? 'any'}
              </dd>
              <dt className="muted">Gravity</dt>
              <dd style={{ margin: 0 }} className="tabular">{baseQ.gravityG ?? 'unspecified'} g ({baseQ.gravityRegime ?? 'n/a'})</dd>
            </dl>
          ) : (
            <p className="muted">Loading base query…</p>
          )}
        </section>

        {/* Variant B Editor */}
        <section className="card stack-md">
          <h2 className="card-title">Variant B (Perturbed Design Specification)</h2>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="var-thick" className="field-label">Thickness (mm)</label>
              <input id="var-thick" type="number" step="any" value={thicknessMm} onChange={(e) => setThicknessMm(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="var-fdir" className="field-label">Flow Direction</label>
              <select id="var-fdir" value={flowDirection} onChange={(e) => setFlowDirection(e.target.value as FlowDirection | '')}>
                <option value="">Keep base</option>
                <option value="concurrent">concurrent</option>
                <option value="opposed">opposed</option>
                <option value="quiescent">quiescent</option>
                <option value="coflow">coflow</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="var-flow" className="field-label">Flow Speed (cm/s)</label>
              <input id="var-flow" type="number" step="any" placeholder="Keep base" value={flowCmS} onChange={(e) => setFlowCmS(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="var-o2" className="field-label">O2 %</label>
              <input id="var-o2" type="number" step="any" placeholder="Keep base" value={o2Pct} onChange={(e) => setO2Pct(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="var-role" className="field-label">O2 Role</label>
              <select id="var-role" value={o2Role} onChange={(e) => setO2Role(e.target.value as GasRole | '')}>
                <option value="">Keep base</option>
                <option value="ambient">ambient</option>
                <option value="oxidizer_stream">oxidizer_stream</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="var-press" className="field-label">Pressure (kPa)</label>
              <input id="var-press" type="number" step="any" placeholder="Keep base" value={pressureKpa} onChange={(e) => setPressureKpa(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="var-grav" className="field-label">Gravity (g)</label>
              <input id="var-grav" type="number" step="any" placeholder="Keep base" value={gravityG} onChange={(e) => setGravityG(e.target.value)} />
            </div>
          </div>

          <button type="button" className="btn btn-primary" disabled={!activeSnapshot || running} onClick={handleSubmit}>
            {running ? 'Recalculating Rule Dependency Diff…' : 'Compute Variant B Dependency Diff'}
          </button>
        </section>
      </div>

      {error ? (
        <div className="banner banner-danger" role="alert">
          <span>{error}</span>
        </div>
      ) : null}

      {variantResult ? (
        <section className="stack-lg" aria-label="Dependency Diff Result">
          <div className="grid-4">
            <div className="kpi-tile">
              <span className="kpi-label">Retained Rule Edges</span>
              <span className="kpi-value" style={{ color: 'var(--ok)' }}>{variantResult.retainedEdges.length}</span>
            </div>
            <div className="kpi-tile">
              <span className="kpi-label">Weakened Rule Edges</span>
              <span className="kpi-value" style={{ color: 'var(--warn)' }}>{variantResult.weakenedEdges.length}</span>
            </div>
            <div className="kpi-tile">
              <span className="kpi-label">Invalidated Rule Edges</span>
              <span className="kpi-value" style={{ color: 'var(--danger)' }}>{variantResult.invalidatedEdges.length}</span>
            </div>
            <div className="kpi-tile">
              <span className="kpi-label">Test Verdict Shifts</span>
              <span className="kpi-value tabular">
                +{variantResult.verdictDelta.becameAdmissible.length} adm / -{variantResult.verdictDelta.becameInadmissible.length} inv
              </span>
            </div>
          </div>

          {/* Visual Dependency Diff Diagram */}
          <div className="card stack-md">
            <h2 className="card-title">Visual Causal Impact Chain: Parameter → Rule → Conclusion Delta</h2>
            {variantResult.impactChains.length === 0 ? (
              <p className="muted">No rule status changes triggered by this parameter delta.</p>
            ) : (
              <div className="stack-sm">
                {variantResult.impactChains.map((chain, idx) => (
                  <div
                    key={idx}
                    className={`banner ${
                      chain.severity === 'invalidated'
                        ? 'banner-danger'
                        : chain.severity === 'weakened'
                          ? 'banner-warn'
                          : 'banner-ok'
                    }`}
                    style={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <StatusPill
                      tone={chain.severity === 'invalidated' ? 'danger' : chain.severity === 'weakened' ? 'warn' : 'ok'}
                      icon={chain.severity === 'invalidated' ? '✕' : chain.severity === 'weakened' ? '⚠' : '✓'}
                      label={chain.severity.toUpperCase()}
                    />
                    <span className="mono">{chain.changedParameter}</span>
                    <span aria-hidden="true">→</span>
                    <span className="mono"><strong>{chain.affectedRuleOrEvidence}</strong></span>
                    <span aria-hidden="true">→</span>
                    <span>{chain.conclusionChange}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Updated Applicability Edges */}
          <div className="grid-3">
            {[
              { title: 'Invalidated Edges', edges: variantResult.invalidatedEdges, tone: 'danger' as const },
              { title: 'Weakened Edges', edges: variantResult.weakenedEdges, tone: 'warn' as const },
              { title: 'Retained Edges', edges: variantResult.retainedEdges, tone: 'ok' as const },
            ].map((grp) => (
              <div key={grp.title} className="card stack-sm">
                <h3 className="card-title">{grp.title} ({grp.edges.length})</h3>
                {grp.edges.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>None.</p>
                ) : (
                  grp.edges.map((e) => (
                    <div key={e.id} className="card-elevated stack-sm" style={{ padding: '0.75rem' }}>
                      <div className="pill-row">
                        <StatusPill tone={grp.tone} label={e.ruleId} />
                        <span className="mono muted">{e.fromParameter}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.86rem' }}>{e.reason}</p>
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>

          {/* Updated Rankings Delta */}
          <div className="card stack-sm">
            <h2 className="card-title">Updated Investigation Applicability (Top 6)</h2>
            <div className="grid-3">
              {variantResult.updatedRankings.slice(0, 6).map((r) => (
                <div key={r.inv.id} className="card-elevated stack-sm" style={{ padding: '0.75rem' }}>
                  <div className="pill-row" style={{ justifyContent: 'space-between' }}>
                    <strong>{r.inv.id}</strong>
                    <VerdictBadge verdict={r.status} />
                  </div>
                  <div className="tabular muted" style={{ fontSize: '0.82rem' }}>
                    Applicability: {r.applicabilityScore.toFixed(2)} · Admissible: {r.admissibleCount} · Conditional: {r.conditionalCount}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
