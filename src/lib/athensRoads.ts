// The streets of Athens for the 3D mode, from OpenStreetMap (scripts/roads.py): real carriageway and pavement widths,
// lane lines, centre lines, bus-lane lines and zebra crossings, at full detail. One file for the whole area, made
// into map features once; nothing here depends on the map's zoom, so the streets keep their shape as it changes.
import type { LngLat, Road } from "./roadSnap";

type Pts = number[];   // [dx, dy, dx, dy, ...] in `unit` degrees: the first from `origin`, each next from the one before
type RawRoad = [kind: number, widthDm: number, paveDm: number, oneway: number, busDm: number, pts: Pts, marks: [number, Pts][],
  level?: number, ends?: number];
/** t (scripts/roads.py, from OSM turn:lanes): a lane's turn arrow, [dx, dy, its way (0.1 deg, counter-clockwise from
 *  east, the way it is driven), the turns (TURN bits), level]. */
/** c (scripts/roads.py add_context): the next tiles' roads that come within 60 m of this one, looked at (a junction or
 *  a change of width on the edge) but drawn by their own tile; b: this tile's box [west, south, east, north]. */
/** j, k, i, o, w (scripts/junctions.py): each junction's surface worked out with polygons ([own, ring, hole, ...]: own
 *  1 if this tile draws it), its kerbs, its islands, roundabouts' lane lines [dx, dy, R cm, half cm], and the pavement
 *  round them. */
export interface RoadsFile { origin: LngLat; unit: number; r: RawRoad[]; a: Pts[]; x: number[][]; t?: number[][]; c?: RawRoad[]; b?: number[];
  j?: (number | Pts)[][]; k?: Pts[]; i?: Pts[][]; o?: number[][]; w?: Pts[][] }

/** A street with its pavement, for the street lights. */
export interface Street { coords: LngLat[]; half: number; pave: number; box: [number, number, number, number] }

/** The widths the map draws, in metres, each its own layer (scene3d.ts): a width given per feature (a data
 *  expression inside a zoom curve) is worked out by MapLibre for each tile at that tile's own zoom, so streets grew
 *  and shrank while the map zoomed (old tiles shown until new ones load) and changed width where a tilted view
 *  meets tiles of another zoom. One width per layer is a plain zoom curve, exact at every zoom on every tile.
 *  Carriageways to the half metre (`wq`), pavements to the metre (`pq`, the whole width with both pavements). */
export interface Widths { road: number[]; motor: number[]; walk: number[]; path: number[] }
export const roadQ = (w: number) => Math.max(0.5, Math.round(w * 2) / 2);
export const walkQ = (w: number) => Math.max(1, Math.round(w));

export interface AthensRoads {
  features: GeoJSON.Feature[];
  widths: Widths;
  roads: Road[];        // the carriageways, for roadSnap's RoadIndex
  streets: Street[];
  box: [number, number, number, number];   // west, south, east, north of the area covered
  origin: LngLat;
}

export const DASH = 3, GAP = 6;                          // Greek urban lane lines: 3 m painted, 6 m clear
const ZEBRA_DEPTH = 3, ZEBRA_W = 0.5, ZEBRA_STEP = 1;    // stripes 50 cm wide, 50 cm apart, 3 m long
const EDGE_MIN = 4;                                       // an edge line shorter than this (m), cut by a junction, is dropped
const ARROW_SCALE = 1.35;                                 // the turn arrows a third bigger than painted: readable from above

export function points(origin: LngLat, unit: number, d: Pts): LngLat[] {
  const out: LngLat[] = [];
  let x = Math.round(origin[0] / unit), y = Math.round(origin[1] / unit);
  for (let i = 0; i + 1 < d.length; i += 2) {
    x += d[i];
    y += d[i + 1];
    out.push([x * unit, y * unit]);
  }
  return out;
}

const kxOf = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);
const KY = 110540;

/** A line cut into dashes `dash` metres long, `gap` metres apart, the first half a gap in. */
export function dashes(line: LngLat[], dash = DASH, gap = GAP): LngLat[][] {
  if (line.length < 2) return [];
  const kx = kxOf(line[0][1]);
  const out: LngLat[][] = [];
  let on = false, left = gap / 2, cur: LngLat[] = [];
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    const L = Math.hypot((bx - ax) * kx, (by - ay) * KY);
    let t = 0;   // metres along this segment
    while (L - t >= left) {
      t += left;
      const p: LngLat = [ax + ((bx - ax) * t) / L, ay + ((by - ay) * t) / L];
      if (on) { cur.push(p); out.push(cur); cur = []; } else cur = [p];
      on = !on;
      left = on ? dash : gap;
    }
    left -= L - t;
    if (on) cur.push([bx, by]);
  }
  return out;   // a dash cut short by the end of the line is left out
}

/** A zebra crossing: stripes along the road (its bearing, counter-clockwise from east), across its carriageway. */
export function zebra(at: LngLat, bearingDeg: number, half: number): LngLat[][] {
  const kx = kxOf(at[1]), a = (bearingDeg * Math.PI) / 180;
  const tx = Math.cos(a), ty = Math.sin(a), nx = -ty, ny = tx;
  const ll = (x: number, y: number): LngLat => [at[0] + x / kx, at[1] + y / KY];
  const out: LngLat[][] = [];
  const h = half - 0.4;   // kept off the kerb
  for (let s = -h + ZEBRA_W / 2; s <= h - ZEBRA_W / 2 + 1e-6; s += ZEBRA_STEP) {
    const cx = nx * s, cy = ny * s, d = ZEBRA_DEPTH / 2;
    out.push([ll(cx - tx * d, cy - ty * d), ll(cx + tx * d, cy + ty * d)]);
  }
  return out;
}

/** The file as map features (properties: kind, w carriageway m, p pavement m each side, t marking type), and the
 *  carriageways for snapping. Marking types: 0 lane line, 1 centre line, 2 bus-lane line, 3 zebra, 4 edge line. */
/** The street with its markings: lane lines, zebras, stop lines, arrows, bus-lane words and junction islands. `marks`
 *  false draws it plain (asphalt, kerbs and pavements only; tried 2026-11-09, as nextstopsg.app draws Singapore). */
