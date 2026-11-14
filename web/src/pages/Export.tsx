import { useMemo, useState } from 'react';
import { useData } from '../data/context';
import { testsToCsv } from '../lib/csv';
import { binaryOutcome } from '../lib/evidence';
import { downloadText, fmtGravity, fmtNum, PageHead } from '../components/ui';

function num(v: string): number | null {
  return v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v);
}

export default function Export() {
  const { tests, investigations, manifest } = useData();
  const invIds = useMemo(() => [...new Set(tests.map((t) => t.inv))].sort(), [tests]);
  const [sel, setSel] = useState<string[]>([]);
  const [phase, setPhase] = useState('');
  const [outcome, setOutcome] = useState('');
  const [gravity, setGravity] = useState('');
  const [o2Min, setO2Min] = useState('');
  const [o2Max, setO2Max] = useState('');
  const [pMin, setPMin] = useState('');
  const [pMax, setPMax] = useState('');

  const rows = tests.filter((t) => {
    const lo = num(o2Min), hi = num(o2Max), plo = num(pMin), phi = num(pMax);
    if (sel.length && !sel.includes(t.inv)) return false;
    if (phase && t.fuelPhase !== phase) return false;
    if (outcome === 'burn' && binaryOutcome(t.outcome) !== 'burn') return false;
    if (outcome === 'noburn' && binaryOutcome(t.outcome) !== 'noburn') return false;
    if (outcome === 'other' && binaryOutcome(t.outcome) !== null) return false;
    if (gravity === 'micro' && !(t.gravityG !== null && t.gravityG <= 0.01)) return false;
    if (gravity === 'ground' && !(t.gravityG !== null && t.gravityG >= 0.9)) return false;
    if (lo !== null && (t.o2Pct === null || t.o2Pct < lo)) return false;
    if (hi !== null && (t.o2Pct === null || t.o2Pct > hi)) return false;
    if (plo !== null && (t.pressureKpa === null || t.pressureKpa < plo)) return false;
    if (phi !== null && (t.pressureKpa === null || t.pressureKpa > phi)) return false;
    return true;
  });
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <>
      <PageHead eyebrow="Module 4.8" title="Export clean data">
        <p>
          Download the normalized test table for predictive modelling. Units are fixed (O₂ %, kPa, cm/s, mm/s, mm²/s, g) and every row
          carries its provenance: investigation, PSI id, DOI, source file and row.
        </p>
      </PageHead>
      <section className="card">
        <div className="small muted" style={{ marginBottom: 6 }}>Investigations (none selected = all)</div>
        <div className="row" style={{ marginBottom: 12 }}>
          {invIds.map((id) => (
            <button key={id} type="button" className="chip-btn" aria-pressed={sel.includes(id)} onClick={() => toggle(id)}>
              {id}
            </button>
          ))}
        </div>
        <div className="inline-fields">
          <label>
            <span className="small muted">Fuel phase</span>
            <select value={phase} onChange={(e) => setPhase(e.target.value)}>
              <option value="">All</option>
              <option value="solid">Solid</option>
              <option value="liquid">Liquid</option>
              <option value="gas">Gas</option>
            </select>
          </label>
          <label>
            <span className="small muted">Outcome</span>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="">All</option>
              <option value="burn">Burned / sustained</option>
              <option value="noburn">Extinguished / no ignition</option>
              <option value="other">Other / unknown</option>
            </select>
          </label>
          <label>
            <span className="small muted">Gravity</span>
            <select value={gravity} onChange={(e) => setGravity(e.target.value)}>
              <option value="">All</option>
              <option value="micro">µg only</option>
              <option value="ground">1 g only</option>
            </select>
          </label>
          <label>
            <span className="small muted">O₂ min %</span>
            <input type="number" value={o2Min} onChange={(e) => setO2Min(e.target.value)} />
          </label>
          <label>
            <span className="small muted">O₂ max %</span>
            <input type="number" value={o2Max} onChange={(e) => setO2Max(e.target.value)} />
          </label>
          <label>
            <span className="small muted">kPa min</span>
            <input type="number" value={pMin} onChange={(e) => setPMin(e.target.value)} />
          </label>
          <label>
            <span className="small muted">kPa max</span>
            <input type="number" value={pMax} onChange={(e) => setPMax(e.target.value)} />
          </label>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <strong className="tabular">{rows.length}</strong> <span className="muted">of {tests.length} rows</span>
          <span className="spacer" />
          <button
            type="button"
            className="primary"
            disabled={!rows.length}
            onClick={() => downloadText(`ember_tests_${new Date().toISOString().slice(0, 10)}.csv`, testsToCsv(rows, investigations))}
          >
            Download CSV
          </button>
          <button type="button" disabled={!rows.length} onClick={() => downloadText('ember_tests.json', JSON.stringify(rows, null, 2), 'application/json')}>
            JSON
          </button>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Preview</h2>
        <div className="table-wrap" style={{ maxHeight: 460 }}>
          <table>
            <thead>
              <tr>
                <th>inv</th>
                <th>testId</th>
                <th>fuel</th>
                <th className="num">O₂ %</th>
                <th className="num">kPa</th>
                <th className="num">cm/s</th>
                <th>g</th>
                <th>outcome</th>
                <th>source file</th>
                <th className="num">row</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((t) => (
                <tr key={`${t.inv}::${t.testId}`}>
                  <td>{t.inv}</td>
                  <td className="mono">{t.testId}</td>
                  <td>{t.fuel ?? '—'}</td>
                  <td className="num">{fmtNum(t.o2Pct)}</td>
                  <td className="num">{fmtNum(t.pressureKpa)}</td>
                  <td className="num">{fmtNum(t.flowCmS)}</td>
                  <td>{fmtGravity(t.gravityG)}</td>
                  <td>{t.outcome}</td>
                  <td className="small">{t.source.file ?? '—'}</td>
                  <td className="num">{t.source.row ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 200 && <p className="small muted">Showing first 200 rows; the download contains all {rows.length}.</p>}
      </section>

      {manifest && manifest.files.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Raw source files</h2>
          <p className="small muted">Generated {manifest.generatedAt}. Checksums let you verify the download matches what EMBER parsed.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>inv</th><th>file</th><th className="num">rows</th><th>license</th><th>sha256</th></tr>
              </thead>
              <tbody>
                {manifest.files.map((f) => (
                  <tr key={f.file}>
                    <td>{f.inv}</td>
                    <td><a href={f.url} target="_blank" rel="noreferrer">{f.file.split('/').pop()}</a></td>
                    <td className="num">{f.rows}</td>
                    <td>{f.license}</td>
                    <td className="mono small">{f.sha256?.slice(0, 12)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
