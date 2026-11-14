import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BuoyancyChart } from '../components/Charts';
import FlameCanvas from '../components/FlameCanvas';
import { scenarioQuery, useData, useEmber } from '../data/context';
import { flowText } from '../components/ScenarioEditor';
import { gravityBracket, type Estimate } from '../lib/evidence';
import { AnswerBadge, findSource, fmtNum, fmtPct, PageHead, SourceLink, Term } from '../components/ui';

const W = 640;
const H = 300;
const M = { top: 24, right: 24, bottom: 46, left: 56 };
const sx = (g: number) => M.left + g * (W - M.left - M.right);
const sy = (p: number) => H - M.bottom - p * (H - M.top - M.bottom);

function EndPoint({ e, g, label }: { e: Estimate; g: number; label: string }) {
  if (e.pBurn === null) return null;
  const [lo, hi] = e.interval ?? [e.pBurn, e.pBurn];
  return (
    <g>
      <line x1={sx(g)} x2={sx(g)} y1={sy(lo)} y2={sy(hi)} stroke="var(--series-1)" strokeWidth={2} strokeLinecap="round" />
      <circle cx={sx(g)} cy={sy(e.pBurn)} r={6} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />
      <text x={sx(g) + (g < 0.5 ? 12 : -12)} y={sy(e.pBurn) + (g < 0.5 ? 22 : -10)} textAnchor={g < 0.5 ? 'start' : 'end'} fontSize="12" fill="var(--text)">
        {label}: {fmtPct(e.pBurn)} ({e.status})
      </text>
    </g>
  );
}

