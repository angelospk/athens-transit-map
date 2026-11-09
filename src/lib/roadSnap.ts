// Roads for the 3D mode: an index of the carriageways of Athens (athensRoads.ts), to put the drawn bus routes on
// their road and to keep trees and lamp posts off the carriageway. Pure geometry in local metres around a reference
// latitude; [lon, lat] in and out.

export type LngLat = [number, number];
// half: half the carriageway's width, metres; oneway: traffic goes only the way the coordinates run; bus: where a bus
// drives, metres right of the centreline in its direction of travel (the middle of its lane; 0 or none: on it).
// marks: its painted lines ([type, line]), cut and drawn once every road of the tile is known (athensRoads.decode).
export interface Road { coords: LngLat[]; half: number; oneway?: boolean; bus?: number; len?: number; pave?: number; kind?: number;
  marks?: [number, LngLat[]][] }
interface Seg { ax: number; ay: number; bx: number; by: number; road: number; half: number; oneway: boolean; bus: number; s0: number }
// s: metres along the road's centreline (from its first point) where the hit is.
export interface Hit { x: number; y: number; d: number; road: number; half: number; nx: number; ny: number; tx: number; ty: number; bus: number; s: number }
export interface Cand extends Hit { score: number }

const CELL = 40;   // metres per grid cell
const KERB_GAP = 1.95;   // a lane's centre at least this far in from the kerb: half the painted route, and 20 cm
const LANE_W = 3.5;   // a traffic lane's width, metres

// A bus that turns gets into the lane it turns from before the junction (the left one for a left turn, its right one
// for a right turn), and back to its own on the next road: how far over to it (0 to 1) at this place, from its
// heading along its route (degrees clockwise from north at s metres from here; null past the route's ends). A turn is
// a bend of TURN_DEG or more within BEND_M; over to its lane fully from TURN_IN metres before it, starting TURN_FROM
// before; back over TURN_OUT after. The nearest turn decides.
const TURN_DEG = 50, BEND_M = 30, TURN_FROM = 100, TURN_IN = 50, TURN_OUT = 30;
export function turnBlend(headingAt: (s: number) => number | null): { left: number; right: number } {
  const bend = (d: number) => {
    const a = headingAt(d - BEND_M / 2), b = headingAt(d + BEND_M / 2);
    return a == null || b == null ? 0 : ((b - a + 540) % 360) - 180;   // + right, - left
  };
  for (let d = -TURN_OUT; d <= TURN_FROM; d += 5) {
    const turn = bend(d);
    if (Math.abs(turn) < TURN_DEG) continue;
    // Where the bend begins, to a few centimetres (not to the 5 m step: as the bus drives up to it, how far over it is
    // grows smoothly, not in steps of a metre).
    let lo = d - 5, hi = d;
    if (Math.abs(bend(lo)) >= TURN_DEG) lo = hi;
    else for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (Math.abs(bend(m)) >= TURN_DEG) hi = m; else lo = m; }
    const at = hi + BEND_M / 2;   // about where the bend is
    const k = at < 0 ? Math.max(0, 1 + at / TURN_OUT) : at <= TURN_IN ? 1 : Math.max(0, (TURN_FROM - at) / (TURN_FROM - TURN_IN));
    const e = k * k * (3 - 2 * k);   // eased: it starts over and settles in gently
    return turn < 0 ? { left: e, right: 0 } : { left: 0, right: e };
  }
  return { left: 0, right: 0 };
}
export const leftBlend = (headingAt: (s: number) => number | null) => turnBlend(headingAt).left;

const vkey = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;

export class RoadIndex {
  readonly kx: number;
  readonly ky = 110540;
  private grid = new Map<string, Seg[]>();
  readonly size: number;
  // Where the roads meet: OSM ways that share a node have that point in common, to the bit.
  private verts = new Map<string, { road: number; s: number }[]>();
  private keys: string[][] = [];   // each road's points, as `verts` keys
  private len: number[] = [];
  private oneway: boolean[] = [];
  private shared = new Map<number, [number, number][]>();   // road pair → [s on the first, s on the second] where they meet
  private nbrs = new Map<number, number[]>();

