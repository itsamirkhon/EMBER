import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { parseResearchQuery, rankInvestigationsV2, type Investigation, type InvestigationRankV2 } from '../../core';
import { StatusPill, VerdictBadge } from '../components/StatusPill';
import { useEmber } from '../context/EmberContext';

function ScoreBar({ label, score, tone }: { label: string; score: number; tone?: 'ok' | 'info' }) {
  const pct = Math.max(0, Math.min(100, Math.round(score * 100)));
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBlockEnd: '0.2rem' }}>
        <span className="muted">{label}</span>
        <span className="tabular">{score.toFixed(2)}</span>
      </div>
      <div className="score-bar-track" aria-hidden="true">
        <div className={`score-bar-fill ${tone ?? ''}`} style={{ inlineSize: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ExplorerPage() {
  const { investigations, investigationsLoading, activeSnapshot, corpus, ensureCorpus } = useEmber();
  const [searchText, setSearchText] = useState('');
  const [directionFilter, setDirectionFilter] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('');
  const [epistemicFilter, setEpistemicFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');

  useEffect(() => {
    if (!corpus) {
      void ensureCorpus();
    }
  }, [corpus, ensureCorpus]);

  const activeQuery = useMemo(
    () =>
      activeSnapshot?.review.query ??
      parseResearchQuery('PMMA flame spread and extinction under concurrent flow in spacecraft'),
    [activeSnapshot],
  );

  const rankByInv = useMemo(() => {
    const map = new Map<string, InvestigationRankV2>();
    if (corpus) {
      for (const r of rankInvestigationsV2(activeQuery, corpus)) {
        map.set(r.inv.id, r);
      }
    } else if (activeSnapshot) {
      for (const r of activeSnapshot.review.evidencePackage.rankings) {
        map.set(r.inv.id, r);
      }
    }
    return map;
  }, [corpus, activeQuery, activeSnapshot]);

  const platforms = useMemo(
    () => [...new Set(investigations.map((i) => i.platform).filter((p): p is string => Boolean(p)))].sort(),
    [investigations],
  );

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const list = investigations.filter((inv: Investigation) => {
      if (directionFilter && !inv.direction.includes(directionFilter as Investigation['direction'][number])) {
        return false;
      }
      if (phaseFilter && inv.fuelPhase !== phaseFilter) return false;
      if (epistemicFilter && inv.epistemicStatus !== epistemicFilter) return false;
      if (platformFilter && inv.platform !== platformFilter) return false;
      if (q) {
        const hay = [
          inv.id,
          inv.name,
          inv.objective ?? '',
          inv.hardware ?? '',
          ...(inv.fuel?.types ?? []),
          ...(inv.varied ?? []),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      const ra = rankByInv.get(a.id)?.overallScore ?? 0;
      const rb = rankByInv.get(b.id)?.overallScore ?? 0;
      return rb - ra;
    });
  }, [investigations, searchText, directionFilter, phaseFilter, epistemicFilter, platformFilter, rankByInv]);

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>The {investigations.length} PSI investigations with test tables</h1>
          <p className="page-lead">
            Ranked for the current question: <span className="mono">{activeQuery.rawQuestion.slice(0, 96)}{activeQuery.rawQuestion.length > 96 ? '…' : ''}</span>. Three separate scales: does it answer the question, do its tests match the conditions, how reliable is the data.
          </p>
        </div>
        <Link to="/review" className="btn btn-sm">
          Change the question
        </Link>
      </div>

      <search className="card" aria-label="Filter NASA PSI Investigations">
        <div className="field-grid">
          <div className="field">
            <label htmlFor="exp-search" className="field-label">Search Material / ID / Hardware</label>
            <input
              id="exp-search"
              type="search"
              value={searchText}
              placeholder="e.g. BASS-II, PMMA, CFI, cool flame, smoke"
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="exp-dir" className="field-label">Safety Direction</label>
            <select id="exp-dir" value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)}>
              <option value="">All directions</option>
              <option value="prevention">prevention</option>
              <option value="detection">detection</option>
              <option value="suppression">suppression</option>
              <option value="fundamental">fundamental</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="exp-phase" className="field-label">Fuel Phase</label>
            <select id="exp-phase" value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)}>
              <option value="">All phases</option>
              <option value="solid">solid</option>
              <option value="liquid">liquid</option>
              <option value="gas">gas</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="exp-platform" className="field-label">Platform</label>
            <select id="exp-platform" value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
              <option value="">All platforms</option>
              {platforms.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="exp-epistemic" className="field-label">Epistemic Status</label>
            <select id="exp-epistemic" value={epistemicFilter} onChange={(e) => setEpistemicFilter(e.target.value)}>
              <option value="">All</option>
              <option value="observed">Observed Data</option>
              <option value="planned_only">Planned Matrix Only</option>
            </select>
          </div>
        </div>
      </search>

      {investigationsLoading ? (
        <div className="card"><p className="muted">Loading PSI investigations catalog…</p></div>
      ) : (
        <div className="grid-2">
          {filtered.map((inv) => {
            const rank = rankByInv.get(inv.id);
            return (
              <article key={inv.id} className="card stack-sm">
                <div className="card-header">
                  <div>
                    <h2 className="card-title">
                      <Link to={`/investigations/${encodeURIComponent(inv.id)}`}>
                        {inv.id} — {inv.name}
                      </Link>
                    </h2>
                    <span className="muted" style={{ fontSize: '0.82rem' }}>
                      {inv.family} · {inv.platform ?? 'Unknown platform'} · {inv.fuelPhase ?? 'mixed'} phase · {inv.coverageSummary.totalRows} test rows
                    </span>
                  </div>
                  <div className="pill-row">
                    {inv.epistemicStatus === 'planned_only' ? (
                      <StatusPill tone="planned" icon="◷" label="Planned Matrix Only" />
                    ) : (
                      <StatusPill tone="ok" icon="●" label="Observed" />
                    )}
                    {rank ? <VerdictBadge verdict={rank.status} /> : null}
                  </div>
                </div>

                {inv.objective ? (
                  <p style={{ margin: 0, fontSize: '0.9rem' }}>
                    {inv.objective.slice(0, 210)}{inv.objective.length > 210 ? '…' : ''}
                  </p>
                ) : null}

                {rank ? (
                  <div className="stack-sm card-elevated" style={{ padding: '0.75rem' }}>
                    <ScoreBar label="Answers the question" score={rank.relevanceScore} tone="info" />
                    <ScoreBar label="Matches the conditions" score={rank.applicabilityScore} tone="ok" />
                    <ScoreBar label="Data reliability" score={rank.evidenceQualityScore} />
                    <div className="pill-row" style={{ fontSize: '0.78rem' }}>
                      <span className="tabular">Apply: <strong>{rank.admissibleCount}</strong></span>
                      <span className="tabular">With caveats: <strong>{rank.conditionalCount}</strong></span>
                      <span className="tabular">Does not apply: <strong>{rank.inadmissibleCount}</strong></span>
                    </div>
                    {rank.unsupportedJointWarning ? (
                      <div className="banner banner-warn" style={{ padding: '0.45rem 0.65rem', fontSize: '0.8rem' }}>
                        <span aria-hidden="true">⚠</span>
                        <span>Marginal O2/pressure/flow ranges overlap, but joint operating corner is unverified.</span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
                    Loading full corpus applicability scoring…
                  </p>
                )}

                <div className="pill-row" style={{ justifyContent: 'space-between' }}>
                  <div className="pill-row">
                    {inv.direction.map((d) => (
                      <StatusPill key={d} tone="neutral" label={d} />
                    ))}
                  </div>
                  <Link to={`/investigations/${encodeURIComponent(inv.id)}`} className="btn btn-sm">
                    Open Investigation →
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