export default function Gravity() {
  const { scenario } = useEmber();
  const { tests, investigations, claims, missions } = useData();
  const [target, setTarget] = useState<'mission' | 'moon' | 'mars'>(scenario.gravityG > 0.3 ? 'mars' : 'moon');
  const q = useMemo(() => scenarioQuery(scenario), [scenario]);
  const b = useMemo(() => gravityBracket(q, tests), [q, tests]);
  const gTarget = target === 'moon' ? 0.166 : target === 'mars' ? 0.38 : scenario.gravityG;
  const mission = missions.find((m) => m.id === scenario.missionId);
  const efield = investigations.filter((i) => /e-?field/i.test(`${i.id} ${i.name}`));
  const efClaims = claims.filter((c) => efield.some((i) => i.id === c.inv));
  // Literature evidence on gravity effects, used when PSI has no 1 g test rows to bracket with.
  const gravityClaims = claims.filter(
    (c) =>
      c.topic.includes('partial-gravity') ||
      ((c.topic.includes('oxygen-limit') || c.topic.includes('material-test')) && /\b1-?g\b|normal.gravity|NASA-STD-6001/i.test(c.text)),
  );
  const simO2 = Math.max(18, Math.min(40, Math.round(scenario.o2Pct)));
  const marginO2 = 4; // c-0137: 1 g ULOI/MOC exceeded 0 g values by up to 4% O2

  return (
    <>
      <PageHead eyebrow="Module 4.6" title="Gravity bracket">
        <p>
          PSI has no combustion data at lunar or Martian gravity yet (expected from future experiments). Microgravity (µg) and Earth
          gravity (1 g) results can bound intermediate levels. This page shows that range for your conditions, explicitly as an{' '}
          <strong>estimate, not a measurement</strong>. The answer at partial <Term k="g">g</Term> could lie anywhere inside the band, and
          flame behaviour need not be monotonic in gravity.
        </p>
      </PageHead>

      <section className="card" style={{ marginBottom: 16 }} aria-labelledby="fl-h">
        <div className="panel-title">
          <h2 id="fl-h" style={{ margin: 0 }}>The same flame at four gravity levels</h2>
          <span className="status status-warning">Illustration</span>
        </div>
        <p className="small muted" style={{ maxWidth: '80ch' }}>
          One gas burner, {fmtNum(simO2)}% O₂, no ventilation. Only gravity changes. Without buoyancy the flame is a dim sphere fed by
          diffusion; any gravity makes hot gas rise and pull in fresh air. Computed live by the <Link to="/physics">flame lab</Link> model,
          which is not calibrated and not used for any estimate on this page.
        </p>
        <div className="flame-row">
          {([[0, 'Microgravity', 'µg · orbit'], [0.166, 'Moon', '0.17 g'], [0.38, 'Mars', '0.38 g'], [1, 'Earth', '1 g']] as const).map(([gv, name, sub]) => (
            <figure key={name}>
              <div className="flame-stage">
                <FlameCanvas o2={simO2} flow={0} g={gv} config="burner" nx={48} ny={64} scale={6} stepsPerFrame={2} label={`Illustrative burner flame at ${sub}`} />
              </div>
              <figcaption><b>{name}</b>{sub}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <div className="row" style={{ marginBottom: 16 }}>
        <div className="segmented" role="group" aria-label="Target gravity">
        {(
          [
            ['moon', 'Moon 0.17 g'],
            ['mars', 'Mars 0.38 g'],
            ['mission', `Mission (${mission?.label ?? 'custom'}) ${fmtNum(scenario.gravityG, 2)} g`],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={target === k} onClick={() => setTarget(k)}>
            {l}
          </button>
        ))}
        </div>
        <span className="small muted">
          Conditions from the <Link to="/">mission lens</Link>: {fmtNum(scenario.o2Pct)}% O₂, {fmtNum(scenario.pressureKpa)} kPa, flow {flowText(scenario)},{' '}
          {scenario.fuelPhase} fuel.
        </span>
      </div>

      <div className="grid grid-2">
        <section className="card">
          <h2>Flame sustained: µg vs 1 g</h2>
          {b.micro && b.ground && b.pRange ? (
            <figure className="chart" style={{ margin: 0 }}>
              <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Bracket between microgravity estimate ${fmtPct(b.micro.pBurn)} and 1 g estimate ${fmtPct(b.ground.pBurn)}; partial gravity at ${gTarget} g lies somewhere in between (estimate).`}>
                {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                  <g key={t}>
                    <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" />
                    <text x={M.left - 8} y={sy(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--muted)">{t * 100}%</text>
                  </g>
                ))}
                {[0, 0.166, 0.38, 1].map((g) => (
                  <text key={g} x={sx(g)} y={H - M.bottom + 16} textAnchor="middle" fontSize="11" fill="var(--muted)">
                    {g === 0 ? 'µg' : g === 1 ? '1 g' : g === 0.166 ? 'Moon' : 'Mars'}
                  </text>
                ))}
                <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke="var(--axis)" />
                <text x={(M.left + W - M.right) / 2} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--text-2)">Gravity level (g)</text>
                <text transform={`translate(14 ${(M.top + H - M.bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fill="var(--text-2)">P(flame sustained)</text>
                {/* bracket band */}
                <rect
                  x={sx(0)}
                  width={sx(1) - sx(0)}
                  y={sy(b.pRange[1])}
                  height={Math.max(2, sy(b.pRange[0]) - sy(b.pRange[1]))}
                  fill="var(--series-1)"
                  opacity={0.14}
                />
                <line x1={sx(gTarget)} x2={sx(gTarget)} y1={M.top} y2={H - M.bottom} stroke="var(--text-2)" strokeWidth={1} />
                <rect x={sx(gTarget) - 7} y={sy(b.pRange[1])} width={14} height={Math.max(4, sy(b.pRange[0]) - sy(b.pRange[1]))} rx={4} fill="var(--series-1)" opacity={0.55} />
                <text x={sx(gTarget) + 8} y={H - M.bottom - 10} fontSize="12" fill="var(--text)">
                  {fmtNum(gTarget, 2)} g: {fmtPct(b.pRange[0])}–{fmtPct(b.pRange[1])} (estimate)
                </text>
                <EndPoint e={b.micro} g={0} label="µg" />
                <EndPoint e={b.ground} g={1} label="1 g" />
              </svg>
              <figcaption className="small muted">
                Dots: nearest-test vote at each gravity level, bars: 95% interval (full height when extrapolated). Shaded band: the
                bracket. Not an interpolation curve.
              </figcaption>
            </figure>
          ) : (
            <div className="callout">
              The bracket needs tests with outcomes at both µg and 1 g. Current data: {b.nMicro} µg rows, {b.nGround} 1 g rows.
            </div>
          )}
        </section>

        <section className="card">
          <h2>Bracket details</h2>
          <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <th scope="row">Microgravity evidence</th>
                <td>{b.micro ? <><AnswerBadge status={b.micro.status} /> {fmtPct(b.micro.pBurn)} · {b.nMicro} rows</> : 'none'}</td>
              </tr>
              <tr>
                <th scope="row">1 g evidence</th>
                <td>{b.ground ? <><AnswerBadge status={b.ground.status} /> {fmtPct(b.ground.pBurn)} · {b.nGround} rows</> : 'none'}</td>
              </tr>
              <tr>
                <th scope="row">Spread rate (neighbour avg.)</th>
                <td>
                  µg {b.spreadMicro !== null ? `${fmtNum(b.spreadMicro, 2)} mm/s` : 'n/a'} · 1 g {b.spreadGround !== null ? `${fmtNum(b.spreadGround, 2)} mm/s` : 'n/a'}
                </td>
              </tr>
              <tr>
                <th scope="row">At {fmtNum(gTarget, 2)} g</th>
                <td>
                  <span className="status status-warning">Estimate</span>{' '}
                  {b.pRange ? `${fmtPct(b.pRange[0])} – ${fmtPct(b.pRange[1])}` : 'no bracket — needs both µg and 1 g tests'}
                </td>
              </tr>
            </tbody>
          </table>
          </div>
          <div className="callout small" style={{ marginTop: 12 }}>
            Why a bracket: at 1 g buoyancy supplies fresh oxygen; in µg only ventilation does. Partial gravity gives weak buoyant flow,
            which in some regimes makes flames <em>more</em> flammable than either extreme. Treat the band as a starting point, not a
            bound you can design to.
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Why partial gravity is not “almost microgravity”</h2>
        <p className="small muted" style={{ maxWidth: '80ch' }}>
          The draught a flame makes for itself grows with the cube root of gravity, so it rises steeply at low g. Compare it with cabin
          ventilation of {flowText(scenario)}: on the Moon, buoyancy rather than the fans may set the oxygen supply.
        </p>
        <BuoyancyChart g={gTarget} />
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Literature bracket: oxygen margin between 1 g and µg</h2>
        <p>
          PSI holds flight data only, so 1 g reference rows are absent from the test table. NASA flow-tunnel work found that the 1 g upward
          limiting oxygen index exceeded the microgravity limit by <strong>up to {marginO2}% O₂</strong>: with ventilation, materials burned in
          µg at lower oxygen than NASA-STD-6001 Test 1 suggests. For your scenario at {fmtNum(scenario.o2Pct)}% O₂ that means:
        </p>
        <div className="callout">
          <span className="status status-warning">Estimate</span> Treat any material whose 1 g limiting O₂ is below{' '}
          <strong>{fmtNum(scenario.o2Pct + marginO2)}% O₂</strong> as potentially flammable here in microgravity. At {fmtNum(gTarget, 2)} g
          NASA hypothesizes some materials may be <em>more</em> flammable than at either extreme, so this margin is not a bound. Lunar-gravity
          data are expected from LUCI and FM2.
        </div>
        <ul className="small" style={{ paddingLeft: 18, marginTop: 12 }}>
          {gravityClaims.map((c) => (
            <li key={c.id}>
              {c.text}{' '}
              {c.sourceUrl && (
                <a className="cite" href={c.sourceUrl} target="_blank" rel="noreferrer">
                  {c.id}
                </a>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>E-FIELD Flames: simulated partial gravity</h2>
        {efield.length === 0 ? (
          <p className="muted">No E-FIELD Flames investigation in the current dataset.</p>
        ) : (
          efield.map((inv) => (
            <div key={inv.id}>
              <p>
                <Link to={`/investigations/${encodeURIComponent(inv.id)}`}>{inv.name}</Link> ({inv.psi ?? inv.id}) used an electric field to
                drive ionic wind around the flame, an analogue for buoyant convection. It is the closest PSI dataset to partial gravity, but it
                is gaseous-fuel, not a solid material, and the field-induced flow is not identical to buoyancy.
              </p>
              {inv.resultSummary && <p className="small">{inv.resultSummary}</p>}
              <ul className="small" style={{ paddingLeft: 18 }}>
                {inv.keyFindings.map((k, i) => (
                  <li key={i}>
                    {k.text} <SourceLink source={findSource(k.sourceId, investigations, inv)} />
                  </li>
                ))}
                {efClaims.filter((c) => c.inv === inv.id).map((c) => (
                  <li key={c.id}>
                    {c.text} {c.sourceUrl && <a className="cite" href={c.sourceUrl} target="_blank" rel="noreferrer">{c.id}</a>}
                  </li>
                ))}
              </ul>
              <p className="small muted">{tests.filter((t) => t.inv === inv.id).length} test rows in EMBER.</p>
            </div>
          ))
        )}
      </section>
    </>
  );
}
