import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../data/context';
import { conditionBox, groupTests } from '../lib/evidence';
import { DirectionTags, fmtRange, PageHead, Term } from '../components/ui';
import type { Investigation, TestRow } from '../lib/types';

export function ConditionsLine({ inv, tests }: { inv: Investigation; tests: TestRow[] }) {
  const box = conditionBox(inv, tests);
  return (
    <dl className="small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', margin: 0 }}>
      <dt className="muted"><Term k="o2">O₂</Term></dt>
      <dd style={{ margin: 0 }}>{fmtRange(box.o2Pct, '%')}</dd>
      <dt className="muted">Pressure</dt>
      <dd style={{ margin: 0 }}>{fmtRange(box.pressureKpa, 'kPa')}</dd>
      <dt className="muted"><Term k="flow">Flow</Term></dt>
      <dd style={{ margin: 0 }}>{fmtRange(box.flowCmS, 'cm/s')}</dd>
      <dt className="muted">Gravity</dt>
      <dd style={{ margin: 0 }}>{fmtRange(inv.conditions?.gravityG ?? null, 'g')}</dd>
    </dl>
  );
}

export default function Investigations() {
  const { investigations, tests } = useData();
  const byInv = useMemo(() => groupTests(tests), [tests]);
  const [dir, setDir] = useState('');
  const [fam, setFam] = useState('');
  const [phase, setPhase] = useState('');
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const nav = useNavigate();
  const families = [...new Set(investigations.map((i) => i.family))].sort();
  const list = investigations.filter(
    (i) =>
      (!dir || i.direction.includes(dir as never)) &&
      (!fam || i.family === fam) &&
      (!phase || i.fuelPhase === phase) &&
      (!text || `${i.id} ${i.name} ${i.objective ?? ''} ${(i.fuel?.types ?? []).join(' ')}`.toLowerCase().includes(text.toLowerCase())),
  );
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 3 ? p : [...p, id]));

  return (
    <>
      <PageHead eyebrow="Module 4.1" title="Investigation cards">
        <p>
          Every PSI combustion investigation in one uniform format: objective, fuel, conditions, what varied, diagnostics, hardware,
          fire-safety direction and sourced findings. Select up to three to compare.
        </p>
      </PageHead>
      <div className="row" style={{ marginBottom: 16 }} role="search">
        <input type="search" placeholder="Search name, fuel, objective" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search investigations" />
        <select value={dir} onChange={(e) => setDir(e.target.value)} aria-label="Direction">
          <option value="">All directions</option>
          <option value="prevention">Prevention</option>
          <option value="detection">Detection</option>
          <option value="suppression">Suppression</option>
          <option value="fundamental">Fundamental</option>
        </select>
        <select value={fam} onChange={(e) => setFam(e.target.value)} aria-label="Hardware family">
          <option value="">All hardware families</option>
          {families.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <select value={phase} onChange={(e) => setPhase(e.target.value)} aria-label="Fuel phase">
          <option value="">All fuel phases</option>
          <option value="solid">Solid</option>
          <option value="liquid">Liquid</option>
          <option value="gas">Gas</option>
        </select>
        <span className="spacer" />
        <button type="button" className="primary" disabled={picked.length < 2} onClick={() => nav(`/compare?ids=${picked.map(encodeURIComponent).join(',')}`)}>
          Compare {picked.length ? `(${picked.length})` : ''}
        </button>
      </div>
      <p className="small muted">{list.length} of {investigations.length} investigations</p>
      <div className="grid grid-3">
        {list.map((inv) => (
          <article key={inv.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <h3 style={{ marginBottom: 2 }}>
                <Link to={`/investigations/${encodeURIComponent(inv.id)}`}>{inv.name}</Link>
              </h3>
              <div className="row small muted">
                <span>{inv.id}</span>
                {inv.psi && <span>· {inv.psi}</span>}
                {inv.years && <span>· {inv.years}</span>}
              </div>
            </div>
            <div className="row">
              <DirectionTags dirs={inv.direction} />
              <span className="tag">{inv.fuelPhase ?? 'phase n/a'}</span>
              <span className="tag">{inv.family}</span>
              <span className="tag">{inv.flight ? 'flight' : inv.flight === false ? 'ground' : 'flight ?'}</span>
            </div>
            {inv.objective && <p className="small" style={{ margin: 0 }}>{inv.objective}</p>}
            <ConditionsLine inv={inv} tests={byInv.get(inv.id) ?? []} />
            <div className="row small" style={{ marginTop: 'auto' }}>
              <span className="muted">
                {inv.nTests ?? '?'} tests · {(byInv.get(inv.id) ?? []).length} rows in EMBER
              </span>
              <span className="spacer" />
              <label className="row" style={{ gap: 4 }}>
                <input type="checkbox" checked={picked.includes(inv.id)} onChange={() => toggle(inv.id)} disabled={!picked.includes(inv.id) && picked.length >= 3} />
                compare
              </label>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