export function decode(f: RoadsFile, marks = true): AthensRoads {
  const { origin, unit } = f;
  const features: GeoJSON.Feature[] = [], roads: Road[] = [], streets: Street[] = [];
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const road = new Set<number>(), motor = new Set<number>(), walk = new Set<number>(), path = new Set<number>();
  const line = (coords: LngLat[] | LngLat[][], properties: Record<string, unknown>): GeoJSON.Feature => ({
    type: "Feature", properties,
    geometry: typeof coords[0][0] === "number" ? { type: "LineString", coordinates: coords as LngLat[] } : { type: "MultiLineString", coordinates: coords as LngLat[][] },
  });
  // Every way is drawn flat on the street, bridges and tunnels too; their level (OSM layer) only says which road's
  // markings give way where two cross (markings, below).
  const level = new Map<Road, number>();
  // Its own roads, then the neighbours' (seen, not drawn): `all` for what looks round a point, `roads` its own.
  const all: Road[] = [];
  const raw: [RawRoad, boolean][] = [...f.r.map(r => [r, true] as [RawRoad, boolean]), ...(f.c ?? []).map(r => [r, false] as [RawRoad, boolean])];
  for (const [[kind, wDm, pDm, oneway, busDm, pts, rawMarks, lv = 0], own] of raw) {
    const coords = points(origin, unit, pts);
    if (coords.length < 2) continue;
    const w = wDm / 10, p = pDm / 10;
    if (!own) {
      if (kind === 1) continue;
      const rd: Road = { coords, half: w / 2, oneway: !!oneway, bus: busDm / 10, len: lengthOf(coords), pave: p, kind };
      if (lv) level.set(rd, lv);
      all.push(rd);
      continue;
    }
    const k = kind === 1 ? "path" : kind === 2 ? "motor" : "road", wq = roadQ(w);
    features.push(line(coords, { kind: k, w, p, wq, ...(k === "road" && { pq: walkQ(w + 2 * p) }) }));
    (k === "road" ? road : k === "motor" ? motor : path).add(wq);
    if (k === "road") walk.add(walkQ(w + 2 * p));
    if (kind === 1) continue;
    const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of coords) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
    box[0] = Math.min(box[0], b[0]); box[1] = Math.min(box[1], b[1]); box[2] = Math.max(box[2], b[2]); box[3] = Math.max(box[3], b[3]);
    const rd: Road = { coords, half: w / 2, oneway: !!oneway, bus: busDm / 10, len: lengthOf(coords), pave: p, kind };
    if (lv) level.set(rd, lv);
    roads.push(rd);
    all.push(rd);
    if (kind === 0 && !lv) streets.push({ coords, half: w / 2, pave: p, box: b });   // lamps: not along a bridge
    if (marks) for (const [t, mp] of rawMarks) {
      const m = points(origin, unit, mp);
      if (m.length < 2) continue;
      if (t !== 3) (rd.marks ??= []).push([t, m]);   // drawn below, once every road is known
    }
  }
  // The markings, kept off every other road's carriageway near a junction (OSM's are cut back round their own
  // road's junction points only, so at a slanted junction of wide roads a lane or edge line ran on into the
  // crossing road), lane lines dashed.
  // What lies at a point (a fork, a junction, a change of width) is drawn by the tile the point is in.
  const b = f.b, mine = (p: LngLat) => !b || (p[0] >= b[0] && p[0] < b[2] && p[1] >= b[1] && p[1] < b[3]);
  const N = nodesOf(all);
  let onJunction: (r: Road, p: LngLat) => boolean;
  if (f.j) {
    // Worked out with polygons (scripts/junctions.py): drawn as they come; a lane line stops on any of them.
    const shapes: Shape[] = [], grid = new Map<string, Shape[]>(), G = 0.0005;
    for (const e of f.j) {
      const own = e[0] as number, rr = (e.slice(1) as Pts[]).map(q => points(origin, unit, q));
      if (rr[0].length < 4) continue;
      if (own) features.push({ type: "Feature", properties: { kind: "patch" }, geometry: { type: "Polygon", coordinates: rr } });
      const sh: Shape = { ...shape(rr[0]), holes: rr.slice(1) };
      shapes.push(sh);
      for (let x = Math.floor(sh.b[0] / G); x <= Math.floor(sh.b[2] / G); x++) for (let y = Math.floor(sh.b[1] / G); y <= Math.floor(sh.b[3] / G); y++)
        (grid.get(`${x},${y}`) ?? grid.set(`${x},${y}`, []).get(`${x},${y}`)!).push(sh);
    }
    for (const k of f.k ?? []) features.push(line(points(origin, unit, k), { kind: "patchKerb" }));
    if (marks) for (const isl of f.i ?? []) features.push({ type: "Feature", properties: { kind: "island" }, geometry: { type: "Polygon", coordinates: isl.map(q => points(origin, unit, q)) } });
    for (const w of f.w ?? []) features.push({ type: "Feature", properties: { kind: "walkPatch" }, geometry: { type: "Polygon", coordinates: w.map(q => points(origin, unit, q)) } });
    if (marks) for (const [dx, dy, rc, hc] of f.o ?? []) {
      const [c] = points(origin, unit, [dx, dy]), kx = kxOf(c[1]), rad = rc / 100;
      const ring: LngLat[] = [];
      for (let n = 0; n <= 96; n++) { const a = (n / 96) * 2 * Math.PI; ring.push([c[0] + (Math.cos(a) * rad) / kx, c[1] + (Math.sin(a) * rad) / KY]); }
      const d = dashes(ring);
      if (d.length && hc >= 350) features.push(line(d, { kind: "mark", t: 0 }));
    }
    onJunction = (_r, p) => {
      for (const sh of grid.get(`${Math.floor(p[0] / G)},${Math.floor(p[1] / G)}`) ?? []) if (inShape(p, sh) && !sh.holes?.some(h => inPoly(p, h))) return true;
      return false;
    };
  } else {
    const forks = forkPatches(all, mine);
    const boxes = junctionPatches(all, forks.nodes, N, mine);
    features.push(...forks.features, ...boxes.features);
    onJunction = (r, p) => forks.inside(r, p) || boxes.inside(r, p);
  }
  features.push(...taperPatches(all, N, level, p => mine(p) && !onJunction(all[0], p)));
  const clip = marks ? junctionClip(all, N, onJunction, level) : null;
  if (clip) for (const r of roads) for (const [t, m] of r.marks ?? []) {
    for (const piece of clip(r, m)) {
      if (t === 4 && lengthOf(piece) < EDGE_MIN) continue;   // what a junction left of an edge line: a stub, not a line
      if (t === 0) { const d = dashes(piece); if (d.length) features.push(line(d, { kind: "mark", t })); }
      else features.push(line(piece, { kind: "mark", t }));
    }
  }
  for (const a of f.a) {
    const ring = points(origin, unit, a);
    if (ring.length >= 4) features.push({ type: "Feature", properties: { kind: "area" }, geometry: { type: "Polygon", coordinates: [ring] } });
  }
  if (marks) for (const [dx, dy, bearing, halfDm] of f.x) {
    const [at] = points(origin, unit, [dx, dy]);
    features.push(line(zebra(at, bearing / 10, halfDm / 10), { kind: "mark", t: 3 }));
  }
  // The stop lines before the zebras (type 5), the word ΛΕΩΦΟΡΕΙΑ in the bus lanes, the turn arrows (when the file
  // has them): painted as on the street.
  if (marks) features.push(...stopLines(f, all, N), ...busWords(roads));
  if (marks) for (const [dx, dy, bearing, code] of f.t ?? []) {
    const [at] = points(origin, unit, [dx, dy]);
    const polys = arrow(at, bearing / 10, code);
    if (polys.length) features.push({ type: "Feature", properties: { kind: "arrow" }, geometry: { type: "MultiPolygon", coordinates: polys } });
  }
  const sorted = (x: Set<number>) => [...x].sort((a, b) => a - b);
  return { features, roads, streets, box, origin,
    widths: { road: sorted(road), motor: sorted(motor), walk: sorted(walk), path: sorted(path) } };
}

