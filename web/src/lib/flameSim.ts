/**
 * 2D diffusion-flame illustration (NOT calibrated, NOT a calculation, never used for an EMBER answer).
 *
 * It is a reduced model, but every term is a real mechanism:
 *  - incompressible Boussinesq flow: semi-Lagrangian advection, viscosity, pressure projection,
 *    buoyancy ∝ g·(T − T∞). Gravity therefore changes the flow field itself, not just a drift term;
 *  - solid fuel: the sheet heats up by conduction from the gas, loses heat by surface radiation ∝ Ts⁴,
 *    and pyrolyses (Arrhenius in surface temperature) into fuel vapour, consuming latent heat;
 *  - gas phase: fuel vapour and oxygen inter-diffuse and react (one-step, finite-rate Arrhenius);
 *  - radiation: optically thin gas loss ∝ T⁴ plus the surface loss above. This is what quenches slow
 *    flames in microgravity; finite-rate chemistry is what blows fast ones off;
 *  - soot proxy: forms in hot fuel-rich gas, burns out in hot oxygen. Used for the yellow glow only.
 *
 * Units are non-dimensional: T is in units of ambient temperature (1 ≈ 300 K), oxygen is in units of
 * its value in air (1 = 21 % O₂), lengths are grid cells. Constants are hand-set, not fitted to data.
 */
export type SimConfig = 'strip' | 'burner';

export interface SimParams {
  o2Pct: number; // ambient oxygen, % by volume
  flowCmS: number; // forced flow, cm/s (left → right)
  gravityG: number; // 0..1, pointing down
  config?: SimConfig; // 'strip': thin solid sheet, opposed-flow spread. 'burner': steady gas jet.
}

export interface Sim {
  nx: number;
  ny: number;
  /** gas temperature / T∞ */
  T: Float32Array;
  /** oxygen, 1 = air */
  O: Float32Array;
  /** fuel vapour */
  F: Float32Array;
  /** soot proxy */
  S: Float32Array;
  /** reaction rate of the last step (for rendering the blue reaction zone) */
  W: Float32Array;
  u: Float32Array;
  v: Float32Array;
  p: Float32Array;
  /** remaining solid fuel per column (1 = virgin, 0 = burned out); strip config only */
  M: Float32Array;
  /** solid surface temperature per column */
  Ts: Float32Array;
  /** per-column pyrolysis rate of the last step */
  P: Float32Array;
  t: number;
  strip: number; // row index of the fuel sheet
  x0: number; // first / last column of the sheet
  x1: number;
  params: SimParams;
  tmp: Float32Array[];
}

/** Hand-set constants (illustration only). Exported so they can be inspected. */
export const K = {
  DT: 0.5,
  D_T: 0.2, // thermal diffusivity
  D_Y: 0.2, // species diffusivity (unit Lewis number)
  NU: 0.14, // kinematic viscosity (Pr ≈ 0.7)
  A: 150, // gas-phase pre-exponential
  E: 22, // gas-phase activation temperature / T∞
  Q: 7.2, // temperature rise per unit of oxygen consumed → ≈ 2100 K flame in air
  S: 5, // oxygen (air units) consumed per unit of fuel vapour
  RAD_GAS: 1.5e-5, // optically thin gas radiation, × (T⁴ − 1)
  RAD_SURF: 5e-4, // surface radiation, × (Ts⁴ − 1)
  C_S: 6, // thermal inertia of the sheet relative to one gas cell
  A_P: 900, // pyrolysis pre-exponential
  E_P: 17, // pyrolysis activation temperature / T∞ (onset near Ts ≈ 2 ≈ 600 K)
  L_V: 1.1, // heat of gasification
  YIELD: 2.5, // fuel vapour released per unit of solid consumed
  BURN: 0.5, // solid consumed per unit of pyrolysis rate
  BUOY: 0.008, // buoyant acceleration per g per unit of (T − 1)
  U_PER_CM_S: 1 / 80, // forced flow: grid cells per unit time per cm/s
  JET: 0.14, // burner: fuel supply rate
  T_MAX: 10,
};

const TMP = 6;

