// How deep the metro runs, and which train runs it: for the 3D view, where an underground train is drawn in its
// tunnel under the street (scene3d.ts). Approximate, from the lines' layout, not a survey:
// - M2 is underground all the way (Anthoupoli to Elliniko), about 50 m down;
// - M3 is underground to Doukissis Plakentias, about 70 m down in the centre; past Chalandri it climbs (4 %) to
//   Doukissis Plakentias, about 25 m down, and on from the station's east end to the surface ~600 m further on, on the
//   way to the airport, where it runs on the ground;
// - M1 is on the surface, but for its stretch under the centre (Monastiraki, Omonia, Victoria), about 30 m. It comes up
//   between Monastiraki and Thiseio, and between Victoria and Attiki (whose M1 platforms are at the surface), each
//   ramp wholly between two stations, so no station stands on a slope halfway down.
// Near a portal the depth ramps (about 250 m), so a train climbs out rather than jumps. Pure: no map, no three.js.

// Where lines meet (Syntagma, Omonia, Attiki, Monastiraki) each runs at its own level, 20 m apart (its tunnels and
// stations well clear of the next), so no two meet: M1 the highest, well under the street, M2 below it, M3 deepest.
import { nearestPoint, pathIndex, stretchAt, stretchesNear } from "./pathIndex";

export const DEPTH: Record<string, number> = { M1: 30, M2: 50, M3: 70 };
const RAMP = 0.003;   // degrees (about 250 m here) over which a train climbs from its depth to the street
// M3's east end, by longitude (its line runs east there): the climb from Chalandri's east end to Doukissis
// Plakentias' west end, the depth at Doukissis Plakentias, and its ramp to the surface, from the station's east end
// to ~600 m past the station (the portal), so no platform stands on a slope.
const M3_CLIMB: [number, number] = [23.8220, 23.8328];
const M3_PLAKENTIAS = 25;
const M3_PORTAL: [number, number] = [23.8344, 23.8412];
/** East of this, M3 is on the airport branch (past Doukissis Plakentias): only the airport's trains run there. */
export const AIRPORT_BRANCH_LON = M3_PORTAL[0];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** How far down (metres, ≥ 0) a train of `line` runs at [lon, lat]; 0 on the surface (and for a tram). */
export function depthAt(line: string, lon: number, lat: number): number {
  const d = DEPTH[line];
  if (!d) return 0;
  if (line === "M2") return d;
  if (line === "M3") {
    if (lon <= M3_CLIMB[0]) return d;
    if (lon <= M3_CLIMB[1]) return d + (M3_PLAKENTIAS - d) * clamp01((lon - M3_CLIMB[0]) / (M3_CLIMB[1] - M3_CLIMB[0]));
    return M3_PLAKENTIAS * clamp01((M3_PORTAL[1] - lon) / (M3_PORTAL[1] - M3_PORTAL[0]));
  }
  // M1: under the centre, a box round Monastiraki, Omonia and Victoria; the depth ramps in from its edges (west of
  // Monastiraki toward Thiseio, north of Victoria toward Attiki), each ramp clear of the stations at its two ends.
  const inside = Math.min(lat - 37.970, 37.9985 - lat, lon - 23.7215, 23.7355 - lon);
  return d * clamp01(inside / RAMP);
}

export type Livery = "m1" | "m23" | "airport";
/** Which train: the green one of M1, the silver one with the green stripe of M2 and M3, or the airport's silver one
 *  with the orange band (an M3 run to the airport, or one seen on the airport branch: on its way back). */
export function liveryOf(line: string, headsign = "", lon?: number): Livery {
  if (line === "M1") return "m1";
  if (line === "M3" && (/αεροδρ[οό]μιο|airport/i.test(headsign) || (lon != null && lon > AIRPORT_BRANCH_LON))) return "airport";
  return "m23";
}

/** Each direction of a metro line on its own track: the trains run on the right of the line's centre (TRACK_GAP / 2
 *  each side), so two trains passing are never on the same rails. A point `side` metres to the right of a heading. */
export const TRACK_GAP = 4.4;

