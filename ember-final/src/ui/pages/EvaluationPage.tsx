import { useEffect, useState } from 'react';
import { getEvaluationReport, type EvalReportData } from '../apiClient';
import { SortableTable, type TableColumn } from '../components/SortableTable';
import { StatusPill } from '../components/StatusPill';

interface MetricWithCI {
  value: number | null;
  numerator?: number;
  denominator?: number;
}

interface AggregateMetrics {
  caseCount?: number;
  investigationRecallAt5?: MetricWithCI;
  testRecallAt5?: MetricWithCI;
  applicabilityF1?: MetricWithCI;
  applicability3WayAccuracy?: MetricWithCI;
  expectedRuleRecall?: MetricWithCI;
  confusionMatrix?: {
    falseAdmissionRate?: number;
    falseRejectionRate?: number;
  };
  answerBoundaryAccuracy?: MetricWithCI;
  configChangeDirectionAccuracy?: MetricWithCI;
  jevRoutingAccuracy?: MetricWithCI;
  jevBrierScore?: number | null;
  plannerExactness?: MetricWithCI;
  verifierPassRate?: MetricWithCI;
  meanLatencyMs?: number;
}

interface VariantRow {
  variantId: string;
  label: string;
  description: string;
  overall: AggregateMetrics;
}

interface CompetitorRow {
  systemId: string;
  displayName: string;
  kind: string;
  totalCases: number;
  statusCounts: Record<string, number>;
  evaluatedAccuracy: {
    applicability3Way?: MetricWithCI;
    answerBoundaryAccuracy?: MetricWithCI;
    falseAdmissionRate?: MetricWithCI;
  };
  executionNote: string;
}

