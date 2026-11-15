import { useEffect, useMemo, useState } from 'react';
import type { FuelPhase } from '../../core';
import { exportCorpusText, exportReviewText, type ModelingExportScope } from '../apiClient';
import { StatusPill } from '../components/StatusPill';
import { useEmber } from '../context/EmberContext';

const COMPATIBLE_MODELING_COMBINATIONS: Array<{
  id: string;
  label: string;
  fuelPhase: FuelPhase;
  endpoint: ModelingExportScope['endpoint'];
}> = [
  { id: 'solid_spread', label: 'Solid Flammability — Spread Rate (mm/s)', fuelPhase: 'solid', endpoint: 'spread_rate' },
  { id: 'solid_smoke_particle', label: 'Solid / Pyrolysis — Smoke Particle Size (nm)', fuelPhase: 'solid', endpoint: 'smoke_particle_size' },
  { id: 'liquid_burn_rate', label: 'Liquid Droplet — Burning Rate Constant (mm²/s)', fuelPhase: 'liquid', endpoint: 'burning_rate_constant' },
  { id: 'gas_smoke_point', label: 'Gas Jet — Smoke Point Length (mm)', fuelPhase: 'gas', endpoint: 'smoke_point_length' },
];

type ExportKind = 'corpus_json' | 'corpus_csv' | 'modeling_csv' | 'review_markdown' | 'review_json' | 'review_csv';

function triggerDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Do not revoke immediately: some browsers defer reading the object URL.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

