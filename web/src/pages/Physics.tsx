import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createSim, stats, step, type Sim } from '../lib/flameSim';
import { PageHead, Term } from '../components/ui';

const NX = 160;
const NY = 80;
const SCALE = 5;

// heat ramp for the illustration (dark -> ember -> yellow -> white)
function heat(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, (t - 1) / 7));
  if (x < 0.33) {
    const k = x / 0.33;
    return [5 + 150 * k, 7 + 30 * k, 10];
  }
  if (x < 0.66) {
    const k = (x - 0.33) / 0.33;
    return [155 + 100 * k, 37 + 120 * k, 10 + 10 * k];
  }
  const k = (x - 0.66) / 0.34;
  return [255, 157 + 98 * k, 20 + 200 * k];
}

function draw(ctx: CanvasRenderingContext2D, sim: Sim, img: ImageData) {
  const { nx, ny, T, F, Y } = sim;
  const d = img.data;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      let [r, g, b] = heat(T[k]);
      if (F[k] > 0.02) {
        // fuel strip: grey, darker as it chars
        const f = F[k];
        r = Math.max(r, 70 + 90 * f);
        g = Math.max(g, 70 + 90 * f);
        b = Math.max(b, 80 + 90 * f);
      } else if (T[k] < 1.3) {
        // faint oxygen depletion tint (blue = depleted)
        const dep = Math.max(0, 1 - Y[k] / (sim.params.o2Pct / 21));
        b = Math.max(b, 10 + 120 * dep);
      }
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const p = ((j * SCALE + dy) * nx * SCALE + i * SCALE + dx) * 4;
          d[p] = r;
          d[p + 1] = g;
          d[p + 2] = b;
          d[p + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

export default function Physics() {
  const [o2, setO2] = useState(21);
  const [flow, setFlow] = useState(10);
  const [g, setG] = useState(0);
  const [running, setRunning] = useState(true);
  const [status, setStatus] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Sim | null>(null);

  const reset = () => {
    simRef.current = createSim({ o2Pct: o2, flowCmS: flow, gravityG: g }, NX, NY);
  };
  // restart on parameter change
  useEffect(() => {
    reset();
    setRunning(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o2, flow, g]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const img = ctx.createImageData(NX * SCALE, NY * SCALE);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let frame = 0;
    const tick = () => {
      const sim = simRef.current;
      if (sim) {
        if (running) step(sim, reduced ? 12 : 4);
        draw(ctx, sim, img);
        if (frame++ % 15 === 0) {
          const s = stats(sim);
          setStatus(`${Math.round(s.burnedFrac * 100)}% of strip burned · ${s.burning ? 'flame active' : 'no active flame'}`);
          if (!s.burning && sim.t > 60) setRunning(false);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  return (
    <>
      <PageHead eyebrow="Module 4.7 · stretch" title="Flame-spread illustration">
        <div className="callout danger" role="note">
          <strong>Illustration, not a calculation.</strong> This toy 2D model (diffusion, forced flow, buoyant updraft ∝ gravity, one-step
          reaction, heat loss) is <em>not calibrated</em> against BASS or any PSI data and is not used for any answer in EMBER. For
          evidence, use <Link to="/what-if">What-if</Link>.
        </div>
      </PageHead>
      <div className="split">
        <section className="card">
          <div className="field">
            <div className="label-row">
              <label htmlFor="p-o2"><Term k="o2">O₂</Term></label>
              <output htmlFor="p-o2">{o2}%</output>
            </div>
            <input id="p-o2" type="range" min={12} max={40} step={1} value={o2} onChange={(e) => setO2(Number(e.target.value))} />
          </div>
          <div className="field">
            <div className="label-row">
              <label htmlFor="p-flow">Forced <Term k="flow">flow</Term> (left → right)</label>
              <output htmlFor="p-flow">{flow} cm/s</output>
            </div>
            <input id="p-flow" type="range" min={0} max={40} step={1} value={flow} onChange={(e) => setFlow(Number(e.target.value))} />
          </div>
          <div className="field">
            <div className="label-row">
              <label htmlFor="p-g">Gravity</label>
              <output htmlFor="p-g">{g.toFixed(2)} g</output>
            </div>
            <input id="p-g" type="range" min={0} max={1} step={0.01} value={g} onChange={(e) => setG(Number(e.target.value))} />
          </div>
          <div className="row">
            <button type="button" onClick={() => setRunning((r) => !r)}>{running ? 'Pause' : 'Resume'}</button>
            <button type="button" onClick={() => { reset(); setRunning(true); }}>Re-ignite</button>
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>
            The grey strip is a thin fuel sheet, ignited at its downstream end; the flame spreads against the flow. Colour shows
            temperature; blue tint shows oxygen depletion. Try 21% O₂ vs 15%, or raise gravity to add a buoyant plume.
          </p>
        </section>
        <section className="card">
          <canvas
            ref={canvasRef}
            className="physics"
            width={NX * SCALE}
            height={NY * SCALE}
            role="img"
            aria-label={`Illustrative flame spread at ${o2}% oxygen, ${flow} cm/s flow, ${g} g. ${status}`}
          />
          <p className="small muted" style={{ marginTop: 8 }} aria-live="polite">{status}</p>
        </section>
      </div>
    </>
  );
}
