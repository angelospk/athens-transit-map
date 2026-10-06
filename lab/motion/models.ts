// Motion lab candidates (lab/motion/program.md). This is the file experiments change.
// A model gets what the map knows when fix A arrives and returns s(t): metres along the shape
// at GPS time t. Times are unix seconds.

import { drive, MIN_CRUISE, NO_SPEED } from "../../src/lib/motion";

// The pre-2026-10-06 guess (src/lib/motion.ts aheadM), kept for the baseline.
const aheadM = (v: number, dt: number) => v * 60 * (1 - Math.exp(-Math.min(Math.max(dt, 0), 150) / 60));

export interface Fix { at: number; known: number; s: number; speed: number | null; delay: number | null }
export interface Run { veh: string; line: string; variant: string; stopS: number[]; endS: number; fixes: Fix[] }
// hist: this run's fixes up to A (A last). peers: other runs of the variant, only fixes known by `now`.
export interface Ctx { run: Run; hist: Fix[]; now: number; peers: Run[] }
export interface Model { name: string; predict: (c: Ctx) => (t: number) => number }

const last = <T>(a: T[]) => a[a.length - 1];
const nextStop = (run: Run, s: number) => run.stopS.find(x => x > s + 15) ?? run.endS;

// Constant speed k·v for at most h seconds after the fix; no speed: `fallback` m/s.
const constant = (k: number, h: number, fallback = 0, speedOf: (c: Ctx) => number | null = c => last(c.hist).speed) =>
  (c: Ctx) => {
    const A = last(c.hist), v = speedOf(c) ?? fallback;
    return (t: number) => Math.min(c.run.endS, A.s + k * v * Math.min(Math.max(t - A.at, 0), h));
  };

// Drive with stops: cruise, brake at `acc` into every stop, wait `dwell` s, accelerate again.
// The cruise speed keeps the average (with dwells) at k·v over the typical stop spacing.
// maxStops: stops the route may pass (today's backend `path` ends at the next one: 1).
function profile(k: number, dwell: number, h: number, fallback = 0, acc = 1, speedOf: (c: Ctx) => number | null = c => last(c.hist).speed, maxStops = Infinity) {
  return (c: Ctx) => {
    const A = last(c.hist), v = k * (speedOf(c) ?? fallback);
    const ahead = c.run.stopS.filter(x => x > A.s + 15), stops = ahead.slice(0, maxStops);
    const endS = ahead.length > maxStops ? ahead[maxStops - 1] : c.run.endS;
    const gaps = ahead.slice(0, 4).map((x, i) => x - (i ? ahead[i - 1] : A.s)).filter(g => g > 0);
    const L = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 400;
    const tRun = L / Math.max(v, 0.01) - dwell;
    const vc = v <= 0 ? 0 : tRun > L / 15 ? L / tRun : 15;
    const dt = 0.5, out = [A.s];
    let s = A.s, sp = vc, wait = 0, si = 0;
    for (let i = 1; i * dt <= h; i++) {
      if (wait > 0) { wait -= dt; if (wait <= 0) si++; out.push(s); continue; }
      const stop = stops[si] ?? endS, d = stop - s;
      const vmax = Math.sqrt(2 * acc * Math.max(d, 0));
      sp = Math.min(vc, sp + acc * dt, vmax);
      s = Math.min(s + sp * dt, stop);
      if (stop - s < 1 && si < stops.length) { s = stop; sp = 0; wait = dwell; }
      out.push(s);
    }
    return (t: number) => out[Math.min(out.length - 1, Math.max(0, Math.round((t - A.at) / dt)))];
  };
}

// TheTransitClock "LastVehicle": the speed of other vehicles of the variant over the next 400 m,
// from their fix pairs known now and at most 20 min old.
function peerSpeed(c: Ctx): number | null {
  const A = last(c.hist), lo = A.s, hi = A.s + 400;
  let ds = 0, dt = 0;
  for (const p of c.peers) for (let i = 1; i < p.fixes.length; i++) {
    const a = p.fixes[i - 1], b = p.fixes[i];
    if (c.now - b.at > 1200 || b.at - a.at > 300) continue;
    const ov = Math.min(b.s, hi) - Math.max(a.s, lo);
    if (ov <= 0 || b.s <= a.s) continue;
    const share = ov / (b.s - a.s);
    ds += ov; dt += share * (b.at - a.at);
  }
  return dt >= 30 ? ds / dt : null;
}