// Where ways meet: a point of a way counts two arms (one at its ends); three arms or more is a junction.
const vkey = ([lon, lat]: LngLat) => `${Math.round(lon * 1e7)},${Math.round(lat * 1e7)}`;
/** The ways' points, once per tile: each point's key, how many arms meet there, and the ways through it. */
type Nodes = { keys: string[][]; arms: Map<string, number>; at: Map<string, { r: number; i: number }[]> };
function nodesOf(roads: Road[]): Nodes {
  const arms = new Map<string, number>(), at = new Map<string, { r: number; i: number }[]>();
  const keys = roads.map((r, ri) => r.coords.map((p, i) => {
    const k = vkey(p), end = i === 0 || i === r.coords.length - 1;
    arms.set(k, (arms.get(k) ?? 0) + (end ? 1 : 2));
    (at.get(k) ?? at.set(k, []).get(k)!).push({ r: ri, i });
    return k;
  }));
  return { keys, arms, at };
}

/** A stop line 1 m before each zebra, across the lanes that come up to it on their way into the junction it guards
 *  (the nearest one within 40 m along its road; mid-block, both ways). 40 cm wide. Type 5. */
function stopLines(f: RoadsFile, roads: Road[], { arms, at, keys }: Nodes): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = [];
  for (const [dx, dy, bearing, halfDm] of f.x) {
    const [z] = points(f.origin, f.unit, [dx, dy]), half = halfDm / 10, kx = kxOf(z[1]);
    const ang = ((bearing / 10) * Math.PI) / 180;
    // The road it is on: the way through its point that runs most nearly as it says.
    let best: { r: number; i: number; tx: number; ty: number } | null = null, bestDot = 0.7;
    for (const h of at.get(vkey(z)) ?? []) {
      const c = roads[h.r].coords, a = c[Math.max(0, h.i - 1)], b = c[Math.min(c.length - 1, h.i + 1)];
      const ex = (b[0] - a[0]) * kx, ey = (b[1] - a[1]) * KY, L = Math.hypot(ex, ey);
      if (!L) continue;
      const dot = Math.abs((ex / L) * Math.cos(ang) + (ey / L) * Math.sin(ang));
      if (dot > bestDot) { bestDot = dot; best = { ...h, tx: ex / L, ty: ey / L }; }
    }
    if (!best) continue;
    const r = roads[best.r];
    if (r.kind === 1) continue;
    // How far along it, each way, the next junction is (40 m at most).
    const reach = (dir: 1 | -1) => {
      let d = 0;
      for (let i = best!.i + dir; i >= 0 && i < r.coords.length; i += dir) {
        const a = r.coords[i - dir], b = r.coords[i];
        d += Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * KY);
        if (d > 40) return Infinity;
        if ((arms.get(keys[best!.r][i]) ?? 0) >= 3) return d;
      }
      return Infinity;
    };
    const ahead = reach(1), behind = reach(-1);
    const { tx, ty } = best, nx = -ty, ny = tx;
    const ll = (along: number, side: number): LngLat => [z[0] + (tx * along + nx * side) / kx, z[1] + (ty * along + ny * side) / KY];
    const edge = half - 0.4, D = 1.5 + 1 + 0.2;
    // Traffic the way the road is drawn stops before it (behind it); against, after it. Each on its own half
    // (a one-way road: across all of it, and only the way it goes).
    const fwd = () => out.push(line2([ll(-D, -edge), ll(-D, r.oneway ? edge : -0.15)]));
    const back = () => { if (!r.oneway) out.push(line2([ll(D, 0.15), ll(D, edge)])); };
    if (ahead < behind) fwd();
    else if (behind < ahead) back();
    else { fwd(); back(); }
  }
  return out;
  function line2(c: LngLat[]): GeoJSON.Feature { return { type: "Feature", properties: { kind: "mark", t: 5 }, geometry: { type: "LineString", coordinates: c } }; }
}

/** Cuts a road's marking where it lies on another road's carriageway (its half width and 30 cm) within 40 m of a
 *  junction they share; the pieces left, each 2 m or longer. Only the roads met at the road's own junctions are
 *  looked at, so this costs little. */
function junctionClip(roads: Road[], { arms, at, keys }: Nodes, inside: (r: Road, p: LngLat) => boolean = () => false, level = new Map<Road, number>()) {
  const boxOf = (r: Road) => {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of r.coords) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
    return b;
  };
  // The roads that may lie over another: those above the ground (for a street's lines), every one (for a tunnel's).
  const lifted = roads.filter(r => r.kind !== 1 && (level.get(r) ?? 0) > 0).map(r => ({ r, b: boxOf(r) }));
  let all: { r: Road; b: number[] }[] | null = null;
  type Seg = { ax: number; ay: number; bx: number; by: number; w: number };
  const cache = new Map<Road, Seg[]>(), index = new Map(roads.map((r, i) => [r, i]));
  return (r: Road, m: LngLat[]): LngLat[][] => {
    const o0 = r.coords[0], kx = kxOf(o0[1]);
    const loc = (p: LngLat) => [(p[0] - o0[0]) * kx, (p[1] - o0[1]) * KY];
    let others = cache.get(r);
    if (!others) {
    // The other roads at its junctions: their stretches within 40 m of the junction, in metres from its first point
    // (once per road: its lines share them).
    others = [];
    cache.set(r, others);
    for (const k of keys[index.get(r)!]) {
      if ((arms.get(k) ?? 0) < 3) continue;
      for (const { r: oi, i: j } of at.get(k) ?? []) {
        const o = roads[oi];
        if (o === r || o.kind === 1 || (level.get(o) ?? 0) !== (level.get(r) ?? 0)) continue;
        const c = o.coords;
        for (const dir of [-1, 1]) {
          let d = 0;
          for (let n = j + dir; n >= 0 && n < c.length && d < 40; n += dir) {
            const [ax, ay] = loc(c[n - dir]), [bx, by] = loc(c[n]);
            others.push({ ax, ay, bx, by, w: o.half + 0.3 });
            d += Math.hypot(bx - ax, by - ay);
          }
        }
      }
    }
    }
    // And every road of a higher level over it (a bridge over a street, a street over a tunnel): its markings stop
    // under that road, so a crossing does not look like a junction.
    const lv = level.get(r) ?? 0, mb = [Infinity, Infinity, -Infinity, -Infinity], pad = 30 / KY;
    for (const [x, y] of m) { mb[0] = Math.min(mb[0], x); mb[1] = Math.min(mb[1], y); mb[2] = Math.max(mb[2], x); mb[3] = Math.max(mb[3], y); }
    const segs = [...others];
    const over = lv < 0 ? (all ??= roads.filter(o => o.kind !== 1).map(o => ({ r: o, b: boxOf(o) }))) : lifted;
    for (const { r: o, b } of over) {
      if (o === r || (level.get(o) ?? 0) <= lv) continue;
      if (b[0] > mb[2] + pad || b[2] < mb[0] - pad || b[1] > mb[3] + pad || b[3] < mb[1] - pad) continue;
      for (let n = 1; n < o.coords.length; n++) {
        const [ax, ay] = loc(o.coords[n - 1]), [bx, by] = loc(o.coords[n]);
        segs.push({ ax, ay, bx, by, w: o.half + 0.3 });
      }
    }
    // Only the stretches near this line count (a box round it, 30 m out).
    const [x0, y0] = loc([mb[0], mb[1]]), [x1, y1] = loc([mb[2], mb[3]]);
    const near = segs.filter(q => Math.max(q.ax, q.bx) > x0 - 30 && Math.min(q.ax, q.bx) < x1 + 30 && Math.max(q.ay, q.by) > y0 - 30 && Math.min(q.ay, q.by) < y1 + 30);
    const on = (p: LngLat) => {
      if (inside(r, p)) return true;
      const [x, y] = loc(p);
      for (const q of near) {
        const ex = q.bx - q.ax, ey = q.by - q.ay, L2 = ex * ex + ey * ey || 1;
        const u = Math.max(0, Math.min(1, ((x - q.ax) * ex + (y - q.ay) * ey) / L2)), dx = q.ax + ex * u - x, dy = q.ay + ey * u - y;
        if (dx * dx + dy * dy < q.w * q.w) return true;
      }
      return false;
    };
    // Every 2 m along it: kept or not.
    const out: LngLat[][] = [];
    let cur: LngLat[] = [];
    const flush = () => {
      let L = 0;
      for (let n = 1; n < cur.length; n++) L += Math.hypot((cur[n][0] - cur[n - 1][0]) * kx, (cur[n][1] - cur[n - 1][1]) * KY);
      if (cur.length > 1 && L >= 2) out.push(cur);
      cur = [];
    };
    // Its own points where kept, and the first and last kept sample at each cut, so the line keeps its shape.
    let prev: LngLat | null = null;
    const visit = (p: LngLat, vertex: boolean) => {
      if (on(p)) {
        if (prev && cur[cur.length - 1] !== prev) cur.push(prev);
        flush();
        prev = null;
        return;
      }
      if (vertex || !cur.length) cur.push(p);
      prev = p;
    };
    visit(m[0], true);
    for (let n = 1; n < m.length; n++) {
      const a = m[n - 1], b = m[n], steps = Math.max(1, Math.ceil(Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * KY) / 2));
      for (let k = 1; k <= steps; k++) visit(k === steps ? b : [a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps], k === steps);
    }
    flush();
    return out;
  };
}