// Most stations have a platform each side of the two tracks; Monastiraki (M3) has one platform between them, so there
// its tracks part, the tunnels each side of the platform. The gap between the tracks' centres (metres) at a place: the
// usual one, widening to ISLAND_GAP within 120 m of an island station (over the 140 m before).
export const ISLANDS: { name: string; line: string; at: [number, number] }[] = [{ name: "ΜΟΝΑΣΤΗΡΑΚΙ", line: "M3", at: [23.725743, 37.976743] }];   // on M3's line (its marker is M1's)
export const ISLAND_GAP = 11;
export function trackGapAt(lon: number, lat: number, line: string): number {
  let gap = TRACK_GAP;
  for (const { at, line: l } of ISLANDS) {
    if (l !== line) continue;
    const d = Math.hypot((lon - at[0]) * 111320 * Math.cos((lat * Math.PI) / 180), (lat - at[1]) * 110540);
    gap = Math.max(gap, TRACK_GAP + (ISLAND_GAP - TRACK_GAP) * clamp01((260 - d) / 140));
  }
  return gap;
}
export function rightOf(pos: [number, number], heading: number, side = TRACK_GAP / 2): [number, number] {
  const r = ((heading + 90) * Math.PI) / 180, kx = 111320 * Math.cos((pos[1] * Math.PI) / 180);
  return [pos[0] + (Math.sin(r) * side) / kx, pos[1] + (Math.cos(r) * side) / 110540];
}

/** The track a metro train covers, `len` metres of its line's centre path, set to its own track on the right, oldest
 *  point first and its front last. The timetable's place (`at`) is the train's middle (`ahead` metres behind its
 *  front), so at a station the whole train stands along the platform. Which way it runs: `forwardHint` (true: the way
 *  the path is drawn), else its heading. Its cars are laid along this (scene3d), so the train follows the rails' curve
 *  exactly, with no kink where a position jumped. Null when the train is not on the path (40 m). */
export function trackBehind(path: [number, number][], at: [number, number], heading: number | null, len = 130, line = "",
  forwardHint?: boolean, ahead = 0): [number, number][] | null {
  if (path.length < 2) return null;
  const kx = 111320 * Math.cos((at[1] * Math.PI) / 180), ky = 110540;
  const m = (p: [number, number]): [number, number] => [(p[0] - at[0]) * kx, (p[1] - at[1]) * ky];
  const dist = (p: [number, number], q: [number, number]) => Math.hypot((q[0] - p[0]) * kx, (q[1] - p[1]) * ky);
  const lerp = (p: [number, number], q: [number, number], t: number): [number, number] => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  // Its metres along and the stretches near the train from the path's index (made once per path), not the whole line
  // again each frame.
  const S = pathIndex(path).S;
  let best = Infinity, sP = 0, bi = 1;
  for (const i of stretchesNear(path, at, 40)) {
    const [ax, ay] = m(path[i - 1]), [bx, by] = m(path[i]), dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    if (!L2) continue;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)), d = Math.hypot(ax + dx * t, ay + dy * t);
    if (d < best) { best = d; bi = i; sP = S[i - 1] + (S[i] - S[i - 1]) * t; }
  }
  if (best > 40) return null;
  const a = path[bi - 1], b = path[bi];
  const bearing = (Math.atan2((b[0] - a[0]) * kx, (b[1] - a[1]) * ky) * 180) / Math.PI;
  const forward = forwardHint ?? (heading != null && Math.abs(((bearing - heading + 540) % 360) - 180) <= 90);
  const total = S[S.length - 1], dir = forward ? 1 : -1;
  const pointAt = (sv: number): [number, number] => {
    const v = Math.max(0, Math.min(total, sv)), i = stretchAt(S, v);
    return lerp(path[i - 1], path[i], (v - S[i - 1]) / Math.max(1e-9, S[i] - S[i - 1]));
  };
  // From its back to its front: the path's own points between them, and the two ends.
  const sFront = Math.max(0, Math.min(total, sP + dir * ahead)), sBack = Math.max(0, Math.min(total, sFront - dir * len));
  const run: [number, number][] = [pointAt(sBack)];
  const lo = Math.max(0, stretchAt(S, Math.min(sBack, sFront)) - 1), hi = Math.min(path.length - 1, stretchAt(S, Math.max(sBack, sFront)));
  for (let i = lo; i <= hi; i++) if (dir > 0 ? S[i] > sBack && S[i] < sFront : S[i] < sBack && S[i] > sFront) run.push(path[i]);
  if (dir < 0) run.splice(1, run.length - 1, ...run.slice(1).reverse());
  run.push(pointAt(sFront));
  if (run.length < 2 || dist(run[0], run[run.length - 1]) < 1) return null;
  // Each point to the right of the way it runs there (from its neighbours).
  return run.map((p, i) => {
    const q0 = run[Math.max(0, i - 1)], q1 = run[Math.min(run.length - 1, i + 1)];
    const dx = (q1[0] - q0[0]) * kx, dy = (q1[1] - q0[1]) * ky, L = Math.hypot(dx, dy) || 1, off = trackGapAt(p[0], p[1], line) / 2;
    return [p[0] + ((dy / L) * off) / kx, p[1] - ((dx / L) * off) / ky] as [number, number];
  });
}