  constructor(roads: Road[], readonly lon0: number, readonly lat0: number) {
    this.kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
    let n = 0;
    roads.forEach((r, i) => {
      let s = 0;
      const keys: string[] = [];
      for (let k = 0; k < r.coords.length; k++) {
        const [bx, by] = this.m(r.coords[k]);
        if (k > 0) {
          const [ax, ay] = this.m(r.coords[k - 1]);
          const L = Math.hypot(bx - ax, by - ay);
          if (L > 0) {
            const sg: Seg = { ax, ay, bx, by, road: i, half: r.half, oneway: !!r.oneway, bus: r.bus ?? 0, s0: s };
            const x0 = Math.floor(Math.min(ax, bx) / CELL), x1 = Math.floor(Math.max(ax, bx) / CELL);
            const y0 = Math.floor(Math.min(ay, by) / CELL), y1 = Math.floor(Math.max(ay, by) / CELL);
            for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
              const key = `${x},${y}`;
              (this.grid.get(key) ?? this.grid.set(key, []).get(key)!).push(sg);
            }
            n++;
            s += L;
          }
        }
        const key = vkey(bx, by);
        keys.push(key);
        (this.verts.get(key) ?? this.verts.set(key, []).get(key)!).push({ road: i, s });
      }
      this.keys.push(keys);
      this.len.push(s);
      this.oneway.push(!!r.oneway);
    });
    this.size = n;
  }

  /** Metres east and north of the reference point. */
  m([lon, lat]: LngLat): [number, number] { return [(lon - this.lon0) * this.kx, (lat - this.lat0) * this.ky]; }
  ll(x: number, y: number): LngLat { return [this.lon0 + x / this.kx, this.lat0 + y / this.ky]; }

  // Every segment within `max` metres of p, with the hit on it and its score (see `nearest`).
  private scan(p: LngLat, max: number, only: number | undefined, dir: [number, number] | undefined, each: (h: Cand) => void) {
    const [px, py] = this.m(p);
    const r = Math.ceil(max / CELL), cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
    const seen = new Set<Seg>();
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) {
      for (const s of this.grid.get(`${x},${y}`) ?? []) {
        if (seen.has(s) || (only != null && s.road !== only)) continue;
        seen.add(s);
        const dx = s.bx - s.ax, dy = s.by - s.ay, L2 = dx * dx + dy * dy;
        const t = Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / L2));
        const qx = s.ax + dx * t, qy = s.ay + dy * t, d = Math.hypot(px - qx, py - qy);
        if (d > max) continue;
        const L = Math.sqrt(L2);
        let score = d;
        if (dir) {
          const dot = (dx / L) * dir[0] + (dy / L) * dir[1];
          if (s.oneway && dot < -0.2) continue;   // the other carriageway
          if (Math.abs(dot) < 0.5) score += 12;     // a cross street
        }
        // The unit normal pointing to p's side of the centreline (left of travel when p is on it).
        const side = (dx * (py - s.ay) - dy * (px - s.ax)) >= 0 ? 1 : -1;
        each({ x: qx, y: qy, d, road: s.road, half: s.half, nx: (-dy / L) * side, ny: (dx / L) * side, tx: dx / L, ty: dy / L,
          bus: s.bus, s: s.s0 + t * L, score });
      }
    }
  }

  /** The nearest centreline within `max` metres (optionally only on one road), or null. With a direction of travel
   *  (a unit vector, metres east and north): a one-way road against it is never taken, and a road across it only when
   *  nothing along it is within 12 m more, so a route keeps to the carriageway it drives on. */
  nearest(p: LngLat, max: number, only?: number, dir?: [number, number]): Hit | null {
    let best: Cand | null = null;
    this.scan(p, max, only, dir, h => { if (!best || h.score < best.score) best = h; });
    return best;
  }

  /** The best hit on each road within `max` metres, best first, at most `k`. */
  candidates(p: LngLat, max: number, dir?: [number, number], k = 8): Cand[] {
    const by = new Map<number, Cand>();
    this.scan(p, max, undefined, dir, h => { const o = by.get(h.road); if (!o || h.score < o.score) by.set(h.road, h); });
    return [...by.values()].sort((a, b) => a.score - b.score).slice(0, k);
  }

  /** Where a bus on this hit drives: moved `bus` metres to the right of its way of travel (`dir`, else the way the
   *  road's coordinates run), into the middle of its lane; never closer than KERB_GAP to the kerb, so the painted
   *  route (3.5 m with its white edges) and the bus model stay on the asphalt of an outside lane. */
  /** The lanes its way (one or more), their centres in metres right of the centreline, the rightmost first: the
   *  rightmost where its buses drive (`bus`, kept KERB_GAP from the kerb), the leftmost the inner one of its side of a
   *  two-way road, or by the far kerb of a one-way road. */
  lanes(h: Hit): number[] {
    const right = Math.sign(h.bus) * Math.min(Math.abs(h.bus), Math.max(0, h.half - KERB_GAP));
    const one = this.oneway[h.road], room = one ? 2 * h.half : h.half;
    const n = Math.max(1, Math.floor((room + 0.5) / LANE_W));
    if (n < 2) return [right];
    const left = one ? -Math.max(0, h.half - KERB_GAP) : Math.min(right, LANE_W / 2);
    return Array.from({ length: n }, (_, k) => right + ((left - right) * k) / (n - 1));
  }

  /** Where a bus on this hit drives: in one of the lanes its way (lanes), moved that far right of its way of travel
   *  (`dir`, else the way the road's coordinates run). `inner`: lanes in from the right (0 the rightmost, fractions
   *  between lanes while it changes); `left` (0 to 1): a left turn coming (turnBlend), over to the leftmost that much. */
  lane(h: Hit, dir?: [number, number], left = 0, inner = 0): Hit {
    if (!h.bus) return h;
    const ls = this.lanes(h), k = Math.max(0, Math.min(ls.length - 1, inner)), i = Math.floor(k);
    let off = ls[i] + ((ls[Math.min(ls.length - 1, i + 1)] - ls[i]) * (k - i));
    off += (ls[ls.length - 1] - off) * Math.max(0, Math.min(1, left));
    const s = dir && h.tx * dir[0] + h.ty * dir[1] < 0 ? -1 : 1;
    return { ...h, x: h.x + s * h.ty * off, y: h.y - s * h.tx * off };
  }

  /** Beside the nearest road, on the point's own side of it: `out` metres past its kerb, and the road's direction
   *  there (radians from east, counter-clockwise). For street furniture (a bus stop's pole and shelter); null with no
   *  road within `max` metres, or when that place is on another road. */
  kerb(p: LngLat, out: number, max = 25): { at: LngLat; angle: number } | null {
    const h = this.nearest(p, max);
    if (!h) return null;
    const px = (p[0] - this.lon0) * this.kx, py = (p[1] - this.lat0) * this.ky;
    const side = (px - h.x) * h.nx + (py - h.y) * h.ny < 0 ? -1 : 1;
    const at = this.ll(h.x + side * h.nx * (h.half + out), h.y + side * h.ny * (h.half + out));
    const other = this.onRoad(at, 0);
    if (other && other.road !== h.road) return null;
    return { at, angle: Math.atan2(h.ty, h.tx) };
  }

  /** Is the point on a carriageway (within its half width, plus a margin)? */
  onRoad(p: LngLat, margin = 0.5): Hit | null {
    const h = this.nearest(p, 16);
    return h && h.d < h.half + margin ? h : null;
  }

  /** Off the carriageway: unchanged when on none; else moved out to the pavement, `out` metres past the kerb, or
   *  null when that lands on another road. */
  offRoad(p: LngLat, out = 1.8): LngLat | null {
    const h = this.onRoad(p);
    if (!h) return p;
    const q = this.ll(h.x + h.nx * (h.half + out), h.y + h.ny * (h.half + out));
    return this.onRoad(q) ? null : q;
  }

  /** The way a hit's road is driven, given the direction of travel: +1 the way its coordinates run, -1 against. */
  sense(h: Hit, dir?: [number, number]): 1 | -1 {
    if (this.oneway[h.road] || !dir) return 1;
    return h.tx * dir[0] + h.ty * dir[1] < 0 ? -1 : 1;
  }

  /** How far a vehicle drives on the road network from hit a (driving its road the way `sa`) to hit b (the way `sb`):
   *  along a's road to a point it shares with b's, then on along b's; or through one short road between them.
   *  Infinity when the two do not connect that way (a fork taken and left backwards, a bridge over a street). */
  drive(a: Hit, sa: number, b: Hit, sb: number, slack = 3): number {
    let best = Infinity;
    const leg = (n: number, s: number, sense: number) => (n - s) * sense;   // metres ahead to n
    for (const [na, nb] of this.meet(a.road, b.road)) {
      const da = leg(na, a.s, sa), db = -leg(nb, b.s, sb);
      if (da >= -slack && db >= -slack) best = Math.min(best, Math.max(0, da) + Math.max(0, db));
    }
    if (best < Infinity) return best;
    // Through a short link (a junction's own little way, a slip of a few metres).
    const nb = new Set(this.near(b.road));
    for (const c of this.near(a.road)) {
      if (c === b.road || !nb.has(c) || this.len[c] > 40) continue;
      for (const [na, nc1] of this.meet(a.road, c)) {
        const da = leg(na, a.s, sa);
        if (da < -slack) continue;
        for (const [nc2, nbb] of this.meet(c, b.road)) {
          const db = -leg(nbb, b.s, sb), dc = nc2 - nc1;
          if (db < -slack || (this.oneway[c] && dc < 0)) continue;
          best = Math.min(best, Math.max(0, da) + Math.abs(dc) + Math.max(0, db));
        }
      }
    }
    return best;
  }

  // The points two roads share: [s on a, s on b].
  private meet(a: number, b: number): [number, number][] {
    const key = a * 100003 + b;
    let r = this.shared.get(key);
    if (!r) {
      r = [];
      for (const k of this.keys[a]) {
        const at = this.verts.get(k)!;
        const sa = at.find(v => v.road === a)!.s;
        for (const v of at) if (v.road === b) r.push([sa, v.s]);
      }
      this.shared.set(key, r);
    }
    return r;
  }

  // The roads that share a point with this one.
  private near(a: number): number[] {
    let r = this.nbrs.get(a);
    if (!r) {
      const set = new Set<number>();
      for (const k of this.keys[a]) for (const v of this.verts.get(k)!) if (v.road !== a) set.add(v.road);
      r = [...set];
      this.nbrs.set(a, r);
    }
    return r;
  }
}

