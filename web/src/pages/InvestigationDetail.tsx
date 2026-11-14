import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ScatterPlot from '../components/ScatterPlot';
import { testToPoint } from '../components/testPoints';
import { useData } from '../data/context';
import { DIM_LABEL, DIM_UNIT, NUMERIC_TARGETS, TARGET_LABEL, TARGET_UNIT, targetValue, type Dim, type NumericTarget } from '../lib/evidence';
import { testsToCsv } from '../lib/csv';
import { DirectionTags, downloadText, findSource, fmtGravity, fmtNum, SourceLink, Term } from '../components/ui';
import { ConditionsLine } from './Investigations';

function List({ items }: { items: string[] }) {
  if (!items.length) return <p className="muted small">Not documented.</p>;
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

export default function InvestigationDetail() {
  const { id = '' } = useParams();
  const { investigations, tests, claims } = useData();
  const inv = investigations.find((i) => i.id === id);
  const rows = useMemo(() => tests.filter((t) => t.inv === id), [tests, id]);
  const [yDim, setYDim] = useState<Dim | NumericTarget | null>(null);
  const invClaims = claims.filter((c) => c.inv === id);
  if (!inv) return <p>Investigation “{id}” not found. <Link to="/investigations">All investigations</Link></p>;

  const numericTargets = NUMERIC_TARGETS.filter((nt) => rows.some((t) => t.o2Pct !== null && targetValue(t, nt) !== null));
  const isNumeric = (k: string): k is NumericTarget => (NUMERIC_TARGETS as string[]).includes(k);
  // default to the first axis this investigation has data for
  const has = (d: Dim) => rows.some((t) => t.o2Pct !== null && t[d] !== null);
  const fallback: Dim | NumericTarget = has('flowCmS') ? 'flowCmS' : numericTargets[0] ?? (has('pressureKpa') ? 'pressureKpa' : 'flowCmS');
  const yKey = yDim === null || (isNumeric(yDim) && !numericTargets.includes(yDim)) ? fallback : yDim;
  const yLabel = isNumeric(yKey) ? `${TARGET_LABEL[yKey]} (${TARGET_UNIT[yKey]})` : `${DIM_LABEL[yKey]} (${DIM_UNIT[yKey]})`;
  const points = rows
    .map((t) => {
      if (!isNumeric(yKey)) return testToPoint(t, 'o2Pct', yKey);
      const v = targetValue(t, yKey);
      const p = v === null ? null : testToPoint(t, 'o2Pct', 'o2Pct');
      return p && v !== null ? { ...p, y: v, rows: [[TARGET_LABEL[yKey], `${v} ${TARGET_UNIT[yKey]}`] as [string, string], ...p.rows] } : null;
    })
    .filter((p) => p !== null);
  const sameFamily = investigations.filter((i) => i.family === inv.family && i.id !== inv.id);

  return (
    <>
      <nav className="small" aria-label="Breadcrumb" style={{ marginBottom: 8 }}>
        <Link to="/investigations">Investigations</Link> / {inv.id}
      </nav>
      <header className="page-head">
        <div className="eyebrow">{inv.family} · {inv.platform ?? 'platform n/a'}</div>
        <h1>{inv.name}</h1>
        <div className="row">
          <DirectionTags dirs={inv.direction} />
          <span className="tag">{inv.fuelPhase ?? 'phase n/a'} fuel</span>
          <span className="tag">consequence {inv.safetyConsequence}/3</span>
          <span className="tag">{inv.flight ? 'flight data' : inv.flight === false ? 'ground data' : 'flight ?'}</span>
          <span className="tag">{inv.rawDataAvailable ? 'raw data available' : 'no raw data'}</span>
          {inv.years && <span className="tag">{inv.years}</span>}
        </div>
        <p className="small" style={{ marginTop: 8 }}>
          {inv.psiUrl && (
            <a href={inv.psiUrl} target="_blank" rel="noreferrer">
              {inv.psi} on <Term k="psiRepo">PSI</Term>
            </a>
          )}
          {inv.doi && (
            <>
              {' · '}DOI{' '}
              <a href={`https://doi.org/${inv.doi}`} target="_blank" rel="noreferrer">
                {inv.doi}
              </a>
              {!inv.doiVerified && <span className="muted"> (not verified on PSI page)</span>}
            </>
          )}
        </p>
      </header>

      <div className="grid grid-2">
        <section className="card">
          <h2>Objective</h2>
          <p>{inv.objective ?? <span className="muted">Not documented.</span>}</p>
          <h3>Result summary</h3>
          <p>{inv.resultSummary ?? <span className="muted">Not documented.</span>}</p>
          <h3>Key findings</h3>
          {inv.keyFindings.length ? (
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {inv.keyFindings.map((k, i) => (
                <li key={i} style={{ marginBottom: 6 }}>
                  {k.text}{' '}
                  <span className="small">
                    <SourceLink source={findSource(k.sourceId, investigations, inv)} fallback={k.sourceId ? `[${k.sourceId}]` : '[unsourced]'} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">None extracted yet.</p>
          )}
          {inv.earthRelevance && (
            <p className="small" style={{ marginTop: 10 }}>
              <strong>Back on Earth:</strong> {inv.earthRelevance}
            </p>
          )}
        </section>
        <section className="card">
          <h2>Fuel &amp; conditions</h2>
          <dl className="small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', margin: '0 0 12px' }}>
            <dt className="muted">Fuel</dt>
            <dd style={{ margin: 0 }}>{inv.fuel?.types.join(', ') || '—'}</dd>
            <dt className="muted">Geometry</dt>
            <dd style={{ margin: 0 }}>{inv.fuel?.geometry ?? '—'}</dd>
            <dt className="muted">Size</dt>
            <dd style={{ margin: 0 }}>{inv.fuel?.size ?? '—'}</dd>
            <dt className="muted">Diluents</dt>
            <dd style={{ margin: 0 }}>{inv.conditions?.diluents?.join(', ') ?? '—'}</dd>
            <dt className="muted">Hardware</dt>
            <dd style={{ margin: 0 }}>
              {inv.hardware ?? '—'} (<Link to="/families">{inv.family}</Link>)
            </dd>
          </dl>
          <ConditionsLine inv={inv} tests={rows} />
          {inv.conditions?.assumed?.length ? (
            <div className="callout small" style={{ marginTop: 8 }}>
              <span className="tag tag-caveat">assumed</span> {inv.conditions.assumptionNote}
            </div>
          ) : null}
          <div className="grid grid-2" style={{ marginTop: 12, gap: 12 }}>
            <div>
              <h4>Varied</h4>
              <List items={inv.varied} />
            </div>
            <div>
              <h4>Held constant</h4>
              <List items={inv.constant} />
            </div>
          </div>
          <h4 style={{ marginTop: 12 }}>Diagnostics</h4>
          <List items={inv.diagnostics} />
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="panel-title">
          <h2 style={{ margin: 0 }}>Tests ({rows.length} rows)</h2>
          <div className="row">
            <label className="row small">
              y-axis
              <select value={yKey} onChange={(e) => setYDim(e.target.value as Dim | NumericTarget)}>
                <option value="flowCmS">Flow (cm/s)</option>
                <option value="pressureKpa">Pressure (kPa)</option>
                {numericTargets.map((nt) => (
                  <option key={nt} value={nt}>{TARGET_LABEL[nt]} ({TARGET_UNIT[nt]})</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => downloadText(`ember_${inv.id}_tests.csv`, testsToCsv(rows, investigations))} disabled={!rows.length}>
              Download CSV
            </button>
          </div>
        </div>
        {points.length > 0 ? (
          <ScatterPlot
            points={points}
            xLabel="O₂ (%)"
            yLabel={yLabel}
            height={300}
            summary={`${inv.id}: ${points.length} tests plotted by oxygen and ${yLabel.toLowerCase()}, coloured by outcome.`}
          />
        ) : (
          <p className="muted small">No tests with both O₂ and {yLabel.toLowerCase()} values to plot.</p>
        )}
        {rows.length > 0 && (
          <div className="table-wrap" style={{ maxHeight: 360, marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Fuel</th>
                  <th className="num">O₂ %</th>
                  <th className="num">kPa</th>
                  <th className="num">cm/s</th>
                  <th>g</th>
                  <th>Outcome</th>
                  <th className="num">Spread mm/s</th>
                  <th className="num">K mm²/s</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.testId}>
                    <td className="mono">{t.testId}</td>
                    <td>{t.fuel ?? '—'}{t.thicknessMm !== null ? ` · ${t.thicknessMm} mm` : ''}{t.diameterMm !== null ? ` · ⌀${t.diameterMm} mm` : ''}</td>
                    <td className="num">{fmtNum(t.o2Pct)}</td>
                    <td className="num">{fmtNum(t.pressureKpa)}</td>
                    <td className="num">{fmtNum(t.flowCmS)}</td>
                    <td>{fmtGravity(t.gravityG)}</td>
                    <td title={t.outcomeRaw ?? undefined}>{t.outcome}</td>
                    <td className="num">{fmtNum(t.spreadRateMmS, 2)}</td>
                    <td className="num">{fmtNum(t.burningRateMm2S, 2)}</td>
                    <td className="small muted">
                      {t.source.file ?? '—'}
                      {t.source.row !== null ? ` row ${t.source.row}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <h2>Extracted claims ({invClaims.length})</h2>
          {invClaims.length === 0 && <p className="muted small">No claims extracted for this investigation yet.</p>}
          {invClaims.map((c) => (
            <div key={c.id} className="claim">
              <div>
                {c.text}{' '}
                {c.sourceUrl ? (
                  <a className="cite" href={c.sourceUrl} target="_blank" rel="noreferrer">{c.id}</a>
                ) : (
                  <span className="cite">{c.id}</span>
                )}
              </div>
              {c.quote && <blockquote>“{c.quote}”</blockquote>}
            </div>
          ))}
        </section>
        <section className="card">
          <h2>Data notes</h2>
          <List items={inv.dataNotes} />
          <h3 style={{ marginTop: 12 }}>Sources</h3>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {inv.sources.map((s, i) => (
              <li key={i}>
                <SourceLink source={s} /> <span className="muted small">({s.type ?? 'source'})</span>
              </li>
            ))}
          </ul>
          {sameFamily.length > 0 && (
            <>
              <h3 style={{ marginTop: 12 }}>Same hardware family</h3>
              <p className="small">
                {sameFamily.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && ', '}
                    <Link to={`/investigations/${encodeURIComponent(s.id)}`}>{s.id}</Link>
                  </span>
                ))}{' '}
                — <Link to={`/compare?ids=${[inv.id, ...sameFamily.slice(0, 2).map((s) => s.id)].map(encodeURIComponent).join(',')}`}>compare</Link>
              </p>
            </>
          )}
        </section>
      </div>
    </>
  );
}