/** Where a one-way road splits in two or two merge (one way's end meets two ways leaving it in its direction,
 *  nothing passing through): the street layers draw each way at its own width, so the wide way ended square and the branches,
 *  all starting at its middle, crossed inside it. A patch paves the fork: the hull of the wide way's end and each
 *  branch's two edges 25 m on (less on a short one), with its outer sides as kerbs (white, 30 cm); the branches'
 *  lines are left out inside it. Features: kind "patch" (a polygon) and kind "patchKerb" (lines). */
function forkPatches(roads: Road[], mine: (p: LngLat) => boolean = () => true) {
  type E = { r: number; k: 0 | 1 };
  const ends = new Map<string, E[]>(), through = new Set<string>();
  roads.forEach((r, ri) => {
    if (r.kind === 1 || r.coords.length < 2) return;
    r.coords.forEach((p, i) => {
      const k = vkey(p);
      if (i === 0 || i === r.coords.length - 1) (ends.get(k) ?? ends.set(k, []).get(k)!).push({ r: ri, k: i === 0 ? 0 : 1 });
      else through.add(k);
    });
  });
  const features: GeoJSON.Feature[] = [], hulls = new Map<Road, Shape[]>(), nodes = new Set<string>();
  for (const [key, es] of ends) {
    // Only a lane split or merge: three one-way ways (the wide one and two branches), nothing else there. A junction
    // of streets is not paved over.
    if (es.length !== 3 || through.has(key) || es.some(e => !roads[e.r].oneway)) continue;
    const r0 = roads[es[0].r], z = es[0].k ? r0.coords[r0.coords.length - 1] : r0.coords[0], kx = kxOf(z[1]);
    const loc = (p: LngLat): [number, number] => [(p[0] - z[0]) * kx, (p[1] - z[1]) * KY];
    const ll = ([x, y]: [number, number]): LngLat => [z[0] + x / kx, z[1] + y / KY];
    // Each way's line from the fork: its points, in metres, out to `d` metres.
    const from = (e: E, d: number): [number, number][] => {
      const c = roads[e.r].coords, pts = (e.k ? [...c].reverse() : c).map(loc), out: [number, number][] = [pts[0]];
      let s = 0;
      for (let i = 1; i < pts.length; i++) {
        const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (s + L >= d) { const u = (d - s) / (L || 1); out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u]); return out; }
        out.push(pts[i]);
        s += L;
      }
      return out;
    };
    const dirOf = (e: E) => { const l = from(e, 8), [x, y] = l[l.length - 1], L = Math.hypot(x, y) || 1; return [x / L, y / L]; };
    const dirs = es.map(dirOf);
    // The wide way: the one the others all leave (each at least 70 degrees from it, back the other way).
    const ti = dirs.findIndex((d, i) => dirs.every((o, j) => j === i || d[0] * o[0] + d[1] * o[1] < -0.35));
    if (ti < 0) continue;
    const [tx, ty] = dirs[ti], bd = dirs.filter((_, i) => i !== ti);
    // Both branches carry on the wide way's line (within 40 degrees) and part gently (under 60 degrees apart).
    if (bd.some(d => -(d[0] * tx + d[1] * ty) < 0.77) || bd[0][0] * bd[1][0] + bd[0][1] * bd[1][1] < 0.5) continue;
    const trunk = roads[es[ti].r], th = halfQ(trunk);
    const pts: [number, number][] = [[-ty * th, tx * th], [ty * th, -tx * th]];   // the wide way's end, both edges
    const branches = es.filter((_, i) => i !== ti);
    let ok = true;
    for (const e of branches) {
      const b = roads[e.r], h = halfQ(b), line = from(e, Math.min(25, (b.len ?? lengthOf(b.coords)) * 0.5));
      if (line.length < 2) { ok = false; break; }
      const [ax, ay] = line[line.length - 2], [bx, by] = line[line.length - 1], L = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / L, ny = (bx - ax) / L;
      pts.push([bx + nx * h, by + ny * h], [bx - nx * h, by - ny * h]);
    }
    if (!ok) continue;
    const hull = convexHull(pts);
    if (hull.length < 3) continue;
    const ring = [...hull, hull[0]].map(ll), draw = mine(z);
    if (draw) features.push({ type: "Feature", properties: { kind: "patch" }, geometry: { type: "Polygon", coordinates: [ring] } });
    // Its kerbs: the hull's sides, but for the wide way's end and each branch's end (the road runs on there).
    const across = new Set<string>();
    const pk = (p: [number, number]) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
    for (let i = 0; i < pts.length; i += 2) { across.add(pk(pts[i]) + "|" + pk(pts[i + 1])); across.add(pk(pts[i + 1]) + "|" + pk(pts[i])); }
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length];
      if (draw && !across.has(pk(a) + "|" + pk(b))) features.push({ type: "Feature", properties: { kind: "patchKerb" }, geometry: { type: "LineString", coordinates: [ll(a), ll(b)] } });
    }
    const sh = shape(ring);
    for (const e of branches) (hulls.get(roads[e.r]) ?? hulls.set(roads[e.r], []).get(roads[e.r])!).push(sh);
    nodes.add(key);
  }
  return { features, nodes, inside: (r: Road, p: LngLat) => !!hulls.get(r)?.some(h => inShape(p, h)) };
}

/** Where a road changes width (a lane more or less: in OpenStreetMap a new way starts there), the street layers drew
 *  the wide way's round end and then the narrow way, so its edge (and a median between two halves) stepped, a notch
 *  each time. On the street it widens gradually. Here, where two ways meet end to end and nothing else does, in line,
 *  at widths 75 cm or more apart, the narrow one is widened from the wide one's width to its own over TAPER_PER m
 *  per metre of difference (10-30 m, not past its next junction), along an S curve, with its kerbs; and its pavement
 *  under it. Features: kind "patch", "patchKerb" and "walkPatch". */
