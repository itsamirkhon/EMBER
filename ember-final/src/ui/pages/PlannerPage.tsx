import { useEffect, useState } from 'react';
import type { TestProgramme } from '../../core';
import { recalculateTestProgramme } from '../apiClient';
import { StatusPill } from '../components/StatusPill';
import { useEmber } from '../context/EmberContext';

export function PlannerPage() {
  const { activeSnapshot, loadReview, updateActiveSnapshot, announce } = useEmber();
  const [budgetRuns, setBudgetRuns] = useState<number>(10);
  const [programme, setProgramme] = useState<TestProgramme | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeSnapshot) {
      void loadReview('demo-pmma-lunar');
    } else {
      setProgramme(activeSnapshot.review.testProgramme);
      setBudgetRuns(activeSnapshot.review.testProgramme.budgetRuns);
    }
  }, [activeSnapshot, loadReview]);

  const runOptimize = async (nextBudget: number) => {
    if (!activeSnapshot) return;
    setLoading(true);
    setError(null);
    try {
      const res = await recalculateTestProgramme(activeSnapshot.reviewId, nextBudget, activeSnapshot.review);
      setProgramme(res.testProgramme);
      updateActiveSnapshot({
        ...activeSnapshot,
        review: { ...activeSnapshot.review, testProgramme: res.testProgramme },
      });
      announce(
        `Optimized test programme for ${nextBudget} runs: ${res.testProgramme.selectedBlocks.length} blocks selected, coverage ${res.testProgramme.totalCoverageScore.toFixed(2)}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to optimize test programme');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>Test Programme Budget Planner</h1>
          <p className="page-lead">
            Exact branch-and-bound coverage selector across candidate TestBlocks derived from open evidence gaps, keeping mandatory controls and replicates locked in.
          </p>
        </div>
      </div>

      <div className="banner banner-warn">
        <span aria-hidden="true">ℹ</span>
        <div>
          <strong>Epistemic Boundary:</strong>{' '}
          {programme?.epistemicNote ??
            'Priority Question Coverage optimizer — NOT Bayesian information gain, posterior failure probability, or risk-weighted utility.'}
        </div>
      </div>

      <section className="card stack-md" aria-label="Test Budget Controls">
        <div className="card-header">
          <h2 className="card-title">Run Budget Allocation ({budgetRuns} Total Experimental Runs)</h2>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!activeSnapshot || loading}
            onClick={() => void runOptimize(budgetRuns)}
          >
            {loading ? 'Optimizing…' : 'Optimize Programme'}
          </button>
        </div>

        <div className="field-grid" style={{ alignItems: 'center' }}>
          <div className="field">
            <label htmlFor="budget-slider" className="field-label">Budget Slider (1–40 Runs)</label>
            <input
              id="budget-slider"
              type="range"
              min="1"
              max="40"
              value={budgetRuns}
              onChange={(e) => setBudgetRuns(Number(e.target.value))}
            />
          </div>
          <div className="field" style={{ maxInlineSize: 160 }}>
            <label htmlFor="budget-num" className="field-label">Exact Runs Budget</label>
            <input
              id="budget-num"
              type="number"
              min="1"
              max="100"
              value={budgetRuns}
              onChange={(e) => setBudgetRuns(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
        </div>

        {error ? (
          <div className="banner banner-danger" role="alert">
            <span>{error}</span>
          </div>
        ) : null}
      </section>

      {programme ? (
        <section className="stack-lg" aria-label="Optimized Test Programme">
          <div className="grid-4">
            <div className="kpi-tile">
              <span className="kpi-label">Used / Budget Runs</span>
              <span className="kpi-value tabular">
                {programme.usedRuns} / {programme.budgetRuns}
              </span>
            </div>
            <div className="kpi-tile">
              <span className="kpi-label">Priority Question Coverage</span>
              <span className="kpi-value tabular">{programme.totalCoverageScore.toFixed(2)}</span>
            </div>
            <div className="kpi-tile">
              <span className="kpi-label">Mandatory Controls</span>
              <div style={{ marginBlockStart: '0.35rem' }}>
                <StatusPill
                  tone={programme.mandatoryControlsPreserved ? 'ok' : 'warn'}
                  icon={programme.mandatoryControlsPreserved ? '🔒' : '⚠'}
                  label={programme.mandatoryControlsPreserved ? 'Locked & Preserved' : 'Budget Below Controls'}
                />
              </div>
            </div>
            <div className="kpi-tile">
              <span className="kpi-label">Replicate Integrity</span>
              <div style={{ marginBlockStart: '0.35rem' }}>
                <StatusPill
                  tone={programme.replicatesPreserved ? 'ok' : 'warn'}
                  icon={programme.replicatesPreserved ? '✓' : '⚠'}
                  label={programme.replicatesPreserved ? 'Replicates Enforced' : 'Insufficient Budget'}
                />
              </div>
            </div>
          </div>

          <div className="grid-2">
            {/* Selected Blocks */}
            <div className="card stack-sm">
              <h2 className="card-title">Selected Test Blocks ({programme.selectedBlocks.length})</h2>
              {programme.selectedBlocks.length === 0 ? (
                <p className="muted">No blocks fit within current budget ({programme.budgetRuns} runs).</p>
              ) : (
                programme.selectedBlocks.map((b) => (
                  <article key={b.blockId} className="card-elevated stack-sm">
                    <div className="card-header" style={{ marginBlockEnd: 0 }}>
                      <strong className="mono">{b.blockId} — {b.title}</strong>
                      <div className="pill-row">
                        {b.isMandatoryControl ? (
                          <StatusPill tone="accent" icon="🔒" label="Mandatory Control" />
                        ) : (
                          <StatusPill tone="info" label={b.category} />
                        )}
                        <StatusPill tone="ok" label={`${b.runsRequired} runs (${b.replicatesPerCondition} reps)`} />
                      </div>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.88rem' }}>{b.rationale}</p>
                    <div className="muted" style={{ fontSize: '0.82rem' }}>
                      Conditions: {b.conditions.material} ({b.conditions.geometry}) · O2={b.conditions.o2Pct ?? '?'}% · P={b.conditions.pressureKpa ?? '?'} kPa · Flow={b.conditions.flowCmS ?? '?'} cm/s · g={b.conditions.gravityG ?? '?'} · Coverage={b.questionCoverageScore.toFixed(2)}
                    </div>
                    <div className="pill-row">
                      {b.priorityQuestions.map((pq, i) => (
                        <StatusPill key={i} tone="neutral" label={pq} />
                      ))}
                    </div>
                  </article>
                ))
              )}
            </div>

            {/* Excluded Blocks */}
            <div className="card stack-sm">
              <h2 className="card-title">Deferred / Unfunded Candidate Blocks ({programme.excludedBlocks.length})</h2>
              {programme.excludedBlocks.length === 0 ? (
                <p className="muted">All candidate gap-filling blocks are funded within the current budget.</p>
              ) : (
                programme.excludedBlocks.map((b) => (
                  <article key={b.blockId} className="card" style={{ padding: '0.8rem', opacity: 0.9 }}>
                    <div className="card-header" style={{ marginBlockEnd: '0.3rem' }}>
                      <strong className="mono">{b.blockId} — {b.title}</strong>
                      <StatusPill tone="warn" label={`Needs ${b.runsRequired} runs`} />
                    </div>
                    <p className="muted" style={{ margin: 0, fontSize: '0.86rem' }}>{b.addressesGap}</p>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