// Own speed and peers' speed, weighted 1 : 1; either alone when the other is missing.
const blended = (c: Ctx) => {
  const own = last(c.hist).speed, peer = peerSpeed(c);
  return own == null ? peer : peer == null ? own : (own + peer) / 2;
};

// Scalar Kalman on speed over this run's fix pairs, prior 3 ± 2 m/s, measurement noise 25 m per fix.
function kalmanSpeed(c: Ctx): number | null {
  let v = 3, P = 4;
  const f = c.hist;
  for (let i = 1; i < f.length; i++) {
    const dt = f[i].at - f[i - 1].at;
    if (dt < 10) continue;
    P += 0.02 * dt;                          // speed drifts
    const z = Math.max(0, (f[i].s - f[i - 1].s) / dt), R = (2 * 25 * 25) / (dt * dt);
    const K = P / (P + R);
    v += K * (z - v); P *= 1 - K;
  }
  return f.length > 1 ? v : null;
}

// Own mean speed over this run's last `w` seconds (stops included), instead of the backend's
// median slope (Theil-Sen, which tends to ignore the standing parts).
const ownMean = (w: number) => (c: Ctx): number | null => {
  const A = last(c.hist), old = c.hist.find(f => A.at - f.at <= w);
  if (!old || A.at - old.at < 30) return A.speed;
  return Math.max(0, Math.min(20, (A.s - old.s) / (A.at - old.at)));
};

function shipped(c: Ctx, maxStops: number, minCruise = MIN_CRUISE) {
  const A = last(c.hist), ahead = c.run.stopS.filter(x => x > A.s + 15).map(x => x - A.s);
  const end = ahead.length > maxStops ? ahead[maxStops - 1] : c.run.endS - A.s;
  const f = drive(A.speed ?? NO_SPEED, maxStops === Infinity ? ahead : ahead.slice(0, maxStops - 1), end, undefined, minCruise);
  return (t: number) => A.s + f(t - A.at);
}

export const MODELS: Model[] = [
  { name: "stand (no motion)", predict: c => { const s = last(c.hist).s; return () => s; } },
  {
    name: "today (decay60, cap next stop)",
    predict: c => {
      const A = last(c.hist), cap = nextStop(c.run, A.s);
      return t => (A.speed == null ? A.s : Math.min(cap, A.s + aheadM(A.speed, t - A.at)));
    },
  },
  { name: "const 0.8 h150 fb1.5", predict: constant(0.8, 150, 1.5) },
  { name: "const 1.0 h150", predict: constant(1, 150) },
  // Chosen (2026-10-06): stops, 0.85 x speed, 15 s dwell, 180 s horizon, 1.5 m/s without speed.
  { name: "stops 0.85 d15 h180 fb1.5", predict: profile(0.85, 15, 180, 1.5) },
  { name: "  same, path to 1 stop (today)", predict: profile(0.85, 15, 180, 1.5, 1, undefined, 1) },
  { name: "  same, path to 3 stops", predict: profile(0.85, 15, 180, 1.5, 1, undefined, 3) },
  // What ships (src/lib/motion.ts drive): line markers see every stop; the city layer sees the
  // backend path (today: to the next stop; contract rev 4: up to 3 stops).
  { name: "SHIP drive, all stops", predict: c => shipped(c, Infinity) },
  { name: "SHIP drive, path to 1 stop", predict: c => shipped(c, 1) },
  { name: "SHIP drive, path to 3 stops", predict: c => shipped(c, 3) },
  { name: "  SHIP all stops, no min cruise (before)", predict: c => shipped(c, Infinity, 0) },
  { name: "stops 1.0 d15 h180 fb1.5", predict: profile(1.0, 15, 180, 1.5) },
  { name: "stops own+peer 0.85 (LastVehicle)", predict: profile(0.85, 15, 180, 1.5, 1, blended) },
  { name: "stops mean300 0.85", predict: profile(0.85, 15, 180, 1.5, 1, ownMean(300)) },
  { name: "kalman 0.85 h180 fb1.5", predict: constant(0.85, 180, 1.5, kalmanSpeed) },
];
