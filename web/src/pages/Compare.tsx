import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useData } from '../data/context';
import { conditionBox, groupTests } from '../lib/evidence';
import { DirectionTags, fmtRange, PageHead } from '../components/ui';
import type { Investigation, Range } from '../lib/types';

type Verdict = 'same' | 'diff' | 'differs' | 'disjoint' | 'na';

function setVerdict(values: (string | null | undefined)[]): Verdict {
  const v = values.map((x) => (x ?? '').toString().trim().toLowerCase());
  if (v.some((x) => !x)) return 'na';
  return new Set(v).size === 1 ? 'same' : 'differs';
}
function listVerdict(lists: string[][]): Verdict {
  if (lists.some((l) => !l.length)) return 'na';
  const norm = lists.map((l) => new Set(l.map((x) => x.toLowerCase())));
  const inter = [...norm[0]].filter((x) => norm.every((s) => s.has(x)));
  if (norm.every((s) => s.size === norm[0].size) && inter.length === norm[0].size) return 'same';
  return inter.length ? 'diff' : 'disjoint';
}
function rangeVerdict(ranges: Range[]): Verdict {
  if (ranges.some((r) => !r)) return 'na';
  const rs = ranges as [number, number][];
  const lo = Math.max(...rs.map((r) => r[0]));
  const hi = Math.min(...rs.map((r) => r[1]));
  if (rs.every((r) => r[0] === rs[0][0] && r[1] === rs[0][1])) return 'same';
  return lo <= hi ? 'diff' : 'disjoint';
}

const VERDICT_TEXT: Record<Verdict, string> = {
  same: 'match',
  diff: 'overlap / partly differs',
  differs: 'differs',
  disjoint: 'no overlap',
  na: 'not documented for all',
};