const SWITCH = 3;    // cost of going from one road onto the next one it joins
const JUMP = 100;    // ... onto a road it does not join (or joins only behind): only where the data has no link
const OFF = 8;       // ... off the roads, or back on
const BACK = 1;      // per metre driven backwards along the same road, past a little slack

/** A route on its roads: points every `step` metres along it, matched to the road network as a whole (the best
 *  sequence of carriageways near the points, where the route only moves from a road onto one it joins in the way it
 *  drives), then put in the middle of their lane (RoadIndex.lane). Where it turns from one road to another it goes
 *  through the corner where the two meet, dropping the points that cut it (OASA's shapes are sparse: a point every
 *  ~100 m, straight lines between). Points with no road within `max` metres stay where they are. */
export function snapLine(line: LngLat[], idx: RoadIndex, max = 25, step = 6, cornerMax = 70): LngLat[] {
  if (line.length < 2 || !idx.size) return line;
  const dense: LngLat[] = [];
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = idx.m(line[i - 1]), [bx, by] = idx.m(line[i]);
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k < n; k++) dense.push(idx.ll(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n));
  }
  dense.push(line[line.length - 1]);
  // The direction of travel at each dense point: along the source line, over ~36 m.
  const dirs = dense.map((_, i) => {
    const [ax, ay] = idx.m(dense[Math.max(0, i - 3)]), [bx, by] = idx.m(dense[Math.min(dense.length - 1, i + 3)]);
    const L = Math.hypot(bx - ax, by - ay);
    return L ? ([(bx - ax) / L, (by - ay) / L] as [number, number]) : undefined;
  });

  // Viterbi over the candidate roads of each point, plus "off the roads" (null, costing `max`) where no road is within
  // `offMin` metres. A point with no road within `max` (a corner the source line cuts wide) still gets the roads within
  // `reach`, so the matched route goes round by the roads it can drive rather than hopping, through a step off them,
  // between roads that do not join; such far points are drawn as they are (below).
  const offMin = 15, reach = 60;
  const cands: (Cand | null)[][] = dense.map((p, i) => {
    let cs: (Cand | null)[] = idx.candidates(p, max, dirs[i]);
    if (!cs.length) cs = idx.candidates(p, reach, dirs[i]);
    if (!cs.length || cs.every(c => c!.d >= offMin)) cs.push(null);
    return cs;
  });
  const cost: number[][] = [], from: number[][] = [];
  cands.forEach((cs, i) => {
    cost.push(cs.map(c => (c ? c.score : max)));
    from.push(cs.map(() => -1));
    if (!i) return;
    const prev = cands[i - 1], pc = cost[i - 1];
    cs.forEach((b, j) => {
      let best = Infinity, arg = 0;
      prev.forEach((a, k) => {
        if (pc[k] >= best) return;
        const c = pc[k] + move(idx, a, dirs[i - 1], b, dirs[i]);
        if (c < best) { best = c; arg = k; }
      });
      cost[i][j] += best;
      from[i][j] = arg;
    });
  });
  const last = cost.length - 1;
  let j = cost[last].indexOf(Math.min(...cost[last]));
  const chosen: (Hit | null)[] = new Array(dense.length);
  // Its heading at each dense point (about `step` apart), for the left turns ahead (leftBlend).
  const hdg = dirs.map(d => (d ? (Math.atan2(d[0], d[1]) * 180) / Math.PI : null));
  const at = (i: number) => (k: number) => { const n = i + Math.round(k / step); return n < 0 || n >= hdg.length ? null : hdg[n]; };
  for (let i = last; i >= 0; i--) {
    const c = cands[i][j];
    chosen[i] = c ? idx.lane(c, dirs[i], leftBlend(at(i))) : null;
    j = from[i][j];
  }

  const out: LngLat[] = [];
  const push = (q: LngLat) => { const l = out[out.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) out.push(q); };
  let prev: Hit | null = null, prevDir: [number, number] | undefined, gap: LngLat[] = [];
  dense.forEach((p, i) => {
    const h = chosen[i] && chosen[i]!.d <= max ? chosen[i] : null, dir = dirs[i];
    if (!h) {
      gap.push(p);
      if (gap.length * step >= cornerMax) prev = null;   // a long stretch off the roads: no corner is cut across it
      return;
    }
    if (prev && h.road !== prev.road) {
      const c = corner(prev, prevDir, h, dir);
      if (c && Math.hypot(c[0] - prev.x, c[1] - prev.y) < cornerMax && Math.hypot(c[0] - h.x, c[1] - h.y) < cornerMax) {
        gap = [];                       // the corner replaces the points that cut it
        push(idx.ll(c[0], c[1]));
      }
    } else if (prev && gap.length * step < cornerMax) gap = [];   // a short stray off the same road
    for (const g of gap) push(g);
    gap = [];
    push(idx.ll(h.x, h.y));
    prev = h;
    prevDir = dir;
  });
  for (const g of gap) push(g);
  return settle(out, idx);
}

