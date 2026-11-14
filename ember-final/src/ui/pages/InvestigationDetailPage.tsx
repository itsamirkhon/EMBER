import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Range, Test } from '../../core';
import { getInvestigationDetail, type InvestigationDetailData } from '../apiClient';
import { SortableTable, type TableColumn } from '../components/SortableTable';
import { ProvenanceBadge, StatusPill } from '../components/StatusPill';
import { useEmber } from '../context/EmberContext';

function formatRange(r: Range, unit: string): string {
  if (!r) return 'Not specified';
  return r[0] === r[1] ? `${r[0]} ${unit}` : `${r[0]} – ${r[1]} ${unit}`;
}

export function InvestigationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { openSourceRef } = useEmber();
  const [data, setData] = useState<InvestigationDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testSearch, setTestSearch] = useState('');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getInvestigationDetail(id)
      .then((res) => {
        if (!cancelled) setData(res.detail);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load investigation');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const filteredTests = useMemo(() => {
    const tests = data?.tests ?? [];
    const q = testSearch.trim().toLowerCase();
    if (!q) return tests;
    return tests.filter((t) =>
      [t.testId, t.fuel ?? '', t.geometry ?? '', t.initialOutcome, t.terminalEvent ?? '', t.outcomeRaw ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [data, testSearch]);

  if (loading) {
    return (
      <div className="card">
        <p className="muted">Loading investigation dossier…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="banner banner-danger" role="alert">
        <span>{error ?? 'Investigation not found.'}</span>
      </div>
    );
  }

  const { investigation: inv, tests } = data;
  const assumedFields = new Set(inv.conditions?.assumed ?? []);

  const testColumns: TableColumn<Test>[] = [
    {
      key: 'testId',
      label: 'Test ID',
      sortable: true,
      isRowHeader: true,
      sortValue: (t) => t.testId,
      render: (t) => (
        <Link to={`/protocol-compare?testId=${encodeURIComponent(t.testId)}`} className="mono">
          {t.testId}
        </Link>
      ),
    },
    {
      key: 'fuel',
      label: 'Fuel / Geometry',
      sortable: true,
      sortValue: (t) => `${t.fuel ?? ''} ${t.geometry ?? ''}`,
      render: (t) => (
        <span>
          {t.fuel ?? 'n/a'} {t.geometry ? `(${t.geometry})` : ''}
        </span>
      ),
    },
    {
      key: 'o2',
      label: 'O2 %',
      numeric: true,
      sortable: true,
      sortValue: (t) => t.atmosphere.o2.value,
      render: (t) => (
        <span>
          {t.atmosphere.o2.value !== null ? `${t.atmosphere.o2.value}%` : '—'}{' '}
          {t.atmosphere.o2.provenance === 'assumed' ? (
            <StatusPill tone="warn" label="assumed" />
          ) : t.atmosphere.o2.role !== 'ambient' ? (
            <StatusPill tone="danger" label={t.atmosphere.o2.role} />
          ) : null}
        </span>
      ),
    },
    {
      key: 'pressure',
      label: 'P (kPa)',
      numeric: true,
      sortable: true,
      sortValue: (t) => t.atmosphere.pressure.value,
      render: (t) => (t.atmosphere.pressure.value !== null ? String(t.atmosphere.pressure.value) : '—'),
    },
    {
      key: 'flow',
      label: 'Flow (cm/s)',
      numeric: true,
      sortable: true,
      sortValue: (t) => t.flow.initialFlowCmS.value,
      render: (t) =>
        t.flow.initialFlowCmS.value !== null ? `${t.flow.initialFlowCmS.value} (${t.flow.direction})` : '—',
    },
    {
      key: 'initialOutcome',
      label: 'Initial Outcome',
      sortable: true,
      sortValue: (t) => t.initialOutcome,
      render: (t) => t.initialOutcome,
    },
    {
      key: 'terminalEvent',
      label: 'Terminal Event',
      sortable: true,
      sortValue: (t) => t.terminalEvent ?? '',
      render: (t) => t.terminalEvent ?? '—',
    },
    {
      key: 'protocol',
      label: 'Protocol',
      render: (t) => (
        <Link to={`/protocol-compare?testId=${encodeURIComponent(t.testId)}`} className="btn btn-sm">
          Steps ({t.segments.length})
        </Link>
      ),
    },
  ];

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <p className="muted" style={{ margin: '0 0 0.25rem' }}>
            <Link to="/explorer">← Back to Explorer</Link> · {inv.family} · PSI {inv.psi ?? 'n/a'}
          </p>
          <h1>{inv.id} — {inv.name}</h1>
          <div className="pill-row" style={{ marginBlockStart: '0.5rem' }}>
            {inv.epistemicStatus === 'planned_only' ? (
              <StatusPill tone="planned" icon="◷" label="Planned Matrix Only (0 observed tests)" />
            ) : (
              <StatusPill tone="ok" icon="●" label={`Observed (${inv.coverageSummary.totalRows} test rows)`} />
            )}
            <StatusPill tone="info" label={`Platform: ${inv.platform ?? 'n/a'}`} />
            {inv.doi ? <StatusPill tone="neutral" label={`DOI: ${inv.doi}`} /> : null}
          </div>
        </div>
      </div>

      {inv.epistemicStatus === 'planned_only' ? (
        <div className="banner banner-warn">
          <span aria-hidden="true">◷</span>
          <span>
            <strong>Planned Matrix Only:</strong> This investigation contains planned or baseline parameters only and zero flight test observations in the verified corpus.
          </span>
        </div>
      ) : null}

      {inv.conditions?.assumptionNote ? (
        <div className="banner banner-warn">
          <span aria-hidden="true">⚠</span>
          <span>
            <strong>Assumed Conditions Notice:</strong> {inv.conditions.assumptionNote}
          </span>
        </div>
      ) : null}

      <div className="grid-2">
        <section className="card stack-sm">
          <h2 className="card-title">Objective &amp; Method / Hardware</h2>
          <p style={{ margin: 0 }}>{inv.objective ?? 'Not recorded.'}</p>
          <p className="muted" style={{ margin: 0 }}>{inv.methodSummary}</p>
          <div>
            <strong>Hardware:</strong> {inv.hardware ?? 'n/a'} · <strong>Years:</strong> {inv.years ?? 'n/a'}
          </div>
          <div>
            <strong>Fuels / Geometry:</strong> {inv.fuel?.types.join(', ') ?? 'n/a'} · {inv.fuel?.geometry ?? 'n/a'}{' '}
            {inv.fuel?.size ? `(${inv.fuel.size})` : ''}
          </div>
          <div>
            <strong>Diagnostics:</strong> {inv.diagnostics.join(', ') || 'None specified'}
          </div>
        </section>

        <section className="card stack-sm">
          <h2 className="card-title">Condition Ranges &amp; Epistemic Provenance</h2>
          <div className="grid-2">
            <div className="kpi-tile">
              <span className="kpi-label">O2 Range</span>
              <span className="kpi-value" style={{ fontSize: '1rem' }}>
                {formatRange(inv.conditions?.o2Pct ?? null, '%')}
              </span>
              {assumedFields.has('o2Pct') ? <ProvenanceBadge provenance="assumed" /> : null}
            </div>
            <div className="kpi-tile">
              <span className="kpi-label">Pressure Range</span>
              <span className="kpi-value" style={{ fontSize: '1rem' }}>
                {formatRange(inv.conditions?.pressureKpa ?? null, 'kPa')}
              </span>
              {assumedFields.has('pressureKpa') ? <ProvenanceBadge provenance="assumed" /> : null}
            </div>
            <div className="kpi-tile">
              <span className="kpi-label">Flow Range</span>
              <span className="kpi-value" style={{ fontSize: '1rem' }}>
                {formatRange(inv.conditions?.flowCmS ?? null, 'cm/s')}
              </span>
            </div>
            <div className="kpi-tile">
              <span className="kpi-label">Gravity Range</span>
              <span className="kpi-value" style={{ fontSize: '1rem' }}>
                {formatRange(inv.conditions?.gravityG ?? null, 'g')}
              </span>
            </div>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>
            Coverage Note: {inv.coverageSummary.completenessNote}
          </p>
        </section>
      </div>

      <div className="grid-2">
        <section className="card stack-sm">
          <h2 className="card-title">Result Summary &amp; Key Findings</h2>
          <p style={{ margin: 0 }}>{inv.resultSummary ?? 'No summary recorded.'}</p>
          <ul className="stack-sm" style={{ margin: 0, paddingInlineStart: '1.15rem' }}>
            {inv.keyFindings.map((kf, idx) => (
              <li key={idx}>
                <span>{kf.text} </span>
                {kf.sourceId ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => openSourceRef({ sourceId: kf.sourceId!, quote: kf.text })}
                  >
                    Verify Source ({kf.sourceId})
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="card stack-sm">
          <h2 className="card-title">Limitations &amp; Sources</h2>
          {inv.limitations.length > 0 ? (
            <ul style={{ margin: 0, paddingInlineStart: '1.15rem' }}>
              {inv.limitations.map((l, idx) => (
                <li key={idx} style={{ marginBlockEnd: '0.35rem' }}>{l}</li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: 0 }}>No explicit limitation notes.</p>
          )}
          <div className="btn-group">
            {inv.sources.map((src, idx) => (
              <button
                key={`${src.label}-${idx}`}
                type="button"
                className="btn btn-sm"
                onClick={() => openSourceRef({ sourceId: src.id ?? src.label, url: src.url, quote: src.label })}
              >
                ▤ {src.label}
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* Per-Test Searchable Table */}
      <section className="stack-sm">
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Experimental Test Matrix ({filteredTests.length} of {tests.length})</h2>
            <div className="field" style={{ minInlineSize: 280 }}>
              <label htmlFor="inv-test-search" className="visually-hidden">Filter tests in {inv.id}</label>
              <input
                id="inv-test-search"
                type="search"
                value={testSearch}
                placeholder="Filter by testId, fuel, outcome…"
                onChange={(e) => setTestSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        <SortableTable
          caption={`${inv.id} Recorded Tests`}
          rows={filteredTests.slice(0, 200)}
          columns={testColumns}
          getRowKey={(t) => t.testId}
          initialSortKey="testId"
          emptyMessage={
            inv.epistemicStatus === 'planned_only'
              ? 'No observed test rows (Planned Matrix Only).'
              : 'No tests match the current filter.'
          }
        />
      </section>
    </div>
  );
}
