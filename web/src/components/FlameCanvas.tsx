import { useEffect, useRef } from 'react';
import { createSim, renderFlame, stats, step, type Sim, type SimConfig, type SimStats } from '../lib/flameSim';

export interface FlameCanvasProps {
  o2: number;
  flow: number;
  g: number;
  config?: SimConfig;
  nx?: number;
  ny?: number;
  /** canvas pixels per grid cell */
  scale?: number;
  running?: boolean;
  stepsPerFrame?: number;
  /** change to re-ignite with the same parameters */
  resetKey?: number;
  /** draw flow tracers that follow the computed velocity field */
  tracers?: boolean;
  onStats?: (s: SimStats, sim: Sim) => void;
  label: string;
}

interface Tracer { x: number; y: number; px: number; py: number; age: number }

/** Runs the illustrative flame model and paints it: soft-upscaled emission, glow pass, fuel sheet, flow tracers. */
export default function FlameCanvas({
  o2, flow, g, config = 'strip', nx = 160, ny = 80, scale = 5, running = true, stepsPerFrame = 4, resetKey = 0, tracers = true, onStats, label,
}: FlameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Sim | null>(null);
  const live = useRef({ running, stepsPerFrame, onStats });
  live.current = { running, stepsPerFrame, onStats };

  useEffect(() => {
    simRef.current = createSim({ o2Pct: o2, flowCmS: flow, gravityG: g, config }, nx, ny);
  }, [o2, flow, g, config, nx, ny, resetKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const low = document.createElement('canvas');
    low.width = nx;
    low.height = ny;
    const lctx = low.getContext('2d');
    if (!lctx) return;
    const img = lctx.createImageData(nx, ny);
    const W = nx * scale;
    const H = ny * scale;
    const parts: Tracer[] = [];
    const spawn = (p: Tracer, anywhere: boolean) => {
      p.x = anywhere ? Math.random() * (nx - 2) + 1 : 1;
      p.y = Math.random() * (ny - 2) + 1;
      p.px = p.x;
      p.py = p.y;
      p.age = Math.random() * 200;
    };
    if (tracers) for (let i = 0; i < Math.round((nx * ny) / 110); i++) { const p = { x: 0, y: 0, px: 0, py: 0, age: 0 }; spawn(p, true); parts.push(p); }

    let visible = true;
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((es) => { visible = es[0]?.isIntersecting ?? true; }) : null;
    io?.observe(canvas);

    let raf = 0;
    let frame = 0;
    let idle = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const sim = simRef.current;
      if (!sim || !visible) return;
      const { running: run, stepsPerFrame: spf, onStats: cb } = live.current;
      // stop integrating once the flame is out and the gas has cooled; keep painting the last state
      const active = run && idle < 240;
      if (active) step(sim, spf);
      if (frame++ % 12 === 0) {
        const s = stats(sim);
        idle = s.burning || s.igniterOn || sim.t < 1 ? 0 : idle + 12;
        cb?.(s, sim);
      }
      if (sim.t < 1) idle = 0;

      renderFlame(sim, img.data);
      lctx.putImageData(img, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(low, 0, 0, W, H);
      // glow: the same emission, blurred and added
      ctx.globalCompositeOperation = 'lighter';
      ctx.filter = `blur(${scale * 2.4}px)`;
      ctx.globalAlpha = 0.55;
      ctx.drawImage(low, 0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.filter = 'none';

      // flow tracers: massless particles advected by the computed velocity field
      if (parts.length) {
        ctx.lineWidth = 1;
        ctx.lineCap = 'round';
        for (const p of parts) {
          const k = (p.y | 0) * nx + (p.x | 0);
          const u = sim.u[k];
          const v = sim.v[k];
          p.px = p.x;
          p.py = p.y;
          if (active) { p.x += u * 2.5; p.y += v * 2.5; p.age += 1; }
          const sp = Math.hypot(u, v);
          if (p.x < 1 || p.x > nx - 2 || p.y < 1 || p.y > ny - 2 || p.age > 520) { spawn(p, sp < 0.01 || p.age > 520); continue; }
          if (sp < 0.004) continue;
          ctx.strokeStyle = `rgba(190,215,255,${Math.min(0.34, 0.08 + sp * 0.9)})`;
          ctx.beginPath();
          ctx.moveTo((p.px - u * 5) * scale, (p.py - v * 5) * scale);
          ctx.lineTo(p.x * scale, p.y * scale);
          ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = 'source-over';

      // solid parts
      const y = sim.strip * scale;
      if (sim.params.config === 'burner') {
        const x0 = sim.x0 * scale;
        const w = (sim.x1 - sim.x0 + 1) * scale;
        const grad = ctx.createLinearGradient(x0, 0, x0 + w, 0);
        grad.addColorStop(0, '#3a3a3e');
        grad.addColorStop(0.5, '#8a8a90');
        grad.addColorStop(1, '#2c2c30');
        ctx.fillStyle = grad;
        ctx.fillRect(x0, y, w, H - y);
      } else {
        for (let i = sim.x0; i <= sim.x1; i++) {
          const m = sim.M[i];
          if (m <= 0.03) continue;
          // virgin sheet is pale; it darkens as it chars and glows as the surface heats
          const hot = Math.max(0, Math.min(1, (sim.Ts[i] - 1.7) / 1.2));
          const base = 60 + 150 * m;
          ctx.fillStyle = `rgb(${Math.min(255, base + 160 * hot)},${base * (1 - 0.25 * hot) + 30 * hot},${base * (1 - 0.6 * hot)})`;
          ctx.fillRect(i * scale, y + scale * (0.5 - 0.3 * (0.4 + 0.6 * m)), scale + 0.5, scale * 0.6 * (0.4 + 0.6 * m));
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, [nx, ny, scale, tracers]);

  return <canvas ref={canvasRef} width={nx * scale} height={ny * scale} role="img" aria-label={label} />;
}