// The cost of the route going from candidate a (at one dense point) to b (at the next).
function move(idx: RoadIndex, a: Cand | null, da: [number, number] | undefined, b: Cand | null, db: [number, number] | undefined): number {
  if (!a || !b) return a === b ? 0 : OFF;
  const sa = idx.sense(a, da), sb = idx.sense(b, db);
  if (a.road === b.road) {
    if (sa !== sb) return JUMP;   // turned round on a two-way street
    const ahead = (b.s - a.s) * sa;
    return ahead < -2 ? (-2 - ahead) * BACK : 0;
  }
  const net = idx.drive(a, sa, b, sb);
  if (net === Infinity) return JUMP;
  // A detour the source line does not make (driven much further than the two points are apart) costs its extra metres.
  const straight = Math.hypot(b.x - a.x, b.y - a.y);
  return SWITCH + Math.max(0, net - 1.5 * straight - 6) * 0.5;
}

// A light moving average (two points each side) over the snapped line, first spaced evenly every 5 m so the
// average spans the same ±10 m everywhere: what is left of a jump between near roads is evened out, and a corner is
// rounded by a few metres, not cut. Ends kept.
function settle(pts: LngLat[], idx: RoadIndex, step = 5): LngLat[] {
  if (pts.length < 3) return pts;
  const m = pts.map(p => idx.m(p));
  const even: [number, number][] = [m[0]];
  let carry = 0;
  for (let i = 1; i < m.length; i++) {
    const [ax, ay] = m[i - 1], [bx, by] = m[i], L = Math.hypot(bx - ax, by - ay);
    let t = step - carry;
    for (; t < L; t += step) even.push([ax + ((bx - ax) * t) / L, ay + ((by - ay) * t) / L]);
    carry = L - (t - step);
  }
  even.push(m[m.length - 1]);
  if (even.length < 5) return pts;
  return even.map((p, i) => {
    if (i < 2 || i > even.length - 3) return idx.ll(p[0], p[1]);
    let x = 0, y = 0;
    for (let k = -2; k <= 2; k++) { x += even[i + k][0]; y += even[i + k][1]; }
    return idx.ll(x / 5, y / 5);
  });
}