const TAPER_PER = 6, TAPER_MIN = 10, TAPER_MAX = 30;
function taperPatches(roads: Road[], { arms, at }: Nodes, level: Map<Road, number>, mine: (p: LngLat) => boolean) {
  const features: GeoJSON.Feature[] = [];
  for (const [key, list] of at) {
    if (list.length !== 2 || (arms.get(key) ?? 0) !== 2) continue;
    const [e1, e2] = list, r1 = roads[e1.r], r2 = roads[e2.r];
    if (e1.r === e2.r || r1.kind === 1 || r2.kind === 1 || r1.kind !== r2.kind || (level.get(r1) ?? 0) !== (level.get(r2) ?? 0)) continue;
    const h1 = halfQ(r1), h2 = halfQ(r2);
    if (Math.abs(h1 - h2) < 0.375) continue;
    const [wide, narrow] = h1 > h2 ? [e1, e2] : [e2, e1];
    const W = roads[wide.r], Nr = roads[narrow.r], hw = Math.max(h1, h2), hn = Math.min(h1, h2);
    const z = W.coords[wide.i], kx = kxOf(z[1]);
    if (!mine(z)) continue;
    const loc = (p: LngLat): [number, number] => [(p[0] - z[0]) * kx, (p[1] - z[1]) * KY];
    const ll = ([x, y]: number[]): LngLat => [z[0] + x / kx, z[1] + y / KY];
    // Both ways from the point, in metres: they must carry on in line (within 25 degrees).
    const away = (e: { r: number; i: number }) => { const c = roads[e.r].coords; return (e.i === 0 ? c : [...c].reverse()).map(loc); };
    const a = away(wide), b = away(narrow);
    const dir = (l: [number, number][]) => { let k = 1; while (k < l.length - 1 && Math.hypot(...l[k]) < 6) k++; const L = Math.hypot(...l[k]) || 1; return [l[k][0] / L, l[k][1] / L]; };
    const da = dir(a), db = dir(b);
    if (da[0] * db[0] + da[1] * db[1] > -0.9) continue;
    // Along the narrow way, every 1.5 m, to the taper's end (or before its next junction point, or 80% of it).
    const blen = b.reduce((t, p, i) => (i ? t + Math.hypot(p[0] - b[i - 1][0], p[1] - b[i - 1][1]) : 0), 0);
    let stopAt = blen * 0.95;
    const ck = Nr.coords.map(vkey), order = narrow.i === 0 ? ck : [...ck].reverse();
    { let s = 0; for (let k = 1; k < b.length; k++) { s += Math.hypot(b[k][0] - b[k - 1][0], b[k][1] - b[k - 1][1]); if ((arms.get(order[k]) ?? 0) >= 3) { stopAt = Math.min(stopAt, s); break; } } }
    const L = Math.min(TAPER_MAX, Math.max(TAPER_MIN, TAPER_PER * 2 * (hw - hn)), stopAt);
    if (L < 2) continue;
    const pw = W.pave ?? 0, pn = Nr.pave ?? 0;
    const left: [number, number][] = [], right: [number, number][] = [], wl: [number, number][] = [], wr: [number, number][] = [];
    let s = 0, k = 1;
    for (let q = 0; q <= L + 1e-6; q = Math.min(L, q + 1.5)) {
      while (k < b.length - 1 && s + Math.hypot(b[k][0] - b[k - 1][0], b[k][1] - b[k - 1][1]) < q) { s += Math.hypot(b[k][0] - b[k - 1][0], b[k][1] - b[k - 1][1]); k++; }
      const [ax, ay] = b[k - 1], [bx, by] = b[k], sl = Math.hypot(bx - ax, by - ay) || 1, u = Math.min(1, (q - s) / sl);
      const p = [ax + (bx - ax) * u, ay + (by - ay) * u], t = [(bx - ax) / sl, (by - ay) / sl], n = [-t[1], t[0]];
      const f = q / L, sm = f * f * (3 - 2 * f), h = hw + (hn - hw) * sm, pv = pw + (pn - pw) * sm;
      left.push([p[0] + n[0] * h, p[1] + n[1] * h]); right.push([p[0] - n[0] * h, p[1] - n[1] * h]);
      wl.push([p[0] + n[0] * (h + pv), p[1] + n[1] * (h + pv)]); wr.push([p[0] - n[0] * (h + pv), p[1] - n[1] * (h + pv)]);
      if (q >= L) break;
    }
    // Back from the point a little into the wide way, so the patch meets its square edge (not its round end).
    const back = [da[0] * 0.5, da[1] * 0.5], nb = [-da[1], da[0]];
    const poly = (l: [number, number][], r: [number, number][], h: number) => {
      const c0 = [back[0] + nb[0] * h, back[1] + nb[1] * h], c1 = [back[0] - nb[0] * h, back[1] - nb[1] * h];
      // nb points left of the wide way's direction away from the point, which is right of the narrow way's: pair by side.
      const [cl, cr] = (c0[0] - l[0][0]) ** 2 + (c0[1] - l[0][1]) ** 2 < (c1[0] - l[0][0]) ** 2 + (c1[1] - l[0][1]) ** 2 ? [c0, c1] : [c1, c0];
      return [cl, ...l, ...[...r].reverse(), cr, cl].map(ll);
    };
    features.push({ type: "Feature", properties: { kind: "walkPatch" }, geometry: { type: "Polygon", coordinates: [poly(wl, wr, hw + pw)] } });
    features.push({ type: "Feature", properties: { kind: "patch" }, geometry: { type: "Polygon", coordinates: [poly(left, right, hw)] } });
    for (const side of [left, right]) features.push({ type: "Feature", properties: { kind: "patchKerb" }, geometry: { type: "LineString", coordinates: side.map(ll) } });
  }
  return features;
}

/** A paved shape and its box, to test points against quickly. */
type Shape = { ring: LngLat[]; b: number[]; holes?: LngLat[][] };
const shape = (ring: LngLat[]): Shape => {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
  return { ring, b };
};
const inShape = (p: LngLat, s: Shape) => p[0] >= s.b[0] && p[0] <= s.b[2] && p[1] >= s.b[1] && p[1] <= s.b[3] && inPoly(p, s.ring);

