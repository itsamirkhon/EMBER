import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import FlameCanvas from '../components/FlameCanvas';
import type { Sim, SimConfig, SimStats } from '../lib/flameSim';
import { PageHead, Term } from '../components/ui';

const PRESETS: { label: string; o2: number; flow: number; g: number }[] = [
  { label: 'ISS cabin', o2: 21, flow: 10, g: 0 },
  { label: 'Lunar habitat', o2: 34, flow: 10, g: 0.17 },
  { label: 'Mars habitat', o2: 34, flow: 10, g: 0.38 },
  { label: 'Earth lab', o2: 21, flow: 0, g: 1 },
  { label: 'Low oxygen', o2: 15, flow: 25, g: 0 },
];

function Slider({ id, label, value, min, max, step, unit, digits = 0, onChange }: {
  id: string; label: React.ReactNode; value: number; min: number; max: number; step: number; unit: string; digits?: number; onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <div className="label-row">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{value.toFixed(digits)} {unit}</output>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export default function Physics() {
  const [o2, setO2] = useState(21);
  const [flow, setFlow] = useState(10);
  const [g, setG] = useState(0);
  const [config, setConfig] = useState<SimConfig>('strip');
  const [running, setRunning] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [st, setSt] = useState<{ s: SimStats; t: number } | null>(null);
  const onStats = useCallback((s: SimStats, sim: Sim) => setSt({ s, t: sim.t }), []);
  const set = (fn: () => void) => { fn(); setRunning(true); };

  const state = !st ? '' : st.s.igniterOn ? 'Igniter on' : st.s.burning ? 'Flame sustained' : config === 'strip' && st.s.burnedFrac > 0.9 ? 'Burned out' : 'Extinguished';
  const stateColor = state === 'Flame sustained' ? 'var(--series-burn)' : state === 'Extinguished' ? 'var(--series-noburn)' : 'var(--text-2)';

  return (
    <>
      <PageHead eyebrow="Flame lab" title="See why gravity changes a flame.">
        <p>
          A small flame model you can steer: oxygen, ventilation and gravity. It solves real mechanisms, but it is{' '}
          <strong>an illustration, not a calculation</strong>.
        </p>
      </PageHead>

      <div className="split">
        <section className="card" aria-label="Controls">
          <div className="segmented" role="group" aria-label="Fuel" style={{ marginBottom: 18 }}>
            <button type="button" aria-pressed={config === 'strip'} onClick={() => set(() => setConfig('strip'))}>Thin solid sheet</button>
            <button type="button" aria-pressed={config === 'burner'} onClick={() => set(() => setConfig('burner'))}>Gas burner</button>
          </div>
          <Slider id="p-o2" label={<Term k="o2">O₂</Term>} value={o2} min={12} max={40} step={1} unit="%" onChange={(v) => set(() => setO2(v))} />
          <Slider id="p-flow" label={<>Forced <Term k="flow">flow</Term> (left → right)</>} value={flow} min={0} max={40} step={1} unit="cm/s" onChange={(v) => set(() => setFlow(v))} />
          <Slider id="p-g" label="Gravity (pointing down)" value={g} min={0} max={1} step={0.01} unit="g" digits={2} onChange={(v) => set(() => setG(v))} />
          <h4 style={{ marginTop: 4 }}>Presets</h4>
          <div className="row">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className="chip-btn" aria-pressed={o2 === p.o2 && flow === p.flow && g === p.g}
                onClick={() => set(() => { setO2(p.o2); setFlow(p.flow); setG(p.g); })}>
                {p.label}
              </button>
            ))}
          </div>
          <hr className="sep" />
          <div className="row">
            <button type="button" onClick={() => setRunning((r) => !r)}>{running ? 'Pause' : 'Resume'}</button>
            <button type="button" className="primary" onClick={() => { setResetKey((k) => k + 1); setRunning(true); }}>Re-ignite</button>
          </div>
        </section>

        <div className="stack">
          <section className="card" style={{ padding: 12 }}>
            <div className="flame-stage">
              <FlameCanvas
                o2={o2} flow={flow} g={g} config={config} nx={config === 'strip' ? 120 : 96} ny={config === 'strip' ? 60 : 64} scale={config === 'strip' ? 8 : 10}
                running={running} stepsPerFrame={3} resetKey={resetKey} onStats={onStats}
                label={`Illustrative ${config === 'strip' ? 'flame spreading over a thin fuel sheet' : 'gas burner flame'} at ${o2}% oxygen, ${flow} cm/s flow, ${g.toFixed(2)} g. ${state}.`}
              />
              <div className="hud">
                <span><b style={{ color: stateColor }}>{state}</b></span>
                <span>
                  {st && <>peak gas temperature ≈ <b>{Math.round(st.s.peakT * 300 / 10) * 10} K</b>{config === 'strip' && <> · <b>{Math.round(st.s.burnedFrac * 100)}%</b> of sheet consumed</>}</>}
                </span>
              </div>
              <div className="foot">
                <span>{flow > 0 ? `flow ${flow} cm/s →` : 'no forced flow'}</span>
                <span>{g > 0.005 ? `↓ ${g.toFixed(2)} g` : 'microgravity'}</span>
              </div>
            </div>
            <p className="small muted" style={{ margin: '12px 8px 4px' }} aria-live="polite">
              Blue: the reaction zone. Yellow-orange: glowing soot, brighter the hotter it is. Faint streaks follow the computed gas flow.
              {config === 'strip' ? ' The sheet is lit at its downstream end, so the flame spreads against the flow.' : ' Fuel gas leaves the tube at a fixed rate.'}
            </p>
          </section>

          <div className="grid grid-2">
            <section className="card">
              <h3>What to try</h3>
              <ul className="small" style={{ margin: 0, color: 'var(--text-2)' }}>
                <li><strong>Gas burner, 0 g → 1 g.</strong> Without buoyancy the flame is a dim blue-ish sphere fed only by diffusion. Add gravity and hot gas rises, drawing in fresh air: a bright, sooty teardrop.</li>
                <li><strong>Thin sheet, 21 % → 15 % O₂ at 25 cm/s.</strong> The flame cools until chemistry cannot keep up with the flow and it blows off.</li>
                <li><strong>Moon vs Mars vs Earth.</strong> Even 0.17 g makes a clear plume. Partial gravity is not “almost microgravity”.</li>
              </ul>
            </section>
            <section className="card">
              <h3>What is in the model, and what is not</h3>
              <ul className="small" style={{ margin: 0, color: 'var(--text-2)' }}>
                <li>In: incompressible flow with buoyancy ∝ g·(T − T<sub>∞</sub>), heat and species diffusion, finite-rate one-step chemistry, pyrolysis of the solid driven by its surface temperature, radiative loss ∝ T⁴ from gas and surface.</li>
                <li>Not in: thermal expansion, real kinetics, soot chemistry, 3D effects. Units are non-dimensional; constants are hand-set, not fitted.</li>
                <li>Known miss: real thin fuels in microgravity <em>quench</em> when the flow is very slow. This model keeps burning there.</li>
              </ul>
            </section>
          </div>
          <div className="callout danger small" role="note">
            <strong>Illustration, not a calculation.</strong> Nothing here is calibrated against BASS or any PSI data, and no EMBER answer uses it.
            For evidence, use <Link to="/what-if">What-if</Link>.
          </div>
        </div>
      </div>
    </>
  );
}