// Where the lines of two road segments meet, when that is ahead of the first hit and before the second in the
// direction of travel (null when they run parallel, or meet behind: no corner to go through then).
function corner(a: Hit, da: [number, number] | undefined, b: Hit, db: [number, number] | undefined): [number, number] | null {
  const den = a.tx * b.ty - a.ty * b.tx;
  if (Math.abs(den) < 0.2) return null;   // under ~12°: no real corner
  const t = ((b.x - a.x) * b.ty - (b.y - a.y) * b.tx) / den;
  const cx = a.x + a.tx * t, cy = a.y + a.ty * t;
  const fa = da ? Math.sign(a.tx * da[0] + a.ty * da[1]) || 1 : 1;
  const fb = db ? Math.sign(b.tx * db[0] + b.ty * db[1]) || 1 : 1;
  if (t * fa < -2) return null;                                          // behind a
  if (((b.x - cx) * b.tx + (b.y - cy) * b.ty) * fb < -2) return null;    // past b
  return [cx, cy];
}

/** A snapped route (snapLine), for putting its vehicles on it: they then drive exactly where it is painted, through
 *  the same forks, rather than onto whichever road is nearest each frame. Places on it are `s`, metres from its start. */
export class Track {
  private pts: [number, number][];
  private cum: number[] = [0];                  // s at each point
  private grid = new Map<string, number[]>();   // segment i runs from pts[i] to pts[i + 1]