function inPoly(p: LngLat, ring: LngLat[]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Junctions paved as one: the street layers draw each way as a line with round ends, so where streets meet their
 *  edges, ends and lines piled up, with no corner to turn round. Here the junction points of one junction (those
 *  joined by a stretch of road under 30 m: a dual carriageway crossing another makes four) are taken together; each
 *  road leaving it is cut square a little way out (its mouth: past the widest of the others, and 4 m for the
 *  corner), and the junction is paved from mouth to mouth, each corner a curve that carries on the two kerbs it
 *  joins (white). Inside, no road's lane or edge lines; the zebras and stop lines are drawn over it. Features: kind
 *  "patch" and "patchKerb", as the forks'. */
function junctionPatches(roads: Road[], skip: Set<string>, { arms, at, keys }: Nodes, mine: (p: LngLat) => boolean = () => true) {
  const junction = (k: string) => (arms.get(k) ?? 0) >= 3 && !skip.has(k);
  const features: GeoJSON.Feature[] = [], polys = new Map<Road, Shape[]>();
  // One junction's points: those joined by a stretch of road no longer than both roads' half widths and 6 m (two
  // halves of a divided road crossing another make four; a side street 25 m on along an avenue stays its own), the
  // whole no more than 90 m across; and those round a small ring of stretches (ringed). Each is paved as one.
  const posOf = (k: string) => { const h = at.get(k)![0]; return roads[h.r].coords[h.i]; };
  const halfAt = (k: string) => Math.max(...at.get(k)!.map(h => halfQ(roads[h.r])));
  const points = [...at.keys()].filter(junction);
  const root = new Map(points.map(k => [k, k])), members = new Map(points.map(k => [k, [k]]));
  const find = (k: string): string => { let x = k; while (root.get(x) !== x) x = root.get(x)!; return x; };
  // The stretches between two junction points, up to 40 m.
  const links: [string, string, number][] = [], adj = new Map<string, [string, number, number][]>();
  for (const k of points) {
    for (const { r, i } of at.get(k)!) {
      const c = roads[r].coords, kx0 = kxOf(c[i][1]);
      let d = 0;
      for (let n = i + 1; n < c.length; n++) {
        d += Math.hypot((c[n][0] - c[n - 1][0]) * kx0, (c[n][1] - c[n - 1][1]) * KY);
        if (d > 40) break;
        const nk = keys[r][n];
        if (!junction(nk)) continue;
        if (nk !== k) { links.push([k, nk, d]); for (const [x, y] of [[k, nk], [nk, k]]) (adj.get(x) ?? adj.set(x, []).get(x)!).push([y, d, halfQ(roads[r])]); }
        break;
      }
    }
  }
  // Is the stretch a side of a small ring of junction points (four at most, 140 m round) whose inside is mostly
  // carriageway? Where divided roads cross the points of one junction ring each other round a paved middle; a city
  // block is a ring too, but of buildings, its streets covering a third of it or less.
  const ringed = (A: string, B: string, d0: number, h0: number) => {
    const path: string[] = [A, B], cover = [d0 * h0];
    const paved = () => {
      const xy = path.map(posOf), kx0 = kxOf(xy[0][1]);
      let area = 0;
      for (let n = 0; n < xy.length; n++) { const p = xy[n], q = xy[(n + 1) % xy.length]; area += ((p[0] - xy[0][0]) * kx0) * ((q[1] - xy[0][1]) * KY) - ((q[0] - xy[0][0]) * kx0) * ((p[1] - xy[0][1]) * KY); }
      return cover.reduce((t, x) => t + x, 0) >= 0.6 * Math.abs(area / 2);
    };
    const go = (x: string, depth: number, len: number): boolean => {
      for (const [y, d, h] of adj.get(x) ?? []) {
        if (len + d > 140 || (x === B && y === A && depth === 0)) continue;
        if (y === A && depth > 0) { cover.push(d * h); const ok = paved(); cover.pop(); if (ok) return true; continue; }
        if (depth < 2 && !path.includes(y)) { path.push(y); cover.push(d * h); if (go(y, depth + 1, len + d)) return true; path.pop(); cover.pop(); }
      }
      return false;
    };
    return go(B, 0, d0);
  };
  for (const [k, nk, d] of links) {
    const A = find(k), B = find(nk);
    if (A === B || !(d <= Math.min(30, halfAt(k) + halfAt(nk) + 6) || ringed(k, nk, d, Math.min(halfAt(k), halfAt(nk))))) continue;
    const all = [...members.get(A)!, ...members.get(B)!].map(posOf), kx0 = kxOf(all[0][1]);
    const w = (Math.max(...all.map(p => p[0])) - Math.min(...all.map(p => p[0]))) * kx0, h = (Math.max(...all.map(p => p[1])) - Math.min(...all.map(p => p[1]))) * KY;
    if (Math.hypot(w, h) <= 90) { root.set(B, A); members.set(A, [...members.get(A)!, ...members.get(B)!]); members.delete(B); }
  }
  // A group that cannot be paved as one (its outline would cross itself) is paved point by point.
  const groups = [...members.values()];
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const ks = [...group].sort(), inGroup = new Set(ks);
    const z = posOf(ks[0]), kx = kxOf(z[1]);
    const loc = (p: LngLat): [number, number] => [(p[0] - z[0]) * kx, (p[1] - z[1]) * KY];
    const ll = ([x, y]: number[]): LngLat => [z[0] + x / kx, z[1] + y / KY];
    const cen = ks.map(k => loc(posOf(k))).reduce((t, p) => [t[0] + p[0] / ks.length, t[1] + p[1] / ks.length], [0, 0]);
    const list = ks.flatMap(k => at.get(k)!.map(h => ({ ...h, k })));
    // Each road leaving it: out to the next junction point or on (a road from one of its points to another is inside it).
    type Arm = { r: number; line: [number, number][]; h: number; inner: boolean; stop: number };
    const out: Arm[] = [];
    for (const { r, i } of list) {
      const c = roads[r].coords;
      for (const dir of [-1, 1]) {
        const line: [number, number][] = [loc(c[i])];
        let stop = Infinity, d = 0, inside = false;
        for (let n = i + dir; n >= 0 && n < c.length; n += dir) {
          const q = loc(c[n]), p0 = line[line.length - 1];
          d += Math.hypot(q[0] - p0[0], q[1] - p0[1]);
          line.push(q);
          const nk = keys[r][n];
          if (junction(nk)) { if (inGroup.has(nk)) inside = true; else stop = d; break; }
          if (d > 40) break;
        }
        if (!inside && line.length > 1) out.push({ r, line, h: halfQ(roads[r]), inner: false, stop });
      }
    }
    if (out.length < 3) { if (ks.length > 1) groups.push(...ks.map(k => [k])); continue; }
    const widest = Math.max(...out.map(a => a.h));
    // Its mouth: square across it, past the widest other road and 4 m for the corner; on a road to the next junction
    // point, no further than halfway there (that point paves the rest).
    type Mouth = { a: Arm; p: [number, number]; u: [number, number]; L: [number, number]; R: [number, number]; ang: number; s: number };
    const mouths: Mouth[] = [];
    for (const a of out) {
      const want = Math.min(30, Math.max(6, widest + 4), a.inner ? a.stop : a.stop * 0.5);
      let s = 0, p = a.line[0], u: [number, number] = [1, 0];
      for (let n = 1; n < a.line.length && s < want; n++) {
        const [ax, ay] = a.line[n - 1], [bx, by] = a.line[n], L = Math.hypot(bx - ax, by - ay);
        if (!L) continue;
        u = [(bx - ax) / L, (by - ay) / L];
        const t = Math.min(L, want - s);
        p = [ax + u[0] * t, ay + u[1] * t];
        s += t;
      }
      if (s < 2) continue;
      const n0: [number, number] = [-u[1], u[0]];   // its left, outwards: counter-clockwise round the point
      mouths.push({ a, p, u, L: [p[0] + n0[0] * a.h, p[1] + n0[1] * a.h], R: [p[0] - n0[0] * a.h, p[1] - n0[1] * a.h], ang: Math.atan2(p[1] - cen[1], p[0] - cen[0]), s });
    }
    if (mouths.length < 3) { if (ks.length > 1) groups.push(...ks.map(k => [k])); continue; }
    mouths.sort((a, b) => a.ang - b.ang);
    // Round the point: each mouth (its right edge, then its left), then the corner to the next one's right edge: a
    // curve along both kerbs, through where they would meet; straight where they do not meet behind the mouths. A
    // white kerb on a corner only between two roads leaving the junction (not inside a big one).
    const ring: [number, number][] = [], kerbs: [number, number][][] = [];
    // Each road's kerbs, from its mouth back into the junction (its own bends; and on straight 25 m past its point).
    type P = [number, number];
    const kerbOf = (m: Mouth, side: 1 | -1): P[] => {
      const pts: P[] = [], l = m.a.line;
      let s = 0;
      const seg: [P, P][] = [];
      for (let n = 1; n < l.length; n++) {
        const L = Math.hypot(l[n][0] - l[n - 1][0], l[n][1] - l[n - 1][1]);
        if (!L) continue;
        const end: P = s + L >= m.s ? m.p : l[n];
        seg.push([l[n - 1], end]);
        s += L;
        if (s >= m.s) break;
      }
      for (const [A, B] of seg) {
        const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, nx = -(B[1] - A[1]) / L * side * m.a.h, ny = (B[0] - A[0]) / L * side * m.a.h;
        pts.push([A[0] + nx, A[1] + ny], [B[0] + nx, B[1] + ny]);
      }
      if (!pts.length) return pts;
      const [A, B] = [pts[0], pts[1]], L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
      pts.unshift([A[0] - (B[0] - A[0]) / L * 25, A[1] - (B[1] - A[1]) / L * 25]);
      return pts.reverse();   // from the mouth inwards
    };
    const cross = (a: P, b: P, c: P, d: P): [number, number] | null => {
      const ex = b[0] - a[0], ey = b[1] - a[1], fx = d[0] - c[0], fy = d[1] - c[1], den = ex * fy - ey * fx;
      if (Math.abs(den) < 1e-9) return null;
      const t = ((c[0] - a[0]) * fy - (c[1] - a[1]) * fx) / den, u = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den;
      return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null;
    };
    const along = (l: P[], upto: number, t: number) => { let d = 0; for (let n = 1; n <= upto; n++) d += Math.hypot(l[n][0] - l[n - 1][0], l[n][1] - l[n - 1][1]); return d + t * Math.hypot(l[upto + 1][0] - l[upto][0], l[upto + 1][1] - l[upto][1]); };
    const ptAt = (l: P[], d: number): P => { for (let n = 1; n < l.length; n++) { const L = Math.hypot(l[n][0] - l[n - 1][0], l[n][1] - l[n - 1][1]); if (d <= L) { const f = L ? d / L : 0; return [l[n - 1][0] + (l[n][0] - l[n - 1][0]) * f, l[n - 1][1] + (l[n][1] - l[n - 1][1]) * f]; } d -= L; } return l[l.length - 1]; };
    const upTo = (l: P[], d: number): P[] => { const out: P[] = [l[0]]; let s = 0; for (let n = 1; n < l.length; n++) { const L = Math.hypot(l[n][0] - l[n - 1][0], l[n][1] - l[n - 1][1]); if (s + L >= d) break; out.push(l[n]); s += L; } out.push(ptAt(l, d)); return out; };
    mouths.forEach((m, i) => {
      const nx = mouths[(i + 1) % mouths.length];
      ring.push(m.R, m.L);
      // The corner: m's left kerb and the next one's right kerb, from their mouths in, to where they meet; rounded
      // there (5 m at most). Where they do not meet (two roads side by side), straight from one mouth to the other.
      const k1 = kerbOf(m, 1), k2 = kerbOf(nx, -1);
      let hit: { d1: number; d2: number } | null = null;
      for (let p1 = 0; p1 + 1 < k1.length && !hit; p1++) for (let p2 = 0; p2 + 1 < k2.length; p2++) {
        const c = cross(k1[p1], k1[p1 + 1], k2[p2], k2[p2 + 1]);
        if (c && (!hit || along(k2, p2, c[1]) < hit.d2)) hit = { d1: along(k1, p1, c[0]), d2: along(k2, p2, c[1]) };
      }
      const curve: P[] = [m.L];
      if (hit && hit.d1 < 45 && hit.d2 < 45) {
        const r = Math.min(5, hit.d1 * 0.9, hit.d2 * 0.9), X = ptAt(k1, hit.d1);
        const a1 = upTo(k1, hit.d1 - r), a2 = upTo(k2, hit.d2 - r).reverse();
        const A = a1[a1.length - 1], B = a2[0];
        curve.push(...a1.slice(1));
        for (let q = 1; q < 6; q++) { const f = q / 6, u = (1 - f) * (1 - f), v = 2 * f * (1 - f), w = f * f; curve.push([u * A[0] + v * X[0] + w * B[0], u * A[1] + v * X[1] + w * B[1]]); }
        curve.push(...a2.slice(0, -1));
      }
      curve.push(nx.R);
      ring.push(...curve.slice(1, -1));
      // A kerb only round a real corner: where two roads leave side by side, a straight line from one's edge to the
      // other's would cut across a carriageway; their own kerbs show there.
      if (curve.length > 2) kerbs.push(curve);
    });
    if (selfCrossing(ring) || (ks.length > 1 && !mostlyRoad(ring, list.map(h => roads[h.r]), loc))) {   // a shape this cannot pave: point by point, or left as the street layers draw it
      if (ks.length > 1) groups.push(...ks.map(k => [k]));
      continue;
    }
    const r2 = [...ring, ring[0]].map(ll);
    if (mine(z)) {
      features.push({ type: "Feature", properties: { kind: "patch" }, geometry: { type: "Polygon", coordinates: [r2] } });
      for (const k of kerbs) features.push({ type: "Feature", properties: { kind: "patchKerb" }, geometry: { type: "LineString", coordinates: k.map(ll) } });
    }
    const sh = shape(r2);
    for (const { r } of list) { const l = polys.get(roads[r]) ?? polys.set(roads[r], []).get(roads[r])!; if (!l.includes(sh)) l.push(sh); }
  }
  return { features, inside: (r: Road, p: LngLat) => !!polys.get(r)?.some(h => inShape(p, h)) };
}

