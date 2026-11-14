/**
 * Toy 2D thin-fuel flame-spread illustration (NOT calibrated, NOT a calculation).
 * Fields on a grid: temperature T (1 = ambient), oxidizer Y (1 = air), fuel F on a thin strip.
 * Advection by forced flow (+x) and a buoyant updraft proportional to gravity and local heating,
 * diffusion, one-step Arrhenius reaction, and a linear heat-loss term (surface radiation).
 */
export interface SimParams {
  o2Pct: number; // ambient oxygen, %
  flowCmS: number; // forced flow, cm/s (mapped to cells/step)
  gravityG: number; // 0..1
}

export interface Sim {
  nx: number;
  ny: number;
  T: Float32Array;
  Y: Float32Array;
  F: Float32Array;
  t: number;
  strip: number; // row index of the fuel strip
  params: SimParams;
}

export function createSim(params: SimParams, nx = 160, ny = 90): Sim {
  const n = nx * ny;
  const T = new Float32Array(n).fill(1);
  const Y = new Float32Array(n).fill(params.o2Pct / 21);
  const F = new Float32Array(n);
  const strip = Math.floor(ny * 0.55);
  for (let i = 10; i < nx - 10; i++) F[strip * nx + i] = 1;
  // igniter on the downstream (right) end so the flame spreads against the flow (opposed spread)
  for (let j = strip - 2; j <= strip + 2; j++) for (let i = nx - 18; i < nx - 12; i++) T[j * nx + i] = 5;
  return { nx, ny, T, Y, F, t: 0, strip, params };
}

/** Hand-tuned constants (illustration only). Exported so they can be inspected. */
export const K = { D_T: 0.18, D_Y: 0.16, A: 200, E: 16, Q: 6, S: 1.2, LOSS: 0.012, BURN: 0.25 };
const DT = 0.5;

export function step(sim: Sim, steps = 1): void {
  const { nx, ny, T, Y, F } = sim;
  const y0 = sim.params.o2Pct / 21;
  const u = Math.min(0.9, sim.params.flowCmS / 40); // cells per unit time
  const beta = 0.05 * sim.params.gravityG;
  const Tn = new Float32Array(T.length);
  const Yn = new Float32Array(Y.length);
  for (let s = 0; s < steps; s++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const im = i > 0 ? k - 1 : k;
        const ip = i < nx - 1 ? k + 1 : k;
        const jm = j > 0 ? k - nx : k;
        const jp = j < ny - 1 ? k + nx : k;
        const v = Math.min(0.9, beta * Math.max(0, T[k] - 1)); // upward (towards j-1)
        // upwind advection: +x by u, -y by v
        const advT = u * (T[k] - T[im]) - v * (T[jp] - T[k]);
        const advY = u * (Y[k] - Y[im]) - v * (Y[jp] - Y[k]);
        const lapT = T[im] + T[ip] + T[jm] + T[jp] - 4 * T[k];
        const lapY = Y[im] + Y[ip] + Y[jm] + Y[jp] - 4 * Y[k];
        let w = 0;
        if (F[k] > 0 && Y[k] > 0) w = K.A * F[k] * Y[k] * Math.exp(-K.E / T[k]);
        w = Math.min(w, F[k] / (K.BURN * DT), Y[k] / (K.S * DT));
        Tn[k] = T[k] + DT * (K.D_T * lapT - advT + K.Q * w - K.LOSS * (T[k] - 1));
        Yn[k] = Y[k] + DT * (K.D_Y * lapY - advY - K.S * w);
        F[k] -= DT * w * K.BURN;
        if (F[k] < 0) F[k] = 0;
      }
    }
    // boundaries: inflow (left) and far field (top/bottom) are ambient
    for (let j = 0; j < ny; j++) {
      Tn[j * nx] = 1;
      Yn[j * nx] = y0;
    }
    for (let i = 0; i < nx; i++) {
      Tn[i] = 1;
      Yn[i] = y0;
      Tn[(ny - 1) * nx + i] = 1;
      Yn[(ny - 1) * nx + i] = y0;
    }
    for (let k = 0; k < T.length; k++) {
      T[k] = Math.min(12, Math.max(1, Tn[k]));
      Y[k] = Math.max(0, Yn[k]);
    }
    sim.t += DT;
  }
}

/** Fraction of the strip consumed and whether any part is still burning. */
export function stats(sim: Sim): { burnedFrac: number; burning: boolean; front: number | null } {
  const { nx, F, T, strip } = sim;
  let total = 0;
  let burned = 0;
  let burning = false;
  let front: number | null = null;
  for (let i = 10; i < nx - 10; i++) {
    const k = strip * nx + i;
    total += 1;
    burned += 1 - F[k];
    if (F[k] > 0.05 && T[k] > 2.2) {
      burning = true;
      if (front === null || i < front) front = i;
    }
  }
  return { burnedFrac: burned / total, burning, front };
}
