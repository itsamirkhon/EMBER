import { Link } from 'react-router-dom';
import type { ApplicabilityDecision, Review } from '../../core';
import { formatLocator, useEmber } from '../context/EmberContext';
import { ProvenanceBadge, StatusPill, VerdictBadge } from './StatusPill';

export function ProvenanceTrace({
  review,
  claimId,
  citations,
}: {
  review: Review;
  claimId: string;
  citations: string[];
}) {
  const { openSourceRef } = useEmber();

  const citedDecisions: ApplicabilityDecision[] = [];
  const decisionByTest = new Map(review.evidencePackage.applicabilityDecisions.map((d) => [d.testId, d]));
  const testById = new Map((review.evidencePackage.evaluatedTests ?? []).map((t) => [t.testId, t]));
  const chunkById = new Map(review.evidencePackage.retrievedHits.map((h) => [h.chunk.chunkId, h.chunk]));

  for (const cit of citations) {
    const dec = decisionByTest.get(cit);
    if (dec) citedDecisions.push(dec);
  }

  return (
    <details className="accordion" data-claim-id={claimId}>
      <summary>
        <span>Provenance Trace ({citations.length} citation{citations.length === 1 ? '' : 's'})</span>
        <span className="mono muted" style={{ marginInlineStart: 'auto', fontSize: '0.78rem' }}>
          {citations.slice(0, 4).join(', ')}
          {citations.length > 4 ? ` +${citations.length - 4}` : ''}
        </span>
      </summary>
      <div className="accordion-body stack-sm">
        {citedDecisions.length === 0 && citations.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No individual test or passage citations attached to this item.</p>
        ) : null}

        {citedDecisions.map((dec) => {
          const test = testById.get(dec.testId);
          return (
            <div key={dec.testId} className="card" style={{ padding: '0.75rem' }}>
              <div className="card-header" style={{ marginBlockEnd: '0.45rem' }}>
                <div className="pill-row">
                  <strong className="mono">{dec.testId}</strong>
                  <StatusPill tone="info" label={dec.inv} />
                  <VerdictBadge verdict={dec.verdict} />
                  {dec.protocolMatch.operatorTerminated ? (
                    <StatusPill tone="warn" icon="⏹" label="Operator Flow Shutoff (FT)" />
                  ) : null}
                  {dec.protocolMatch.coolFlamePresent ? (
                    <StatusPill tone="info" icon="❄" label="Cool Flame Continuation" />
                  ) : null}
                </div>
                <div className="btn-group">
                  <Link
                    to={`/compare?testId=${encodeURIComponent(dec.testId)}`}
                    className="btn btn-sm"
                  >
                    Open Protocol
                  </Link>
                  {dec.sourceRef?.sourceId ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() =>
                        openSourceRef({
                          ...dec.sourceRef,
                          sourceId: dec.sourceRef?.sourceId ?? dec.inv,
                        })
                      }
                    >
                      Verify Source
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="stack-sm" style={{ fontSize: '0.84rem' }}>
                <div>
                  <strong>Protocol Segment → Event:</strong>{' '}
                  <span className="mono">{dec.protocolMatch.segmentSummary}</span>
                  {dec.protocolMatch.matchedOutcomeLabel ? (
                    <span> · Outcome: <strong>{dec.protocolMatch.matchedOutcomeLabel}</strong></span>
                  ) : null}
                </div>

                {test && test.segments.length > 0 ? (
                  <div>
                    <strong>Stage Steps:</strong>{' '}
                    {test.segments
                      .map((s) => `[#${s.order}] ${s.stageType} (${s.intervention})`)
                      .join(' → ')}
                  </div>
                ) : null}

                <div>
                  <strong>Applicability Rules:</strong>{' '}
                  {dec.rules.map((r) => `${r.ruleId}:${r.status}`).join(' · ')}
                </div>

                {dec.sourceRef ? (
                  <div className="muted">
                    <strong>SourceRef:</strong> <span className="mono">{dec.sourceRef.sourceId}</span>
                    {formatLocator(dec.sourceRef) ? ` · ${formatLocator(dec.sourceRef)}` : ''}
                    {dec.sourceRef.quote ? ` — "${dec.sourceRef.quote}"` : ''}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        {citations
          .filter((c) => !decisionByTest.has(c))
          .map((cit) => {
            const chunk = chunkById.get(cit);
            return (
              <div key={cit} className="card" style={{ padding: '0.75rem', fontSize: '0.84rem' }}>
                <div className="card-header" style={{ marginBlockEnd: '0.35rem' }}>
                  <div className="pill-row">
                    <strong className="mono">{cit}</strong>
                    {chunk?.inv ? <StatusPill tone="info" label={chunk.inv} /> : null}
                    {chunk ? <ProvenanceBadge provenance={chunk.epistemicStatus === 'planned' ? 'planned' : 'reported'} /> : null}
                  </div>
                  {chunk?.sourceRef?.sourceId ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => openSourceRef(chunk.sourceRef)}
                    >
                      Verify Source
                    </button>
                  ) : null}
                </div>
                {chunk ? (
                  <p style={{ margin: 0 }}>{chunk.text.slice(0, 360)}{chunk.text.length > 360 ? '…' : ''}</p>
                ) : (
                  <p className="muted" style={{ margin: 0 }}>Citation identifier: {cit}</p>
                )}
              </div>
            );
          })}
      </div>
    </details>
  );
}