export function ExportPage() {
  const { activeSnapshot, activeLoading, activeError, loadReview, announce } = useEmber();
  const [selectedModelComboId, setSelectedModelComboId] = useState('solid_spread');
  const [previewText, setPreviewText] = useState('');
  const [previewTitle, setPreviewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeSnapshot) {
      void loadReview('demo-pmma-lunar');
    }
  }, [activeSnapshot, loadReview]);

  const activeCombo = useMemo(
    () => COMPATIBLE_MODELING_COMBINATIONS.find((item) => item.id === selectedModelComboId) ?? null,
    [selectedModelComboId],
  );

  const handleExport = async (kind: ExportKind, download: boolean) => {
    setError(null);
    if (kind.startsWith('review_') && !activeSnapshot) {
      setError('A review must finish loading before exporting its report. Corpus exports work independently.');
      return;
    }
    if (kind === 'modeling_csv' && !activeCombo) {
      setError('Select a compatible fuel phase and target endpoint for Modeling CSV.');
      return;
    }

    setBusy(true);
    try {
      const artifact =
        kind === 'corpus_json' ? await exportCorpusText('json') :
        kind === 'corpus_csv' ? await exportCorpusText('csv') :
        kind === 'modeling_csv' ? await exportCorpusText('modeling_csv', {
          fuelPhase: activeCombo!.fuelPhase,
          endpoint: activeCombo!.endpoint,
        }) :
        kind === 'review_markdown' ? await exportReviewText(activeSnapshot!.reviewId, 'markdown', activeSnapshot!.review) :
        kind === 'review_json' ? await exportReviewText(activeSnapshot!.reviewId, 'json', activeSnapshot!.review) :
        await exportReviewText(activeSnapshot!.reviewId, 'csv', activeSnapshot!.review);

      if (!artifact.content.trim() || /^\s*<(!doctype\s+html|html|head|body)\b/i.test(artifact.content)) {
        throw new Error('The requested export returned an empty response or HTML instead of a data file.');
      }
      const lines = artifact.content.split(/\r?\n/);
      setPreviewTitle(artifact.filename + ' (' + lines.length + ' lines)');
      setPreviewText(lines.slice(0, 40).join('\n'));

      if (download) {
        triggerDownload(artifact.content, artifact.filename, artifact.mimeType);
        announce('Download started: ' + artifact.filename);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>Download the data</h1>
          <p className="page-lead">
            Download the source-traced NASA PSI data, modeling tables, or saved review reports.
            Null and unknown values remain missing. Experimental groups and fuel phases are never silently mixed.
          </p>
        </div>
      </div>

      {error && <div className="banner banner-danger" role="alert"><span>{error}</span></div>}

      <div className="grid-2">
        <section className="card stack-md">
          <h2 className="card-title">NASA PSI Dataset — direct downloads</h2>
          <p className="muted" style={{ margin: 0 }}>
            Export the complete, normalized PSI corpus without a saved review or API server.
            Each test retains its investigation, group, experimental values and source ID.
          </p>
          <div className="btn-group">
            <button type="button" className="btn btn-primary" disabled={busy}
              onClick={() => void handleExport('corpus_json', true)}>
              Download Corpus JSON
            </button>
            <button type="button" className="btn" disabled={busy}
              onClick={() => void handleExport('corpus_csv', true)}>
              Download Test Evidence CSV
            </button>
          </div>
          <div className="btn-group">
            <button type="button" className="btn btn-sm" disabled={busy}
              onClick={() => void handleExport('corpus_json', false)}>
              Preview Corpus JSON
            </button>
            <button type="button" className="btn btn-sm" disabled={busy}
              onClick={() => void handleExport('corpus_csv', false)}>
              Preview Evidence CSV
            </button>
          </div>
        </section>

        <section className="card stack-md">
          <div className="card-header">
            <h2 className="card-title">Modeling CSV — one endpoint at a time</h2>
            <StatusPill tone="ok" icon="🔒" label="groupId & null preserved" />
          </div>
          <div className="banner banner-info" style={{ fontSize: '0.86rem' }}>
            <span>
              Select a compatible fuel phase and measured endpoint. Exports preserve
              replicate <span className="mono">groupId</span>, oxygen role, provenance,
              and missing values. This is a dataset export, not a validated predictive model.
            </span>
          </div>
          <div className="field">
            <label htmlFor="modeling-combo" className="field-label">Fuel Phase &amp; Endpoint</label>
            <select id="modeling-combo" value={selectedModelComboId}
              onChange={(e) => setSelectedModelComboId(e.target.value)}>
              {COMPATIBLE_MODELING_COMBINATIONS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </div>
          <div className="btn-group">
            <button type="button" className="btn btn-primary" disabled={!activeCombo || busy}
              onClick={() => void handleExport('modeling_csv', true)}>
              Download Modeling CSV
            </button>
            <button type="button" className="btn" disabled={!activeCombo || busy}
              onClick={() => void handleExport('modeling_csv', false)}>
              Preview Modeling CSV
            </button>
          </div>
        </section>
      </div>

      <section className="card stack-md">
        <h2 className="card-title">
          Review Reports ({activeSnapshot?.reviewId ?? (activeLoading ? 'loading demo…' : 'unavailable')})
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          These files describe the selected review, including its applicability and citations.
          Unlike corpus exports, they require a loaded review.
        </p>
        {!activeSnapshot && (
          <div className="banner banner-warn" role="status">
            <span>
              {activeLoading ? 'Loading a sample review for export…' :
                activeError ? 'Review unavailable: ' + activeError :
                'No review loaded. Dataset exports above still work.'}
            </span>
            {!activeLoading && (
              <button type="button" className="btn btn-sm"
                onClick={() => void loadReview('demo-pmma-lunar')}>
                Retry sample review
              </button>
            )}
          </div>
        )}
        <div className="btn-group">
          <button type="button" className="btn btn-primary" disabled={!activeSnapshot || busy}
            onClick={() => void handleExport('review_markdown', true)}>
            Download Review Markdown (.md)
          </button>
          <button type="button" className="btn" disabled={!activeSnapshot || busy}
            onClick={() => void handleExport('review_json', true)}>
            Download Review JSON
          </button>
          <button type="button" className="btn" disabled={!activeSnapshot || busy}
            onClick={() => void handleExport('review_csv', true)}>
            Download Reviewed-Test CSV
          </button>
          <button type="button" className="btn btn-sm" disabled={!activeSnapshot || busy}
            onClick={() => void handleExport('review_markdown', false)}>
            Preview Review Markdown
          </button>
        </div>
      </section>

      {previewText && (
        <section className="card stack-sm" aria-label="Export File Preview">
          <h2 className="card-title">Preview: {previewTitle}</h2>
          <pre className="source-pre">{previewText}</pre>
        </section>
      )}
    </div>
  );
}
