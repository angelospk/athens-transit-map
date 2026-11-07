// A long path ([lon, lat], a metro line's every 4 m: thousands of points) looked up many times a frame (each train,
// each frame): its distance along at each point and a grid of its stretches, made once per path (kept while the path
// array lives), so a lookup reads the few stretches near a place instead of the whole line. Pure; no map.

type P = [number, number];
const CELL = 100;   // metres a grid cell
const KY = 110540;

export interface PathIndex {
  /** Metres along the path at each of its points. */
  S: Float64Array;
  kx: number;
  lon0: number;
  lat0: number;
  grid: Map<number, number[]>;   // cell → the stretches in it (i: from point i-1 to point i)
}

const cache = new WeakMap<readonly P[], PathIndex>();
const cellKey = (x: number, y: number) => x * 65536 + y;

export function pathIndex(path: readonly P[]): PathIndex {
  let ix = cache.get(path);
  if (ix) return ix;
  const lon0 = path[0]?.[0] ?? 0, lat0 = path[0]?.[1] ?? 0, kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const S = new Float64Array(path.length), grid = new Map<number, number[]>();
  for (let i = 1; i < path.length; i++) {
    const ax = (path[i - 1][0] - lon0) * kx, ay = (path[i - 1][1] - lat0) * KY, bx = (path[i][0] - lon0) * kx, by = (path[i][1] - lat0) * KY;
    S[i] = S[i - 1] + Math.hypot(bx - ax, by - ay);
    const x0 = Math.floor(Math.min(ax, bx) / CELL), x1 = Math.floor(Math.max(ax, bx) / CELL);
    const y0 = Math.floor(Math.min(ay, by) / CELL), y1 = Math.floor(Math.max(ay, by) / CELL);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const k = cellKey(x, y);
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
    }
  }
  ix = { S, kx, lon0, lat0, grid };
  cache.set(path, ix);
  return ix;
}

/** The stretches (i: from point i-1 to point i) that may come within `r` metres of a place, in order, once each. */
export function stretchesNear(path: readonly P[], at: P, r: number): number[] {
  if (path.length < 2) return [];
  const ix = pathIndex(path), x = (at[0] - ix.lon0) * ix.kx, y = (at[1] - ix.lat0) * KY;
  const out = new Set<number>();
  for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
    for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++)
      for (const i of ix.grid.get(cellKey(cx, cy)) ?? []) out.add(i);
  return [...out].sort((a, b) => a - b);
}

/** The index of the path's point nearest a place: from the stretches near it (within 250 m, then 2 km), else all. */
export function nearestPoint(path: readonly P[], p: P): number {
  const k = Math.cos((p[1] * Math.PI) / 180);
  const d2 = (q: P) => ((q[0] - p[0]) * k) ** 2 + (q[1] - p[1]) ** 2;
  for (const r of [250, 2000]) {
    const near = stretchesNear(path, p, r);
    if (!near.length) continue;
    let best = Infinity, at = 0;
    for (const i of near) for (const j of [i - 1, i]) { const d = d2(path[j]); if (d < best) { best = d; at = j; } }
    // Found within r: no point outside the cells looked at can be nearer.
    if (Math.sqrt(best) * KY <= r) return at;
  }
  let best = Infinity, at = 0;
  path.forEach((q, i) => { const d = d2(q); if (d < best) { best = d; at = i; } });
  return at;
}

/** The index i with S[i-1] < v <= S[i] (the stretch that metres-along `v` falls on), 1 at least. */
export function stretchAt(S: Float64Array, v: number): number {
  let lo = 1, hi = S.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (S[mid] < v) lo = mid + 1; else hi = mid;
  }
  return lo;
}