export function createSim(params: SimParams, nx = 160, ny = 80): Sim {
  const n = nx * ny;
  const config = params.config ?? 'strip';
  const strip = config === 'strip' ? Math.floor(ny * 0.56) : Math.floor(ny * 0.8);
  const sim: Sim = {
    nx, ny,
    T: new Float32Array(n).fill(1),
    O: new Float32Array(n).fill(params.o2Pct / 21),
    F: new Float32Array(n),
    S: new Float32Array(n),
    W: new Float32Array(n),
    u: new Float32Array(n).fill(params.flowCmS * K.U_PER_CM_S),
    v: new Float32Array(n),
    p: new Float32Array(n),
    M: new Float32Array(nx),
    Ts: new Float32Array(nx).fill(1),
    P: new Float32Array(nx),
    t: 0,
    strip,
    x0: config === 'strip' ? 8 : Math.floor(nx / 2) - 4,
    x1: config === 'strip' ? nx - 10 : Math.floor(nx / 2) + 4,
    params: { ...params, config },
    tmp: Array.from({ length: TMP }, () => new Float32Array(n)),
  };
  if (config === 'strip') for (let i = sim.x0; i <= sim.x1; i++) sim.M[i] = 1;
  return sim;
}

/** Hot-wire igniter: active for the first moments, then switched off like the real one. */
const IGNITER_TIME = 70;
function igniterCells(sim: Sim, fn: (k: number) => void) {
  const { nx, strip } = sim;
  if (sim.params.config === 'burner') {
    const c = nx >> 1;
    for (let j = strip - 7; j <= strip - 3; j++) for (let i = c - 4; i <= c + 4; i++) fn(j * nx + i);
  } else {
    for (let j = strip - 3; j <= strip + 3; j++) if (j !== strip) for (let i = sim.x1 - 9; i <= sim.x1 - 2; i++) fn(j * nx + i);
  }
}

function advect(dst: Float32Array, src: Float32Array, u: Float32Array, v: Float32Array, nx: number, ny: number, dt: number) {
  const xm = nx - 1.001;
  const ym = ny - 1.001;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      let x = i - dt * u[k];
      let y = j - dt * v[k];
      if (x < 0) x = 0; else if (x > xm) x = xm;
      if (y < 0) y = 0; else if (y > ym) y = ym;
      const i0 = x | 0;
      const j0 = y | 0;
      const fx = x - i0;
      const fy = y - j0;
      const a = j0 * nx + i0;
      dst[k] = (1 - fy) * ((1 - fx) * src[a] + fx * src[a + 1]) + fy * ((1 - fx) * src[a + nx] + fx * src[a + nx + 1]);
    }
  }
}

