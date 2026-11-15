import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { getSourceDetail, type SourceDetail } from '../apiClient';
import { useEmber } from '../context/EmberContext';
import { StatusPill } from './StatusPill';
import { safeExternalUrl } from '../safeUrl';

export function SourceModal() {
  const { sourceModal, closeSourceModal } = useEmber();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [detail, setDetail] = useState<SourceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (sourceModal) {
      if (!dialog.open) {
        dialog.showModal();
      }
      let cancelled = false;
      setLoading(true);
      setError(null);
      setDetail(null);
      setWarnings([]);

      getSourceDetail(sourceModal.sourceId)
        .then((res) => {
          if (cancelled) return;
          setDetail(res.source);
          setWarnings(res.meta.warnings);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : 'Unable to fetch source details.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    } else if (dialog.open) {
      dialog.returnValue = '';
      dialog.close();
    }
  }, [sourceModal]);

  const handleClose = () => {
    const dialog = dialogRef.current;
    if (dialog) {
      dialog.returnValue = '';
      if (dialog.open) dialog.close();
    }
    closeSourceModal();
  };

  // Fallback light-dismiss when browser does not yet support HTMLDialogElement.closedBy
  const handleDialogClick = (event: MouseEvent<HTMLDialogElement>) => {
    if ('closedBy' in HTMLDialogElement.prototype) return;
    const dialog = dialogRef.current;
    if (!dialog || event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const clickedInDialog =
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width;
    if (!clickedInDialog) {
      handleClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="source-dialog"
      aria-labelledby={titleId}
      onClose={() => {
        if (dialogRef.current) dialogRef.current.returnValue = '';
        closeSourceModal();
      }}
      onClick={handleDialogClick}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="dialog-header">
        <div>
          <h2 id={titleId} className="dialog-title">
            Source Verification: <span className="mono">{sourceModal?.sourceId ?? 'Source'}</span>
          </h2>
          {sourceModal?.locatorSummary ? (
            <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.82rem' }}>
              Locator: {sourceModal.locatorSummary}
            </p>
          ) : null}
        </div>
        <button type="button" className="btn btn-sm" onClick={handleClose} aria-label="Close source dialog">
          Close
        </button>
      </div>

      <div className="dialog-body stack-md">
        {sourceModal?.quote ? (
          <div className="banner banner-info">
            <div>
              <strong>Referenced Excerpt / Context</strong>
              <p style={{ margin: '0.3rem 0 0' }}>{sourceModal.quote}</p>
            </div>
          </div>
        ) : null}

        {loading ? <p className="muted">Loading source record and cached full text...</p> : null}

        {error ? (
          <div className="banner banner-danger" role="alert">
            <span>{error}</span>
          </div>
        ) : null}

        {warnings.map((w) => (
          <div key={w} className="banner banner-warn">
            <span>{w}</span>
          </div>
        ))}

        {detail ? (
          <div className="stack-sm">
            <div className="pill-row">
              {detail.type ? <StatusPill tone="info" icon="▤" label={detail.type} /> : null}
              {detail.hasFullText ? (
                <StatusPill tone="ok" icon="✓" label="Cached Full Text Loaded" />
              ) : (
                <StatusPill tone="warn" icon="ℹ" label="Metadata Only" />
              )}
              {detail.inv.map((inv) => (
                <StatusPill key={inv} tone="neutral" label={inv} />
              ))}
            </div>

            {detail.title || detail.label ? (
              <p style={{ margin: 0 }}>
                <strong>{detail.title ?? detail.label}</strong>
                {detail.year ? ` (${detail.year})` : ''}
              </p>
            ) : null}

            <div className="pill-row">
              {safeExternalUrl(detail.url) ? (
                <a href={safeExternalUrl(detail.url) ?? undefined} target="_blank" rel="noreferrer noopener" className="btn btn-sm">
                  Open External Source URI
                </a>
              ) : null}
              {detail.doi ? (
                <span className="mono muted">DOI: {detail.doi}</span>
              ) : null}
            </div>

            {detail.text ? (
              <div>
                <h3 style={{ fontSize: '0.9rem', marginBlockEnd: '0.4rem' }}>Cached Document Text</h3>
                <pre className="source-pre">{detail.text.slice(0, 24000)}</pre>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {detail.notes ?? 'No local plaintext body cached for this source ID; use the external source URI or corpus locator.'}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
