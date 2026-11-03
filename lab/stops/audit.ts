// Stop audit: where do buses really halt near each GTFS stop? Pure parts (run.ts does the IO).
//
// Every fix near a stop is a sample: a bus spends its dwell at the stop, so fixes pile up where it
// halts. Each fix is placed on its own variant's shape (metres along it), so a fix of the other
// direction or of the loop's other side never counts for this stop. Traffic lights and junctions also
// make piles: `measure` looks for one clear peak near the stop and says how sure it is.

import { distM, type LatLon } from "../../src/lib/stopfix";

export interface Fix { t: number; veh: string; trip: string; shape: string; lat: number; lon: number; s: number }

// Athens day number (UTC+2 is close enough to split the days in two halves).
export const dayOf = (t: number) => Math.floor((t + 7200) / 86400);

/** Metres along the shape at each of its points. */
export function cumulative(shape: LatLon[]): number[] {
  const c = [0];
  for (let i = 1; i < shape.length; i++) c.push(c[i - 1] + distM(shape[i - 1], shape[i]));
  return c;
}

export interface Proj { s: number; d: number }

/** The nearest point of the shape to p whose metres along lie in [lo, hi]. */
export function projectOn(shape: LatLon[], cum: number[], p: LatLon, lo = -Infinity, hi = Infinity): Proj {
  let best: Proj = { s: NaN, d: Infinity };
  const k = Math.cos((p[0] * Math.PI) / 180) * 111_320, m = 111_320;
  for (let i = 0; i + 1 < shape.length; i++) {
    if (cum[i + 1] < lo || cum[i] > hi) continue;
    const ax = (shape[i][1] - p[1]) * k, ay = (shape[i][0] - p[0]) * m;
    const bx = (shape[i + 1][1] - p[1]) * k, by = (shape[i + 1][0] - p[0]) * m;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, len = cum[i + 1] - cum[i];
    // The part of this segment inside [lo, hi], as a share of it.
    const u0 = len > 0 ? Math.max(0, (lo - cum[i]) / len) : 0, u1 = len > 0 ? Math.min(1, (hi - cum[i]) / len) : 1;
    const u = l2 ? Math.max(u0, Math.min(u1, -(ax * dx + ay * dy) / l2)) : u0;
    const d = Math.hypot(ax + u * dx, ay + u * dy);
    if (d < best.d - 0.5) best = { s: cum[i] + u * (cum[i + 1] - cum[i]), d };
  }
  return best;
}

const CAND_M = 60;   // a segment this close to a stop may be its place

// Each segment's nearest point to p, for the segments within CAND_M (else the nearest of all).
function candidates(shape: LatLon[], cum: number[], p: LatLon): Proj[] {
  const out: Proj[] = [];
  for (let i = 0; i + 1 < shape.length; i++) {
    const c = projectOn([shape[i], shape[i + 1]], [cum[i], cum[i + 1]], p);
    if (c.d <= CAND_M) out.push(c);
  }
  return out.length ? out : [projectOn(shape, cum, p)];
}

/**
 * Metres along the shape of each stop, in route order: the places with the least total distance from
 * the stops such that no stop comes before the one ahead of it (dynamic programming over each stop's
 * candidate segments). The nearest point alone fails on loops (the terminal stop is at both ends) and
 * on streets the route takes both ways.
 */
export function projectStops(shape: LatLon[], cum: number[], stops: LatLon[]): number[] {
  if (!stops.length) return [];
  const cand = stops.map(p => candidates(shape, cum, p));
  const OUT_OF_ORDER = 1000;   // a stop that cannot be in order still gets a place, at this cost
  const cost: number[][] = [cand[0].map(c => c.d)];
  const from: number[][] = [cand[0].map(() => -1)];
  for (let k = 1; k < cand.length; k++) {
    cost.push([]); from.push([]);
    for (const c of cand[k]) {
      let best = Infinity, arg = -1;
      cand[k - 1].forEach((p, i) => {
        const x = cost[k - 1][i] + (p.s <= c.s + 1 ? 0 : OUT_OF_ORDER);
        if (x < best) { best = x; arg = i; }
      });
      cost[k].push(best + c.d);
      from[k].push(arg);
    }
  }
  const last = cost.length - 1;
  let j = cost[last].indexOf(Math.min(...cost[last]));
  const out = new Array<number>(stops.length);
  for (let k = last; k >= 0; k--) { out[k] = cand[k][j].s; j = from[k][j]; }
  return out;
}