export function step(sim: Sim, steps = 1): void {
  const { nx, ny, T, O, F, S, W, u, v, p, M, Ts, P, strip } = sim;
  const [a, b, c, d, e, f] = sim.tmp;
  const dt = K.DT;
  const n = nx * ny;
  const o0 = sim.params.o2Pct / 21;
  const U = sim.params.flowCmS * K.U_PER_CM_S;
  const g = sim.params.gravityG;
  const burner = sim.params.config === 'burner';
  const sk = strip * nx;
  const solid = (i: number) => (burner ? i >= sim.x0 && i <= sim.x1 : M[i] > 0.03);

  for (let s = 0; s < steps; s++) {
    // ---- 1. momentum: buoyancy, self-advection, viscosity
    if (g > 0) for (let k = 0; k < n; k++) v[k] -= dt * K.BUOY * g * (T[k] - 1);
    advect(a, u, u, v, nx, ny, dt);
    advect(b, v, u, v, nx, ny, dt);
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        u[k] = a[k] + dt * K.NU * (a[k - 1] + a[k + 1] + a[k - nx] + a[k + nx] - 4 * a[k]);
        v[k] = b[k] + dt * K.NU * (b[k - 1] + b[k + 1] + b[k - nx] + b[k + nx] - 4 * b[k]);
      }
    }
    // no-slip on the sheet / burner rim
    for (let i = sim.x0; i <= sim.x1; i++) if (solid(i)) { u[sk + i] = 0; v[sk + i] = 0; }
    // open boundaries: uniform inflow on the left, zero-gradient elsewhere
    for (let j = 0; j < ny; j++) {
      u[j * nx] = U; v[j * nx] = 0;
      u[j * nx + nx - 1] = u[j * nx + nx - 2]; v[j * nx + nx - 1] = v[j * nx + nx - 2];
    }
    for (let i = 0; i < nx; i++) {
      u[i] = u[nx + i]; v[i] = v[nx + i];
      u[(ny - 1) * nx + i] = u[(ny - 2) * nx + i]; v[(ny - 1) * nx + i] = v[(ny - 2) * nx + i];
    }
    // ---- 2. pressure projection (p = 0 on the open boundary), warm-started Gauss–Seidel with over-relaxation
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        c[k] = 0.5 * (u[k + 1] - u[k - 1] + v[k + nx] - v[k - nx]);
      }
    const iters = g > 0 ? 16 : 8;
    // sweep direction alternates so the solver has no left/right bias
    for (let it = 0; it < iters; it++)
      for (let j = 1; j < ny - 1; j++) {
        if (it & 1) {
          for (let i = nx - 2; i >= 1; i--) {
            const k = j * nx + i;
            p[k] += 1.6 * (0.25 * (p[k - 1] + p[k + 1] + p[k - nx] + p[k + nx] - c[k]) - p[k]);
          }
        } else {
          for (let i = 1; i < nx - 1; i++) {
            const k = j * nx + i;
            p[k] += 1.6 * (0.25 * (p[k - 1] + p[k + 1] + p[k - nx] + p[k + nx] - c[k]) - p[k]);
          }
        }
      }
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        u[k] -= 0.5 * (p[k + 1] - p[k - 1]);
        v[k] -= 0.5 * (p[k + nx] - p[k - nx]);
      }
    for (let i = sim.x0; i <= sim.x1; i++) if (solid(i)) { u[sk + i] = 0; v[sk + i] = 0; }

    // ---- 3. solid phase: heat balance and pyrolysis (strip) or fuel jet (burner)
    if (burner) {
      for (let i = sim.x0 + 1; i < sim.x1; i++) F[sk - nx + i] += dt * K.JET;
    } else {
      for (let i = sim.x0; i <= sim.x1; i++) {
        P[i] = 0;
        if (M[i] <= 0.03) continue;
        const k = sk + i;
        const ts = Ts[i];
        let rate = K.A_P * M[i] * Math.exp(-K.E_P / ts);
        if (rate > M[i] / (K.BURN * dt)) rate = M[i] / (K.BURN * dt);
        const cond = K.D_T * (T[k - 1] + T[k + 1] + T[k - nx] + T[k + nx] - 4 * ts);
        const t4 = ts * ts * ts * ts;
        Ts[i] = Math.max(1, ts + (dt / K.C_S) * (cond - K.RAD_SURF * (t4 - 1) * K.C_S - K.L_V * rate));
        M[i] -= dt * K.BURN * rate;
        P[i] = rate;
        // vapour leaves both faces of the sheet
        F[k - nx] += 0.5 * dt * K.YIELD * rate;
        F[k + nx] += 0.5 * dt * K.YIELD * rate;
        T[k] = Ts[i];
      }
    }
    if (sim.t < IGNITER_TIME) igniterCells(sim, (k) => { if (T[k] < 6.5) T[k] = 6.5; });

    // ---- 4. scalars: advection, then diffusion + reaction + radiation
    advect(a, T, u, v, nx, ny, dt);
    advect(b, O, u, v, nx, ny, dt);
    advect(c, F, u, v, nx, ny, dt);
    advect(d, S, u, v, nx, ny, dt);
    for (let j = 1; j < ny - 1; j++) {
      const onStrip = j === strip;
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        const isSolid = onStrip && i >= sim.x0 && i <= sim.x1 && solid(i);
        const t = a[k];
        const o = b[k];
        const fu = c[k];
        let w = 0;
        if (!isSolid && fu > 1e-5 && o > 1e-5 && t > 1.6) {
          w = K.A * fu * o * Math.exp(-K.E / t);
          const lim = Math.min(fu, o / K.S) / dt;
          if (w > lim) w = lim;
        }
        W[k] = w;
        const t2 = t * t;
        let tn = t + dt * (K.D_T * (a[k - 1] + a[k + 1] + a[k - nx] + a[k + nx] - 4 * t) + K.Q * K.S * w - K.RAD_GAS * (1 + 30 * d[k]) * (t2 * t2 - 1));
        if (tn < 1) tn = 1; else if (tn > K.T_MAX) tn = K.T_MAX;
        e[k] = isSolid ? Ts[i] : tn;
        let on = o + dt * (K.D_Y * (b[k - 1] + b[k + 1] + b[k - nx] + b[k + nx] - 4 * o) - K.S * w);
        if (on < 0) on = 0;
        O[k] = on;
        let fn = fu + dt * (K.D_Y * (c[k - 1] + c[k + 1] + c[k - nx] + c[k + nx] - 4 * fu) - w);
        if (fn < 0) fn = 0;
        f[k] = fn;
        // soot proxy: inception in hot fuel-rich gas, oxidation in hot oxygen
        const so = d[k];
        let sn = so + dt * (0.12 * (d[k - 1] + d[k + 1] + d[k - nx] + d[k + nx] - 4 * so) + (t > 3.6 ? 0.05 * fu * (t - 3.6) : 0) - 0.07 * so * o * (t > 3 ? t - 3 : 0) - 0.004 * so);
        if (sn < 0) sn = 0; else if (sn > 1.5) sn = 1.5;
        S[k] = sn;
      }
    }
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        T[k] = e[k];
        F[k] = f[k];
      }
    // boundaries: ambient where fluid enters, zero-gradient where it leaves
    for (let j = 0; j < ny; j++) {
      const l = j * nx;
      const r = l + nx - 1;
      T[l] = 1; O[l] = o0; F[l] = 0; S[l] = 0;
      if (u[r] < 0) { T[r] = 1; O[r] = o0; F[r] = 0; S[r] = 0; } else { T[r] = T[r - 1]; O[r] = O[r - 1]; F[r] = F[r - 1]; S[r] = S[r - 1]; }
    }
    for (let i = 0; i < nx; i++) {
      const tp = i;
      const bt = (ny - 1) * nx + i;
      if (v[tp] > 0) { T[tp] = 1; O[tp] = o0; F[tp] = 0; S[tp] = 0; } else { T[tp] = T[tp + nx]; O[tp] = O[tp + nx]; F[tp] = F[tp + nx]; S[tp] = S[tp + nx]; }
      if (v[bt] < 0 || burner) { T[bt] = 1; O[bt] = o0; F[bt] = 0; S[bt] = 0; } else { T[bt] = T[bt - nx]; O[bt] = O[bt - nx]; F[bt] = F[bt - nx]; S[bt] = S[bt - nx]; }
    }
    sim.t += dt;
  }
}