/** The index of a path's point nearest a place (to tell which way along it a train runs, from its stations). */
export function nearestIndex(path: [number, number][], p: [number, number]): number {
  return nearestPoint(path, p);   // through the path's grid (pathIndex.ts): called for every train, every frame
}
/** The bearing (degrees from north) from one point to the next. */
export function bearingOf(a: [number, number], b: [number, number]): number {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return ((Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI + 360) % 360;
}

/** A line's path ([lon, lat]) with its stations straight: within each station's length (len, metres, centred where the
 *  path passes nearest the station) the path runs on the straight chord between the station's two ends, and eases back
 *  to its own curve over `ease` metres each side. So the track, the platforms and the trains lie straight along a
 *  station, as they are built, and the tunnels meet its ends. The path comes back every 4 m. */
export function straighten(path: [number, number][], stops: [number, number][], len = 120, ease = 50): [number, number][] {
  if (path.length < 2) return path;
  const kx = 111320 * Math.cos((path[0][1] * Math.PI) / 180), ky = 110540;
  const dist = (a: [number, number], b: [number, number]) => Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky);
  const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  // Every 4 m, with each point's distance along.
  const pts: [number, number][] = [path[0]], s: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    const L = dist(path[i - 1], path[i]), n = Math.max(1, Math.ceil(L / 4));
    for (let k = 1; k <= n; k++) { pts.push(lerp(path[i - 1], path[i], k / n)); s.push(s[s.length - 1] + L / n); }
  }
  const at = (d: number): [number, number] => {
    if (d <= 0) return pts[0];
    for (let i = 1; i < pts.length; i++) if (s[i] >= d) return lerp(pts[i - 1], pts[i], (d - s[i - 1]) / Math.max(1e-9, s[i] - s[i - 1]));
    return pts[pts.length - 1];
  };
  const out = pts.map(p => [...p] as [number, number]);
  for (const stop of stops) {
    let best = Infinity, s0 = 0;
    pts.forEach((p, i) => { const d = dist(p, stop); if (d < best) { best = d; s0 = s[i]; } });
    if (best > 150) continue;
    const a = at(s0 - len / 2), b = at(s0 + len / 2);
    pts.forEach((p, i) => {
      const lo = s0 - len / 2, hi = s0 + len / 2;
      if (s[i] < lo - ease || s[i] > hi + ease) return;
      const target = lerp(a, b, clamp01((s[i] - lo) / len));
      const out_ = s[i] < lo ? (lo - s[i]) / ease : s[i] > hi ? (s[i] - hi) / ease : 0;
      const w = 1 - out_ * out_ * (3 - 2 * out_);   // smooth: all the way in the station, none `ease` metres out
      out[i] = lerp(p, target, w);
    });
  }
  return out;
}

/** A metro line's own stations, one per place: a station whose first line is a metro one (a tram stop lists the metro
 *  lines it meets after its own: «Σύνταγμα (Κέντρο)» of the T6 is no M2 station), and none within 150 m of one taken
 *  already («Σύνδεση Προαστιακού» is Doukissis Plakentias). */
export function metroStops<S extends { name: string; lon: number; lat: number; lines: string[] }>(stations: S[], line: string): S[] {
  const out: S[] = [];
  for (const st of stations) {
    if (!st.lines.includes(line) || !st.lines[0]?.startsWith("M")) continue;
    const k = 111320 * Math.cos((st.lat * Math.PI) / 180);
    if (out.some(o => Math.hypot((o.lon - st.lon) * k, (o.lat - st.lat) * 110540) < 150)) continue;
    out.push(st);
  }
  return out;
}