/** Does a junction's outline (metres, `loc`) lie on its roads' carriageways, 85% of it or more? An outline joining
 *  several points can reach past the roads (a chord across a block's corner); then it is not used. Tested every 2 m. */
function mostlyRoad(ring: [number, number][], rs: Road[], loc: (p: LngLat) => [number, number]) {
  const segs: number[][] = [];
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
  for (const r of new Set(rs)) for (let n = 1; n < r.coords.length; n++) {
    const [ax, ay] = loc(r.coords[n - 1]), [bx, by] = loc(r.coords[n]), h = halfQ(r) + 1;
    if (Math.max(ax, bx) < b[0] - h || Math.min(ax, bx) > b[2] + h || Math.max(ay, by) < b[1] - h || Math.min(ay, by) > b[3] + h) continue;
    segs.push([ax, ay, bx, by, h]);
  }
  let inside = 0, on = 0;
  for (let x = b[0] + 1; x < b[2]; x += 2) for (let y = b[1] + 1; y < b[3]; y += 2) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    if (!c) continue;
    inside++;
    for (const [ax, ay, bx, by, h] of segs) {
      const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1, u = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2));
      if ((ax + ex * u - x) ** 2 + (ay + ey * u - y) ** 2 <= h * h) { on++; break; }
    }
  }
  return inside === 0 || on >= 0.85 * inside;
}