export interface SimStats {
  /** fraction of the sheet consumed (strip) */
  burnedFrac: number;
  burning: boolean;
  /** leading (upstream) edge of the pyrolysis zone, column index */
  front: number | null;
  /** peak gas temperature, in units of T∞ */
  peakT: number;
  /** total gas-phase reaction rate */
  heatRelease: number;
  igniterOn: boolean;
}

export function stats(sim: Sim): SimStats {
  const { nx, ny, M, P, T, W } = sim;
  let burned = 0;
  let total = 0;
  let front: number | null = null;
  if (sim.params.config !== 'burner') {
    for (let i = sim.x0; i <= sim.x1; i++) {
      total += 1;
      burned += 1 - M[i];
      if (front === null && P[i] > 2e-3) front = i;
    }
  }
  let peakT = 1;
  let hr = 0;
  for (let k = 0; k < nx * ny; k++) {
    if (T[k] > peakT) peakT = T[k];
    hr += W[k];
  }
  const igniterOn = sim.t < IGNITER_TIME;
  return { burnedFrac: total ? burned / total : 0, burning: hr > 0.02 && peakT > 3.2, front, peakT, heatRelease: hr, igniterOn };
}

/**
 * Write the luminous flame into an RGBA buffer of nx × ny pixels.
 * Blue: chemiluminescence of the reaction zone (∝ reaction rate). Yellow-white: hot soot, intensity ∝ soot × T⁴,
 * hue from temperature. Solid fuel is drawn by the caller.
 */
export function renderFlame(sim: Sim, out: Uint8ClampedArray, exposure = 1): void {
  const { nx, ny, T, S, W, O } = sim;
  const o0 = sim.params.o2Pct / 21;
  for (let k = 0; k < nx * ny; k++) {
    const t = T[k];
    const x = t / 7;
    const x4 = x * x * x * x;
    const soot = (1 - Math.exp(-12 * S[k] * x4)) * 1.15 * exposure;
    // black-body-like hue: deep orange when cooler, pale yellow-white when hot
    const hot = Math.max(0, Math.min(1, (t - 4.2) / 3.2));
    const blue = (1 - Math.exp(-55 * W[k])) * exposure;
    // faint thermal haze so the hot plume is visible, plus oxygen-depleted wake
    const haze = Math.max(0, Math.min(1, (t - 1.15) / 6)) * 0.22;
    const dep = Math.max(0, 1 - O[k] / o0) * (t < 2 ? 0.1 : 0);
    const r = 255 * (soot * 1.0 + blue * 0.18 + haze * 0.9);
    const g = 255 * (soot * (0.42 + 0.5 * hot) + blue * 0.42 + haze * 0.25);
    const b = 255 * (soot * (0.06 + 0.5 * hot * hot) + blue * 1.0 + haze * 0.1 + dep);
    const p = k * 4;
    out[p] = r;
    out[p + 1] = g;
    out[p + 2] = b;
    out[p + 3] = 255;
  }
}
