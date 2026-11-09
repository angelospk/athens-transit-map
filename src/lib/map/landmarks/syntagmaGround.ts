// The ground of Σύνταγμα: the square lies under Αμαλίας (DEPTH at its east side, where the marble steps and the
// metro's entrances are in the wall under the street); the map's streets are all at 0, so here the square slopes
// from 0 at its west edge (Ερμού, as the streets round it) down to -DEPTH, flat for its last FLAT metres before the
// wall. A strip WALL_IN wide along Αμαλίας stays at the street's level: the terrace over the wall.
// Pure (no three.js): scene3d asks it where the trees stand; the model (syntagma.ts) is built on it.

import type { LngLat } from "../../map3d";
import { ANCHOR_LL, LAWNS, PLAZA } from "./syntagmaData";

export const DEPTH = 4.2;   // 28 steps of 15 cm up to Αμαλίας (the photographs: the wall about 2.4 people high)
export const WALL_IN = 10.5;
export const FLAT = 24;

export type M2 = [number, number];
const KX = 111320 * Math.cos((ANCHOR_LL[1] * Math.PI) / 180), KY = 111320;
/** Metres east and north of the anchor (as scene3d's local metres, near enough here). */
export const metres = (p: LngLat): M2 => [(p[0] - ANCHOR_LL[0]) * KX, (p[1] - ANCHOR_LL[1]) * KY];

const ring = (r: LngLat[]) => {
  const m = r.map(metres);
  return m.length > 1 && m[0][0] === m[m.length - 1][0] && m[0][1] === m[m.length - 1][1] ? m.slice(0, -1) : m;
};
export const PLAZA_M = ring(PLAZA);
const LAWNS_M = LAWNS.map(ring);
/** On one of the square's lawns: the model plants them itself, so scene3d leaves its own trees off them. */
export const onLawn = (p: LngLat) => { const q = metres(p); return LAWNS_M.some(r => insideM(q, r)); };

// The square's east edge (along Αμαλίας): the longest of its edges facing east.
const frame = (() => {
  let best = -Infinity, E1: M2 = [0, 0], E2: M2 = [0, 1];
  for (let i = 0; i < PLAZA_M.length; i++) {
    const a = PLAZA_M[i], b = PLAZA_M[(i + 1) % PLAZA_M.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 30) continue;
    const mx = (a[0] + b[0]) / 2;
    if (mx > best) { best = mx; [E1, E2] = a[1] < b[1] ? [a, b] : [b, a]; }
  }
  const L = Math.hypot(E2[0] - E1[0], E2[1] - E1[1]), e: M2 = [(E2[0] - E1[0]) / L, (E2[1] - E1[1]) / L];
  const o: M2 = e[1] >= 0 ? [e[1], -e[0]] : [-e[1], e[0]];   // east of the edge
  return { E1, e, o };
})();
export const E = frame.e, O = frame.o, E1 = frame.E1;
/** How far east of the square's east edge (negative: in the square), and how far along it (north). */
export const sOf = (q: M2) => (q[0] - E1[0]) * O[0] + (q[1] - E1[1]) * O[1];
export const tOf = (q: M2) => (q[0] - E1[0]) * E[0] + (q[1] - E1[1]) * E[1];
/** The point `t` along the edge's line and `s` east of it. */
export const at = (t: number, s: number): M2 => [E1[0] + E[0] * t + O[0] * s, E1[1] + E[1] * t + O[1] * s];

export const S_WALL = -WALL_IN;
export const S_WEST = Math.min(...PLAZA_M.map(sOf));
export const S_FLAT = S_WALL - FLAT;

export function insideM(p: M2, r: M2[]) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** The square's floor at `s`, the terrace aside: what the floor's points on the wall's line take (at the wall's foot,
 *  not on its top). */
export const floorIn = (s: number) => -DEPTH * Math.max(0, Math.min(1, (s - S_WEST) / (S_FLAT - S_WEST)));
/** The square's floor at `s` (inside the square; 0 from the wall's line east). */
export const floorS = (s: number) => (s >= S_WALL ? 0 : floorIn(s));
/** The square's ground at a point (metres from the anchor): 0 outside it and on the terrace, else below 0. (Not for a
 *  point on its edge: inside or not is a toss-up there. The model takes floorS.) */
export function groundM(q: M2): number {
  const s = sOf(q);
  if (s >= S_WALL || !insideM(q, PLAZA_M)) return 0;
  return floorS(s);
}
/** The same at [lon, lat]. */
export const groundAt = (p: LngLat) => groundM(metres(p));

/** The part of a ring on one side of a line s = c (keep: s <= c when `below`). Sutherland-Hodgman. */
export function clipS(r: M2[], c: number, below: boolean): M2[] {
  const inn = (q: M2) => (below ? sOf(q) <= c : sOf(q) >= c);
  const out: M2[] = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], ia = inn(a), ib = inn(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const sa = sOf(a), sb = sOf(b), k = (c - sa) / (sb - sa);
      out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
    }
  }
  return out;
}

// The metro's entrances in the wall under Αμαλίας, either side of the great steps (Google's 3D view): where the model
// (syntagma.ts) has its steps, 12 m wide between the balustrades, an entrance 12 m out from the steps' middle on each
// side, its stairwell going east into the wall from the square's floor. [lon, lat], heading clockwise from north.
export function wallEntrances(): { at: LngLat; heading: number; elevation: number }[] {
  const wall = PLAZA_M.filter(q => Math.abs(sOf(q) - S_WALL) < 0.05).map(tOf);
  const inner = clipS(PLAZA_M, S_WALL, true).filter(q => Math.abs(sOf(q) - S_WALL) < 0.05).map(tOf);
  const ts = wall.length >= 2 ? wall : inner;
  const tA = Math.min(...ts), tB = Math.max(...ts), tS = tA + 0.5 * (tB - tA);
  const heading = ((Math.atan2(O[0], O[1]) * 180) / Math.PI + 360) % 360;
  return [-1, 1].map(side => {
    const q = at(tS + side * 12, S_WALL - 0.3);
    return { at: [ANCHOR_LL[0] + q[0] / KX, ANCHOR_LL[1] + q[1] / KY] as LngLat, heading, elevation: -DEPTH };
  });
}