/** Does a closed ring cross itself? */
function selfCrossing(ring: [number, number][]) {
  const n = ring.length;
  const cross = (a: number[], b: number[], c: number[], d: number[]) => {
    const o = (p: number[], q: number[], r: number[]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  const bx = ring.map((a, i) => { const b = ring[(i + 1) % n]; return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; });
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    const A = bx[i], B = bx[j];
    if (A[0] > B[2] || B[0] > A[2] || A[1] > B[3] || B[1] > A[3]) continue;
    if (cross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return true;
  }
  return false;
}

/** The convex hull of points (Andrew's monotone chain), counter-clockwise. */
function convexHull(p: [number, number][]): [number, number][] {
  const s = [...p].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], hi: [number, number][] = [];
  for (const q of s) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...s].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

/** ΛΕΩΦΟΡΕΙΑ, every 60 m down each bus lane (a one-way road with a bus-lane line: in the lane between that line and the
 *  kerb), along the way it is driven; none within 15 m of a junction. Points with their turn (rot, degrees clockwise
 *  from north), for a symbol layer. */
function busWords(roads: Road[]): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = [];
  for (const r of roads) {
    if (!r.oneway || r.kind === 1 || !r.marks) continue;
    const bus = r.marks.find(([t]) => t === 2)?.[1];
    if (!bus || bus.length < 2) continue;
    const c = r.coords, kx = kxOf(c[0][1]), L = r.len ?? lengthOf(c);
    if (L < 40) continue;
    // Which side the line is on, and how far: from its middle point, square to the road.
    const mid = bus[Math.floor(bus.length / 2)];
    let side = 0, bestD = Infinity;
    for (let i = 1; i < c.length; i++) {
      const ax = (c[i - 1][0] - mid[0]) * kx, ay = (c[i - 1][1] - mid[1]) * KY, bx = (c[i][0] - mid[0]) * kx, by = (c[i][1] - mid[1]) * KY;
      const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey;
      if (!L2) continue;
      const u = Math.max(0, Math.min(1, -(ax * ex + ay * ey) / L2)), qx = ax + ex * u, qy = ay + ey * u, d = Math.hypot(qx, qy);
      if (d < bestD) { bestD = d; side = (ex * -qy - ey * -qx) / Math.sqrt(L2); }   // + left of the way, - right
    }
    if (!Number.isFinite(bestD) || Math.abs(side) >= r.half) continue;
    const lane = (side + Math.sign(side) * r.half) / 2;   // between the line and the kerb
    let s = 0;
    for (let i = 1; i < c.length; i++) {
      const a = c[i - 1], b = c[i], ex = (b[0] - a[0]) * kx, ey = (b[1] - a[1]) * KY, d = Math.hypot(ex, ey);
      if (!d) continue;
      for (let at = Math.ceil(Math.max(0, s - 30) / 60) * 60 + 30 - s; at < d; at += 60) {
        const sv = s + at;
        if (sv < 15 || sv > L - 15) continue;
        const tx = ex / d, ty = ey / d;
        const p: LngLat = [a[0] + (tx * at - ty * lane) / kx, a[1] + (ty * at + tx * lane) / KY];
        const rot = (Math.atan2(tx, ty) * 180) / Math.PI - 90;
        out.push({ type: "Feature", properties: { kind: "busword", rot }, geometry: { type: "Point", coordinates: p } });
      }
      s += d;
    }
  }
  return out;
}

/** The turns a lane's arrow shows (scripts/roads.py, from turn:lanes). */
export const TURN = { left: 1, slightLeft: 2, through: 4, slightRight: 8, right: 16 };
/** A turn arrow as painted (about 5 m long): a shaft, and a head for each turn, at `at` along `bearingDeg`
 *  (counter-clockwise from east, the way it is driven). Polygons in [lon, lat]. */
export function arrow(at: LngLat, bearingDeg: number, code: number): LngLat[][][] {
  const kx = kxOf(at[1]), a = (bearingDeg * Math.PI) / 180, fx = Math.cos(a), fy = Math.sin(a), lx = -fy, ly = fx;
  // Local metres: x to the left, y forward.
  const ll = ([x, y]: [number, number]): LngLat => [at[0] + ARROW_SCALE * (lx * x + fx * y) / kx, at[1] + ARROW_SCALE * (ly * x + fy * y) / KY];
  const polys: LngLat[][][] = [];
  const bar = (p: [number, number], q: [number, number], w = 0.22) => {
    const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1, ox = (-dy / L) * w, oy = (dx / L) * w;
    const ring: [number, number][] = [[p[0] + ox, p[1] + oy], [q[0] + ox, q[1] + oy], [q[0] - ox, q[1] - oy], [p[0] - ox, p[1] - oy]];
    polys.push([[...ring, ring[0]].map(ll)]);
  };
  const head = (tip: [number, number], deg: number) => {   // deg: the head's way, from forward, + to the left
    const r = (deg * Math.PI) / 180, dx = Math.sin(r), dy = Math.cos(r), px = -dy, py = dx;   // x is to the left
    const b: [number, number] = [tip[0] - dx * 1.1, tip[1] - dy * 1.1];
    const ring: [number, number][] = [tip, [b[0] + px * 0.5, b[1] + py * 0.5], [b[0] - px * 0.5, b[1] - py * 0.5]];
    polys.push([[...ring, ring[0]].map(ll)]);
  };
  if (!code) return polys;
  bar([0, -2.6], [0, 0.4]);
  const turn = (deg: number, len: number) => {
    const r = (deg * Math.PI) / 180, dx = Math.sin(r), dy = Math.cos(r);
    const tip: [number, number] = [dx * len, 0.3 + dy * len];
    bar([0, 0.3], [tip[0] - dx * 1, tip[1] - dy * 1]);
    head(tip, deg);
  };
  if (code & TURN.through) { bar([0, 0.3], [0, 1.6]); head([0, 2.6], 0); }
  if (code & TURN.left) turn(80, 1.9);
  if (code & TURN.slightLeft) turn(30, 2.1);
  if (code & TURN.right) turn(-80, 1.9);
  if (code & TURN.slightRight) turn(-30, 2.1);
  return polys;
}

/** A line's length in metres. */
export function lengthOf(c: LngLat[]): number {
  const kx = 111320 * Math.cos(((c[0]?.[1] ?? 38) * Math.PI) / 180);
  let L = 0;
  for (let i = 1; i < c.length; i++) L += Math.hypot((c[i][0] - c[i - 1][0]) * kx, (c[i][1] - c[i - 1][1]) * 110540);
  return L;
}

/** A carriageway's half width as the street layers draw it (to the half metre). */
export const halfQ = (r: Road) => roadQ(2 * r.half) / 2;

/** Whether a point is in the area the file covers (a little inside its edge: the ways there run out of it). */
export const covers = (r: AthensRoads | null, [lon, lat]: LngLat, inset = 0.004) =>
  !!r && lon > r.box[0] + inset && lon < r.box[2] - inset && lat > r.box[1] + inset && lat < r.box[3] - inset;
