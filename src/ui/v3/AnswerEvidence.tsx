import { nearestEvidenceTests, recordedFlowSteps } from '../../core/answerEvidence';
import { normalizeMaterialName } from '../../core/materials';
import type { ResearchQuery, ScientificValue, Test } from '../../core';
import { fmt, fmtG, outcomeText } from './data';
import { Ext } from './ui';

export { nearestEvidenceTests };

function Quantity({ value }: { value: ScientificValue<number> }) {
  if (value.value === null || value.provenance === 'unknown') return <>Not reported</>;
  return <>{fmt(value.value)} {value.unit}<small className="v3-muted"> · {value.provenance.replace(/_/g, ' ')}</small></>;
}

export function EvidenceComparison({ tests, query, nearby }: { tests: Test[]; query: ResearchQuery; nearby: boolean }) {
  if (!tests.length) return <p className="v3-muted">No nearby flight records with reported conditions were found in this corpus.</p>;
  return (
    <section className="v3-answer-evidence" aria-label="Experimental records comparison">
      <h3>{nearby ? 'Nearest flight records — context, not a prediction' : 'Compare the cited experiments'}</h3>
      <p className="v3-small v3-muted">Compare the recorded conditions before drawing conclusions. Each test ID opens its NASA source; unknown values stay unknown.</p>
      <div className="v3-answer-table-scroll" tabIndex={0} aria-label="Scrollable experiment comparison">
        <table className="v3-answer-table">
          <caption>{nearby ? 'Nearby records do not establish the outcome at your requested conditions.' : 'Descriptive comparison; differences between experiments do not establish causation.'}</caption>
          <thead><tr><th scope="col">Test / material</th><th scope="col">Thickness</th><th scope="col">O₂</th><th scope="col">Pressure</th><th scope="col">Initial airflow</th><th scope="col">Gravity</th><th scope="col">Recorded outcome</th></tr></thead>
          <tbody>{tests.map(t => <tr key={t.testId}>
            <th scope="row"><Ext href={t.sourceRef.url}>{t.testId}</Ext><br />{t.fuel ?? 'Not reported'}</th>
            <td><Quantity value={t.thicknessMm} /></td><td><Quantity value={t.atmosphere.o2} /></td><td><Quantity value={t.atmosphere.pressure} /></td>
            <td><Quantity value={t.flow.initialFlowCmS} /><br /><small>{t.flow.direction.replace(/_/g, ' ')}</small></td>
            <td>{t.gravity.gravityG.value === null ? 'Not reported' : fmtG(t.gravity.gravityG.value)}<br /><small>{t.gravity.mode.replace(/_/g, ' ')}</small></td>
            <td>{outcomeText(t.initialOutcome, t.terminalEvent)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {nearby && <ul className="v3-small">{tests.map(t => <li key={t.testId}>
        <b>{t.testId}:</b>{' '}
        {query.material && normalizeMaterialName(query.material) !== normalizeMaterialName(t.fuel) && <><strong>Different material: {t.fuel ?? 'unreported'}; requested {query.material}.</strong>{' '}</>}
        {query.o2Pct !== null && <>O₂ requested {fmt(query.o2Pct)}%, recorded {fmt(t.atmosphere.o2.value)}%. </>}
        {query.pressureKpa !== null && <>Pressure requested {fmt(query.pressureKpa)} kPa, recorded {fmt(t.atmosphere.pressure.value)} kPa. </>}
        {query.gravityG !== null && <>Gravity requested {fmtG(query.gravityG)}, recorded {t.gravity.gravityG.value === null ? 'not reported' : fmtG(t.gravity.gravityG.value)}. </>}
        <a href={`#/protocol-compare?testId=${encodeURIComponent(t.testId)}&inv=${encodeURIComponent(t.inv)}`}>Inspect protocol and comparison</a>
      </li>)}</ul>}
      {tests.map(t => {
        const steps = recordedFlowSteps(t);
        return steps.length ? <div key={t.testId} className="v3-flow-sequence">
          <h4>{t.testId}: recorded airflow sequence</h4>
          <ol aria-label={`${t.testId} airflow steps`}>{steps.map((flow, i) => <li key={i}>{fmt(flow)} <small>cm/s</small></li>)}</ol>
          <p className="v3-small v3-muted">Recorded order, not a time axis: step durations are not established here. {outcomeText(t.initialOutcome, t.terminalEvent)}. This sequence does not establish an exact extinction threshold.</p>
          <Ext href={t.flow.initialFlowCmS.sourceRef?.url ?? t.sourceRef.url}>Flow source</Ext>{' · '}
          <a href={`#/protocol-compare?testId=${encodeURIComponent(t.testId)}&inv=${encodeURIComponent(t.inv)}`}>Inspect full protocol</a>
        </div> : null;
      })}
    </section>
  );
}