// One halt as seen from one stop: `a` metres along the route from the GTFS stop (+ = after it).
export interface Sample { a: number; lat: number; lon: number; day: number }
export type Confidence = "high" | "medium" | "low" | "none";
export interface Measure {
  along: number;     // m, mean of the peak's halts (+ = buses halt after the GTFS stop)
  lat: number; lon: number;   // median position of the peak's halts
  halts: number;     // halts in the peak
  window: number;    // halts in the window
  second: number;    // strongest other peak / the peak (0..1): a traffic light or the next stop
  atStop: number;    // density at the GTFS stop / the peak (0..1): do buses also halt where GTFS says?
  edge: boolean;     // the peak is at the end of the window: likely a queue or light beyond it
  confidence: Confidence;
}

export const PEAK_M = 12;       // a halt within this of the peak supports it
const SIGMA = 5, OTHER_M = 25, EDGE_M = 10;

// The peak of the halts' density (Gaussian kernel, 1 m bins) in [-back, ahead]; second: the strongest
// point at least OTHER_M away, as a share of the peak.
function peakOf(a: number[], back: number, ahead: number): { at: number; second: number; atStop: number } {
  const lo = Math.floor(-back), n = Math.ceil(ahead) - lo + 1;
  const dens = new Float64Array(n);
  for (const x of a) {
    const c = x - lo;
    for (let i = Math.max(0, Math.floor(c - 3 * SIGMA)); i <= Math.min(n - 1, Math.ceil(c + 3 * SIGMA)); i++)
      dens[i] += Math.exp(-(((i - c) / SIGMA) ** 2) / 2);
  }
  let top = 0;
  for (let i = 1; i < n; i++) if (dens[i] > dens[top]) top = i;
  let other = 0;
  for (let i = 0; i < n; i++) if (Math.abs(i - top) >= OTHER_M) other = Math.max(other, dens[i]);
  return { at: top + lo, second: dens[top] ? other / dens[top] : 0, atStop: dens[top] ? dens[Math.min(n - 1, Math.max(0, -lo))] / dens[top] : 0 };
}

const median = (v: number[]) => {
  const s = [...v].sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** The halts' peak near a stop, from samples in [-back, ahead] metres along, and how sure it is. */
export function measure(samples: Sample[], back: number, ahead: number): Measure {
  const w = samples.filter(x => x.a >= -back && x.a <= ahead);
  if (!w.length) return { along: NaN, lat: NaN, lon: NaN, halts: 0, window: 0, second: 0, atStop: 0, edge: false, confidence: "none" };
  const { at, second, atStop } = peakOf(w.map(x => x.a), back, ahead);
  const edge = at - -back < EDGE_M || ahead - at < EDGE_M;
  const peak = w.filter(x => Math.abs(x.a - at) <= PEAK_M);
  const along = peak.reduce((s, x) => s + x.a, 0) / peak.length;
  // The same peak in the even and the odd days: not one week's road works or one driver's habit.
  const half = (r: number) => w.filter(x => x.day % 2 === r).map(x => x.a);
  const even = half(0), odd = half(1);
  const steady = even.length >= 5 && odd.length >= 5 && Math.abs(peakOf(even, back, ahead).at - peakOf(odd, back, ahead).at) <= 10;
  const share = peak.length / w.length;
  const confidence: Confidence =
    peak.length >= 15 && share >= 0.4 && second < 0.5 && steady ? "high" :
    peak.length >= 6 && second < 0.8 ? "medium" : "low";
  return { along, lat: median(peak.map(x => x.lat)), lon: median(peak.map(x => x.lon)), halts: peak.length, window: w.length, second, atStop, edge, confidence };
}