interface ErrorExampleRow {
  caseId: string;
  split: string;
  category: string;
  hardCaseTag: string;
  system: string;
  question: string;
  expected?: { applicabilityStatus?: string; answerBoundary?: string };
  predicted?: { applicabilityStatus?: string; answerBoundary?: string; rules?: string[] };
  explanation: string;
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

export function EvaluationPage() {
  const [report, setReport] = useState<EvalReportData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getEvaluationReport()
      .then((res) => {
        if (!cancelled) setReport(res.report);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="card">
        <p className="muted">Loading benchmark evaluation report…</p>
      </div>
    );
  }

  if (!report || report.status === 'not_measured' || !report.raw) {
    return (
      <div className="stack-lg">
        <div className="page-header">
          <div>
            <h1>Evaluation &amp; Benchmark Suite</h1>
            <p className="page-lead">
              100-case benchmark across Baselines A–D, 5 engine ablations, and Whole-Product / Common-Data comparisons.
            </p>
          </div>
          <StatusPill tone="warn" icon="◷" label="Not Yet Measured" />
        </div>

        <div className="banner banner-warn">
          <span aria-hidden="true">⚠</span>
          <div>
            <strong>Evaluation Metrics Not Yet Measured:</strong> Run{' '}
            <span className="mono">npm run eval</span> in <span className="mono">ember-final/</span> to generate{' '}
            <span className="mono">public/data/eval_report.json</span>. Zero simulated metrics are displayed prior to measurement.
          </div>
        </div>
      </div>
    );
  }

  const raw = report.raw;
  const datasetSummary = (raw.datasetSummary ?? {}) as {
    totalCases?: number;
    distinctGroups?: number;
    bySplit?: Record<string, number>;
    byCategory?: Record<string, number>;
    hardCaseTagCounts?: Record<string, number>;
  };
  const variants = (raw.variants ?? []) as VariantRow[];
  const ablations = (raw.ablations ?? []) as VariantRow[];
  const errorExamples = (raw.errorExamples ?? []) as ErrorExampleRow[];
  const competitorBenchmark = (raw.competitorBenchmark ?? {}) as {
    wholeProductSystems?: CompetitorRow[];
    commonDataExecutedComparison?: CompetitorRow[];
    epistemicHonestyStatement?: string;
  };

  const fullEmber = variants.find((v) => v.variantId.includes('Variant_D')) ?? variants[variants.length - 1];

  const variantColumns: TableColumn<VariantRow>[] = [
    {
      key: 'label',
      label: 'System Variant / Ablation',
      sortable: true,
      isRowHeader: true,
      sortValue: (v) => v.label,
      render: (v) => (
        <div>
          <strong>{v.label}</strong>
          <div className="muted" style={{ fontSize: '0.78rem' }}>{v.description}</div>
        </div>
      ),
    },
    {
      key: 'invR5',
      label: 'Inv R@5',
      numeric: true,
      sortable: true,
      sortValue: (v) => v.overall?.investigationRecallAt5?.value ?? -1,
      render: (v) => fmtPct(v.overall?.investigationRecallAt5?.value),
    },
    {
      key: 'testR5',
      label: 'Test R@5',
      numeric: true,
      sortable: true,
      sortValue: (v) => v.overall?.testRecallAt5?.value ?? -1,
      render: (v) => fmtPct(v.overall?.testRecallAt5?.value),
    },
    {
      key: 'appF1',
      label: 'App F1',
      numeric: true,
      sortable: true,
      sortValue: (v) => v.overall?.applicabilityF1?.value ?? -1,
      render: (v) => fmtPct(v.overall?.applicabilityF1?.value),
    },
    {
      key: 'ruleR',
      label: 'Rule Recall',
      numeric: true,
      sortable: true,
      sortValue: (v) => v.overall?.expectedRuleRecall?.value ?? -1,
      render: (v) => fmtPct(v.overall?.expectedRuleRecall?.value),
    },
    {
      key: 'app3',
      label: 'App 3-Way',
      numeric: true,
      sortable: true,
      sortValue: (v) => v.overall?.applicability3WayAccuracy?.value ?? -1,
      render: (v) => fmtPct(v.overall?.applicability3WayAccuracy?.value),
    },
    {
      key: 'falseAdm',
      label: 'False Adm',
      numeric: true,
      sortable: true,
      sortValue: (v) => v.overall?.confusionMatrix?.falseAdmissionRate ?? 999,
      render: (v) => fmtPct(v.overall?.confusionMatrix?.falseAdmissionRate),
    },
    {
      key: 'boundary',
      label: 'Boundary Acc',
      numeric: true,
      sortable: true,
      sortValue: (v) => v.overall?.answerBoundaryAccuracy?.value ?? -1,
      render: (v) => fmtPct(v.overall?.answerBoundaryAccuracy?.value),
    },
    {
      key: 'cfg',
      label: 'Config Change',
      numeric: true,
      sortable: true,
      sortValue: (v) => v.overall?.configChangeDirectionAccuracy?.value ?? -1,
      render: (v) => fmtPct(v.overall?.configChangeDirectionAccuracy?.value),
    },
    {
      key: 'jev',
      label: 'JEV Route',
      numeric: true,
      sortable: true,
      sortValue: (v) => v.overall?.jevRoutingAccuracy?.value ?? -1,
      render: (v) => fmtPct(v.overall?.jevRoutingAccuracy?.value),
    },
    {
      key: 'latency',
      label: 'Mean ms',
      numeric: true,
      sortable: true,
      sortValue: (v) => v.overall?.meanLatencyMs ?? 99999,
      render: (v) => (v.overall?.meanLatencyMs != null ? v.overall.meanLatencyMs.toFixed(1) : '—'),
    },
  ];

  const errorColumns: TableColumn<ErrorExampleRow>[] = [
    {
      key: 'caseId',
      label: 'Case / System',
      isRowHeader: true,
      sortable: true,
      sortValue: (e) => e.caseId,
      render: (e) => (
        <div>
          <strong className="mono">{e.caseId}</strong>
          <div className="muted mono" style={{ fontSize: '0.76rem' }}>{e.split} · {e.system}</div>
        </div>
      ),
    },
    {
      key: 'tag',
      label: 'Hard-Case Tag / Category',
      sortable: true,
      sortValue: (e) => e.hardCaseTag,
      render: (e) => (
        <div>
          <span className="mono">{e.hardCaseTag}</span>
          <div className="muted" style={{ fontSize: '0.76rem' }}>{e.category}</div>
        </div>
      ),
    },
    {
      key: 'expPred',
      label: 'Expected → Predicted',
      render: (e) => (
        <div className="mono" style={{ fontSize: '0.78rem' }}>
          <div>Exp: {e.expected?.applicabilityStatus ?? '?'} / {e.expected?.answerBoundary ?? '?'}</div>
          <div>Pred: {e.predicted?.applicabilityStatus ?? '?'} / {e.predicted?.answerBoundary ?? '?'}</div>
        </div>
      ),
    },
    {
      key: 'explanation',
      label: 'Diagnostic Explanation',
      render: (e) => (
        <div style={{ fontSize: '0.84rem' }}>
          <div>{e.explanation}</div>
          <div className="muted" style={{ fontSize: '0.76rem' }}>{e.question}</div>
        </div>
      ),
    },
  ];

  const competitorColumns: TableColumn<CompetitorRow>[] = [
    {
      key: 'name',
      label: 'System',
      isRowHeader: true,
      sortable: true,
      sortValue: (c) => c.displayName,
      render: (c) => (
        <div>
          <strong>{c.displayName}</strong>
          <div className="muted" style={{ fontSize: '0.78rem' }}>{c.executionNote}</div>
        </div>
      ),
    },
    {
      key: 'evaluated',
      label: 'Evaluated',
      numeric: true,
      render: (c) => `${c.statusCounts?.evaluated ?? 0} / ${c.totalCases}`,
    },
    {
      key: 'outside',
      label: 'Outside Scope / Not Run',
      numeric: true,
      render: (c) => `${(c.statusCounts?.outside_claimed_scope ?? 0) + (c.statusCounts?.not_run ?? 0)}`,
    },
    {
      key: 'app3',
      label: '3-Way App Acc',
      numeric: true,
      render: (c) => fmtPct(c.evaluatedAccuracy?.applicability3Way?.value),
    },
    {
      key: 'boundary',
      label: 'Boundary Acc',
      numeric: true,
      render: (c) => fmtPct(c.evaluatedAccuracy?.answerBoundaryAccuracy?.value),
    },
    {
      key: 'falseAdm',
      label: 'False Adm Rate',
      numeric: true,
      render: (c) => fmtPct(c.evaluatedAccuracy?.falseAdmissionRate?.value),
    },
  ];

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>Evaluation &amp; Scientific Benchmark Report</h1>
          <p className="page-lead">
            Measured 100-case benchmark across Baselines A–D, 5 engine ablations, and Whole-Product / Common-Data comparisons ({String(raw.generatedAt ?? '')}).
          </p>
        </div>
        <StatusPill tone="ok" icon="✓" label={`Measured (${String(raw.engineVersion ?? 'v2')})`} />
      </div>

      {raw.provenanceNote ? (
        <div className="banner banner-warn">
          <span aria-hidden="true">ℹ</span>
          <div>
            <strong>Benchmark Provenance ({String(raw.annotationProvenance ?? 'preliminary')}):</strong>{' '}
            {String(raw.provenanceNote)}
          </div>
        </div>
      ) : null}

      {fullEmber ? (
        <div className="grid-4">
          <div className="kpi-tile">
            <span className="kpi-label">Gold Cases / Group Clusters</span>
            <span className="kpi-value tabular">
              {String(datasetSummary.totalCases ?? fullEmber.overall.caseCount ?? 100)} cases /{' '}
              {String(datasetSummary.distinctGroups ?? 36)} groups
            </span>
          </div>
          <div className="kpi-tile">
            <span className="kpi-label">EMBER v2 Applicability F1</span>
            <span className="kpi-value tabular">{fmtPct(fullEmber.overall.applicabilityF1?.value)}</span>
          </div>
          <div className="kpi-tile">
            <span className="kpi-label">Expected Rule Recall</span>
            <span className="kpi-value tabular">{fmtPct(fullEmber.overall.expectedRuleRecall?.value)}</span>
          </div>
          <div className="kpi-tile">
            <span className="kpi-label">JEV Route / Planner Exact</span>
            <span className="kpi-value tabular">
              {fmtPct(fullEmber.overall.jevRoutingAccuracy?.value)} /{' '}
              {fmtPct(fullEmber.overall.plannerExactness?.value)}
            </span>
          </div>
        </div>
      ) : null}

      <SortableTable
        caption="Baselines A–D Comparison (100-Case Gold Suite)"
        rows={variants}
        columns={variantColumns}
        getRowKey={(v) => v.variantId}
      />

      <SortableTable
        caption="5 Engine Ablations (Protocol, Geometry, Outcomes, JEV, Retrieval)"
        rows={ablations}
        columns={variantColumns}
        getRowKey={(v) => v.variantId}
      />

      {competitorBenchmark.epistemicHonestyStatement ? (
        <div className="banner banner-info">
          <span aria-hidden="true">ℹ</span>
          <span>{competitorBenchmark.epistemicHonestyStatement}</span>
        </div>
      ) : null}

      {competitorBenchmark.wholeProductSystems ? (
        <SortableTable
          caption="Whole-Product Scope & Availability Comparison"
          rows={competitorBenchmark.wholeProductSystems}
          columns={competitorColumns}
          getRowKey={(c) => c.systemId}
        />
      ) : null}

      {competitorBenchmark.commonDataExecutedComparison ? (
        <SortableTable
          caption="Common-Data Capability Comparison (Identical NASA PSI Corpus)"
          rows={competitorBenchmark.commonDataExecutedComparison}
          columns={competitorColumns}
          getRowKey={(c) => c.systemId}
        />
      ) : null}

      {datasetSummary.bySplit || datasetSummary.hardCaseTagCounts ? (
        <section className="card stack-sm" aria-label="Benchmark Splits and Hard-Case Coverage">
          <h2 className="card-title">100-Case Benchmark Split &amp; Hard-Case Coverage</h2>
          {datasetSummary.bySplit ? (
            <div className="pill-row">
              {Object.entries(datasetSummary.bySplit).map(([k, v]) => (
                <StatusPill key={k} tone="info" label={`Split ${k}: ${v}`} />
              ))}
              {Object.entries(datasetSummary.byCategory ?? {}).map(([k, v]) => (
                <StatusPill key={k} tone="neutral" label={`${k}: ${v}`} />
              ))}
            </div>
          ) : null}
          {datasetSummary.hardCaseTagCounts ? (
            <div className="pill-row">
              {Object.entries(datasetSummary.hardCaseTagCounts).map(([tag, count]) => (
                <StatusPill key={tag} tone="accent" label={`${tag}: ${count}`} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {errorExamples.length > 0 ? (
        <SortableTable
          caption={`Sampled Error Cases & Refusal Failure Modes (${errorExamples.length} examples)`}
          rows={errorExamples}
          columns={errorColumns}
          getRowKey={(e) => `${e.caseId}-${e.system}`}
        />
      ) : null}
    </div>
  );
}