export default function Compare() {
  const { investigations, tests } = useData();
  const [params, setParams] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean).slice(0, 3);
  const byInv = useMemo(() => groupTests(tests), [tests]);
  const sel = ids.map((id) => investigations.find((i) => i.id === id)).filter((x): x is Investigation => !!x);
  const setIds = (next: string[]) => setParams(next.length ? { ids: next.join(',') } : {});

  const pick = (slot: number, id: string) => {
    const next = [...ids];
    if (id) next[slot] = id;
    else next.splice(slot, 1);
    setIds([...new Set(next.filter(Boolean))]);
  };

  const boxes = sel.map((i) => conditionBox(i, byInv.get(i.id) ?? []));
  const warnings: string[] = [];
  if (sel.length >= 2) {
    if (new Set(sel.map((i) => i.family)).size > 1)
      warnings.push(`Different hardware families (${[...new Set(sel.map((i) => i.family))].join(' vs ')}): compare with caution — apparatus, sample size and diagnostics differ.`);
    if (new Set(sel.map((i) => i.fuelPhase ?? '?')).size > 1)
      warnings.push(`Different fuel phases (${sel.map((i) => i.fuelPhase ?? '?').join(' vs ')}): results transfer only qualitatively.`);
    if (new Set(sel.map((i) => String(i.flight))).size > 1) warnings.push('Mix of flight and ground data.');
    if (rangeVerdict(boxes.map((b) => b.o2Pct ?? null)) === 'disjoint') warnings.push('Tested O₂ ranges do not overlap.');
    if (rangeVerdict(boxes.map((b) => b.pressureKpa ?? null)) === 'disjoint') warnings.push('Tested pressure ranges do not overlap.');
  }

  const rows: { label: string; verdict: Verdict; cells: ReactNode[] }[] = sel.length
    ? [
        { label: 'Hardware family', verdict: setVerdict(sel.map((i) => i.family)), cells: sel.map((i) => i.family) },
        { label: 'Hardware', verdict: setVerdict(sel.map((i) => i.hardware)), cells: sel.map((i) => i.hardware ?? '—') },
        { label: 'Platform', verdict: setVerdict(sel.map((i) => i.platform)), cells: sel.map((i) => i.platform ?? '—') },
        { label: 'Fuel phase', verdict: setVerdict(sel.map((i) => i.fuelPhase)), cells: sel.map((i) => i.fuelPhase ?? '—') },
        { label: 'Fuels', verdict: listVerdict(sel.map((i) => i.fuel?.types ?? [])), cells: sel.map((i) => i.fuel?.types.join(', ') || '—') },
        { label: 'Geometry', verdict: setVerdict(sel.map((i) => i.fuel?.geometry)), cells: sel.map((i) => i.fuel?.geometry ?? '—') },
        { label: 'O₂ range', verdict: rangeVerdict(boxes.map((b) => b.o2Pct ?? null)), cells: boxes.map((b) => fmtRange(b.o2Pct, '%')) },
        { label: 'Pressure range', verdict: rangeVerdict(boxes.map((b) => b.pressureKpa ?? null)), cells: boxes.map((b) => fmtRange(b.pressureKpa, 'kPa')) },
        { label: 'Flow range', verdict: rangeVerdict(boxes.map((b) => b.flowCmS ?? null)), cells: boxes.map((b) => fmtRange(b.flowCmS, 'cm/s')) },
        { label: 'Gravity', verdict: rangeVerdict(sel.map((i) => i.conditions?.gravityG ?? null)), cells: sel.map((i) => fmtRange(i.conditions?.gravityG ?? null, 'g')) },
        { label: 'Diluents', verdict: listVerdict(sel.map((i) => i.conditions?.diluents ?? [])), cells: sel.map((i) => i.conditions?.diluents?.join(', ') ?? '—') },
        { label: 'Varied', verdict: listVerdict(sel.map((i) => i.varied)), cells: sel.map((i) => i.varied.join('; ') || '—') },
        { label: 'Held constant', verdict: listVerdict(sel.map((i) => i.constant)), cells: sel.map((i) => i.constant.join('; ') || '—') },
        { label: 'Diagnostics', verdict: listVerdict(sel.map((i) => i.diagnostics)), cells: sel.map((i) => i.diagnostics.join(', ') || '—') },
        { label: 'Direction', verdict: listVerdict(sel.map((i) => i.direction)), cells: sel.map((i) => <DirectionTags dirs={i.direction} />) },
        { label: 'Tests', verdict: 'na', cells: sel.map((i) => `${i.nTests ?? '?'} (${i.flight ? 'flight' : 'ground'})`) },
        { label: 'Result summary', verdict: 'na', cells: sel.map((i) => <span className="small">{i.resultSummary ?? '—'}</span>) },
      ]
    : [];

  return (
    <>
      <PageHead eyebrow="Module 4.2" title="Compare investigations">
        <p>
          Two or three investigations side by side. A green edge marks a match, amber a partial overlap, red no overlap. Investigations
          in the same <Link to="/families">hardware family</Link> are directly comparable; across families, only with caution.
        </p>
      </PageHead>
      <div className="row" style={{ marginBottom: 16 }}>
        {[0, 1, 2].map((slot) => (
          <select key={slot} value={ids[slot] ?? ''} onChange={(e) => pick(slot, e.target.value)} aria-label={`Investigation ${slot + 1}`} disabled={slot > ids.length}>
            <option value="">{slot < 2 ? `Select investigation ${slot + 1}` : '(optional third)'}</option>
            {investigations.map((i) => (
              <option key={i.id} value={i.id} disabled={ids.includes(i.id) && ids[slot] !== i.id}>
                {i.id} — {i.name}
              </option>
            ))}
          </select>
        ))}
      </div>

      {warnings.length > 0 && (
        <div className="callout danger" role="note" style={{ marginBottom: 16 }}>
          <strong>Compare with caution.</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {sel.length >= 2 && warnings.length === 0 && (
        <div className="callout info" style={{ marginBottom: 16 }}>
          Same hardware family and fuel phase — results are directly comparable.
        </div>
      )}
      {sel.length < 2 && <p className="muted">Select at least two investigations.</p>}

      {sel.length > 0 && (
        <div className="table-wrap">
          <table className="cmp">
            <thead>
              <tr>
                <th>Attribute</th>
                {sel.map((i) => (
                  <th key={i.id}>
                    <Link to={`/investigations/${encodeURIComponent(i.id)}`}>{i.id}</Link>
                  </th>
                ))}
                {sel.length >= 2 && <th>Verdict</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row" className="rowhead">{r.label}</th>
                  {r.cells.map((c, j) => (
                    <td key={j} className={sel.length >= 2 && r.verdict !== 'na' ? (r.verdict === 'differs' ? 'diff' : r.verdict) : undefined}>
                      {c}
                    </td>
                  ))}
                  {sel.length >= 2 && <td className="small muted">{r.verdict === 'na' ? '' : VERDICT_TEXT[r.verdict]}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
