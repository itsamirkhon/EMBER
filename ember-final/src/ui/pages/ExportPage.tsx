import { useEffect, useMemo, useState } from 'react';
import type { FuelPhase } from '../../core';
import { exportReviewText, type ModelingExportScope } from '../apiClient';
import { StatusPill } from '../components/StatusPill';
import { useEmber } from '../context/EmberContext';

const COMPATIBLE_MODELING_COMBINATIONS: Array<{
  id: string;
  label: string;
  fuelPhase: FuelPhase;
  endpoint: ModelingExportScope['endpoint'];
}> = [
  {
    id: 'solid_spread',
    label: 'Solid Flammability — Spread Rate (spreadRateMmS, mm/s)',
    fuelPhase: 'solid',
    endpoint: 'spread_rate',
  },
  {
    id: 'solid_smoke_particle',
    label: 'Solid / Pyrolysis Detection — Smoke Particle Size (particleSizeNm, nm)',
    fuelPhase: 'solid',
    endpoint: 'smoke_particle_size',
  },
  {
    id: 'liquid_burn_rate',
    label: 'Liquid Droplet Combustion — Burning Rate Constant (burningRateMm2S, mm²/s)',
    fuelPhase: 'liquid',
    endpoint: 'burning_rate_constant',
  },
  {
    id: 'gas_smoke_point',
    label: 'Gas Jet Laminar Flame — Smoke Point Length (smokePointLengthMm, mm)',
    fuelPhase: 'gas',
    endpoint: 'smoke_point_length',
  },
];

function triggerDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ExportPage() {
  const { activeSnapshot, loadReview, announce } = useEmber();
  const [selectedModelComboId, setSelectedModelComboId] = useState<string>('solid_spread');
  const [previewText, setPreviewText] = useState<string>('');
  const [previewTitle, setPreviewTitle] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeSnapshot) {
      void loadReview('demo-pmma-lunar');
    }
  }, [activeSnapshot, loadReview]);

  const activeCombo = useMemo(
    () => COMPATIBLE_MODELING_COMBINATIONS.find((c) => c.id === selectedModelComboId) ?? null,
    [selectedModelComboId],
  );

  const handleExport = async (
    format: 'markdown' | 'json' | 'csv' | 'modeling_csv',
    download: boolean,
  ) => {
    if (!activeSnapshot) return;
    if (format === 'modeling_csv' && !activeCombo) {
      setError('Select a single compatible fuelPhase and target endpoint for Predictive Modeling CSV.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const scope: ModelingExportScope | undefined =
        format === 'modeling_csv' && activeCombo
          ? { fuelPhase: activeCombo.fuelPhase, endpoint: activeCombo.endpoint }
          : undefined;
      const res = await exportReviewText(activeSnapshot.reviewId, format, activeSnapshot.review, scope);
      setPreviewTitle(`${res.filename} (${res.content.split('\n').length} lines)`);
      setPreviewText(res.content.split('\n').slice(0, 40).join('\n'));
      if (download) {
        triggerDownload(res.content, res.filename, res.mimeType);
        announce(`Downloaded ${res.filename}`);
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
            Clean test tables for modeling, with the PSI source and row of every record, plus Markdown and JSON reports of a review. Unknown values stay empty; they are never filled with zero, and fuel phases are never mixed.
          </p>
        </div>
      </div>

      {error ? (
        <div className="banner banner-danger" role="alert">
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid-2">
        <section className="card stack-md">
          <h2 className="card-title">Standard Review Artifacts ({activeSnapshot?.reviewId ?? 'loading…'})</h2>
          <p className="muted" style={{ margin: 0 }}>
            Exports preserve mode badges, source citation lists, rule evaluation verdicts, and applicability gaps.
          </p>
          <div className="btn-group">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!activeSnapshot || busy}
              onClick={() => void handleExport('markdown', true)}
            >
              Download Markdown (.md)
            </button>
            <button
              type="button"
              className="btn"
              disabled={!activeSnapshot || busy}
              onClick={() => void handleExport('json', true)}
            >
              Download JSON Snapshot
            </button>
            <button
              type="button"
              className="btn"
              disabled={!activeSnapshot || busy}
              onClick={() => void handleExport('csv', true)}
            >
              Download Test Evidence CSV
            </button>
          </div>
          <div className="btn-group">
            <button
              type="button"
              className="btn btn-sm"
              disabled={!activeSnapshot || busy}
              onClick={() => void handleExport('markdown', false)}
            >
              Preview Markdown
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!activeSnapshot || busy}
              onClick={() => void handleExport('csv', false)}
            >
              Preview Evidence CSV
            </button>
          </div>
        </section>

        <section className="card stack-md">
          <div className="card-header">
            <h2 className="card-title">Predictive Modeling CSV (Single-Endpoint Gate)</h2>
            <StatusPill tone="ok" icon="🔒" label="groupId & null preserved" />
          </div>

          <div className="banner banner-info" style={{ fontSize: '0.86rem' }}>
            <span>
              Enforces single compatible <span className="mono">fuelPhase</span> &amp; <span className="mono">endpoint</span>. Preserves <span className="mono">groupId</span> (anti-leakage split key), <span className="mono">o2Role</span>, provenance fields, and explicit blanks/nulls without zero imputation.
            </span>
          </div>

          <div className="field">
            <label htmlFor="modeling-combo" className="field-label">
              Compatible Fuel Phase &amp; Target Endpoint (Mandatory)
            </label>
            <select
              id="modeling-combo"
              value={selectedModelComboId}
              onChange={(e) => setSelectedModelComboId(e.target.value)}
            >
              {COMPATIBLE_MODELING_COMBINATIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="btn-group">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!activeSnapshot || !activeCombo || busy}
              onClick={() => void handleExport('modeling_csv', true)}
            >
              Download Modeling CSV
            </button>
            <button
              type="button"
              className="btn"
              disabled={!activeSnapshot || !activeCombo || busy}
              onClick={() => void handleExport('modeling_csv', false)}
            >
              Preview Modeling CSV
            </button>
          </div>
        </section>
      </div>

      {previewText ? (
        <section className="card stack-sm" aria-label="Export File Preview">
          <h2 className="card-title">Preview: {previewTitle}</h2>
          <pre className="source-pre">{previewText}</pre>
        </section>
      ) : null}
    </div>
  );
}