  constructor(line: LngLat[], private readonly idx: RoadIndex) {
    this.pts = line.map(p => idx.m(p));
    for (let i = 0; i + 1 < this.pts.length; i++) {
      const [ax, ay] = this.pts[i], [bx, by] = this.pts[i + 1];
      this.cum.push(this.cum[i] + Math.hypot(bx - ax, by - ay));
      const x0 = Math.floor(Math.min(ax, bx) / CELL), x1 = Math.floor(Math.max(ax, bx) / CELL);
      const y0 = Math.floor(Math.min(ay, by) / CELL), y1 = Math.floor(Math.max(ay, by) / CELL);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`;
        (this.grid.get(key) ?? this.grid.set(key, []).get(key)!).push(i);
      }
    }
  }

  get length() { return this.cum[this.cum.length - 1]; }

  /** The nearest point of the route within `max` metres, on a stretch that runs the way of `dir` (when given), and
   *  within `near` ([from, to] in s) when given; with its s and how far p is from it; or null. */
  at(p: LngLat, max: number, dir?: [number, number], near?: [number, number]): { s: number; d: number } | null {
    const [px, py] = this.idx.m(p);
    const r = Math.ceil(max / CELL), cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
    let best: { s: number; d: number } | null = null;
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) {
      for (const i of this.grid.get(`${x},${y}`) ?? []) {
        if (near && (this.cum[i + 1] < near[0] || this.cum[i] > near[1])) continue;
        const [ax, ay] = this.pts[i], [bx, by] = this.pts[i + 1];
        const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
        if (!L) continue;
        if (dir && (dx * dir[0] + dy * dir[1]) / L < 0.3) continue;   // the other way (or across): not this stretch
        const lo = near ? Math.max(0, (near[0] - this.cum[i]) / L) : 0, hi = near ? Math.min(1, (near[1] - this.cum[i]) / L) : 1;
        const t = Math.max(lo, Math.min(hi, ((px - ax) * dx + (py - ay) * dy) / (L * L)));
        const d = Math.hypot(px - ax - dx * t, py - ay - dy * t);
        if (d <= max && (!best || d < best.d)) best = { s: this.cum[i] + t * L, d };
      }
    }
    return best;
  }

  /** The point at s, metres east and north. */
  point(s: number): [number, number] {
    const c = this.cum, n = c.length;
    if (s <= 0) return this.pts[0];
    if (s >= c[n - 1]) return this.pts[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] <= s) lo = mid; else hi = mid; }
    const t = (s - c[lo]) / (c[hi] - c[lo] || 1), [ax, ay] = this.pts[lo], [bx, by] = this.pts[hi];
    return [ax + (bx - ax) * t, ay + (by - ay) * t];
  }

  /** A vehicle at s: there on the route, turned as a bus turns, along the line from its rear axle (`axle` metres
   *  back along the route) to its front axle (`axle` metres on). Through a bend that turns it gradually, and never
   *  by more than the route itself turns. Heading in degrees clockwise from north. */
  pose(s: number, axle = 4): { pos: LngLat; heading: number } {
    const [x, y] = this.point(s), [rx, ry] = this.point(s - axle), [fx, fy] = this.point(s + axle);
    return { pos: this.idx.ll(x, y), heading: ((Math.atan2(fx - rx, fy - ry) * 180) / Math.PI + 360) % 360 };
  }
}
