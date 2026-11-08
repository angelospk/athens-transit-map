// The picked trip drawn on its real way (TripPlanner, after the plan's own straight stop-to-stop shapes show): a bus
// ride along its line's OASA shape between the stops it is boarded and left at, a metro or tram ride along its
// track (metro.json), a walk along the streets (the foot router). Pure helpers here; [lat, lon] in and out.

export type Pt = [number, number];

const metres = (a: Pt, b: Pt) => Math.hypot((a[0] - b[0]) * 110_540, (a[1] - b[1]) * 111_320 * Math.cos((a[0] * Math.PI) / 180));

/** The part of a shape from the point nearest `from` to the point nearest `to` after it, with the two ends themselves,
 *  or null when the shape does not pass within `maxM` of both, in that order. score: how far off the ends are. */
export function sliceShape(shape: Pt[], from: Pt, to: Pt, maxM = 80): { pts: Pt[]; score: number } | null {
  if (shape.length < 2) return null;
  let i = -1, di = Infinity;
  shape.forEach((p, k) => { const d = metres(p, from); if (d < di) { di = d; i = k; } });
  if (di > maxM) return null;
  let j = -1, dj = Infinity;
  for (let k = i + 1; k < shape.length; k++) { const d = metres(shape[k], to); if (d < dj) { dj = d; j = k; } }
  if (j < 0 || dj > maxM) return null;
  return { pts: [from, ...shape.slice(i + 1, j), to], score: di + dj };
}

/** Of several shapes (a line's variants, a track's two directions), the slice of the one that fits best. */
export function bestSlice(shapes: Pt[][], from: Pt, to: Pt, maxM = 80): Pt[] | null {
  let best: { pts: Pt[]; score: number } | null = null;
  for (const s of shapes) {
    const r = sliceShape(s, from, to, maxM);
    if (r && (!best || r.score < best.score)) best = r;
  }
  return best?.pts ?? null;
}

// A bus ride's shape put onto the streets: OASA's shapes run a few tens of metres off the road in places (across a
// slip road, along the wrong carriageway). The car router's map matching (OSRM /match) takes points along it, each
// within MATCH_R of a road, and gives back the roads that join them.
// - The public router takes at most MATCH_CHUNK points a request, so the line goes in pieces.
// - A piece's first and last points are matched blind (nothing before or after them says which way the bus goes, so
//   on a road with two carriageways they may land on the other one): pieces overlap by MATCH_OVERLAP points and are
//   joined at a point inside both, each cut at the vertex nearest to it.
// - It turns away more than a few requests at once (429, or TooBig while busy): two at a time, each asked again after
//   a pause. A piece it still cannot match (or not within MATCH_WAIT_MS), or matches by a detour, keeps its own points.
// - A line matched once is kept for the session.
export const CAR_MATCH_URL = (import.meta.env.VITE_CAR_MATCH_URL as string | undefined) || "https://routing.openstreetmap.de/routed-car/match/v1/driving";
const MATCH_R = 35, MATCH_STEP = 80, MATCH_MAX = 240, MATCH_CHUNK = 10, MATCH_OVERLAP = 3, MATCH_PARALLEL = 2, MATCH_TRIES = 3, MATCH_WAIT_MS = 6000;

const length = (pts: Pt[]) => { let m = 0; for (let i = 1; i < pts.length; i++) m += metres(pts[i - 1], pts[i]); return m; };
const nearest = (line: Pt[], p: Pt) => { let k = 0, d = Infinity; line.forEach((q, i) => { const m = metres(q, p); if (m < d) { d = m; k = i; } }); return k; };

/** Points every `step` metres along a line (its ends kept), at most `max` of them. */
export function resample(pts: Pt[], step: number, max: number): Pt[] {
  if (pts.length < 2) return pts;
  const every = Math.max(step, length(pts) / (max - 1));
  const out: Pt[] = [pts[0]];
  let need = every, run = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], d = metres(a, b);
    while (d > 0 && run + d >= need) {
      const t = (need - run) / d;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      need += every;
    }
    run += d;
  }
  if (metres(out[out.length - 1], pts[pts.length - 1]) > 5) out.push(pts[pts.length - 1]);
  return out;
}

/** Pieces of at most `n` points, each starting `overlap` points before the last one ends (the last piece at the end). */
export function chunks<T>(pts: T[], n: number, overlap = 1): T[][] {
  const out: T[][] = [];
  for (let i = 0; ; i += n - overlap) {
    out.push(pts.slice(i, i + n));
    if (i + n >= pts.length) break;
  }
  return out;
}

/** A piece on its roads: the roads' line, and where each of its points landed on them (null: nowhere). */
export interface Matched { line: Pt[]; at: (Pt | null)[] }

/** One piece onto its roads; null when the router finds none, or only a way round (half as long again). */
export async function matchPiece(ps: Pt[], signal?: AbortSignal, pause = (ms: number) => new Promise(ok => setTimeout(ok, ms))): Promise<Matched | null> {
  const coords = ps.map(([lat, lon]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(";");
  const u = `${CAR_MATCH_URL}/${coords}?overview=full&geometries=geojson&gaps=ignore&radiuses=${ps.map(() => MATCH_R).join(";")}`;
  for (let k = 0; k < MATCH_TRIES; k++) {
    if (k) await pause(700 * k);
    const r = await fetch(u, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(MATCH_WAIT_MS)]) : AbortSignal.timeout(MATCH_WAIT_MS) });
    if (r.status === 429 || r.status >= 500) continue;   // busy: again, after a pause
    const body = await r.json().catch(() => null) as { code?: string; matchings?: { geometry?: { coordinates?: [number, number][] } }[];
      tracepoints?: ({ location?: [number, number] } | null)[] } | null;
    if (!body || body.code === "TooBig") continue;
    const line = (body.matchings ?? []).flatMap(m => m.geometry?.coordinates ?? []).map(([lon, lat]) => [lat, lon] as Pt);
    if (body.code !== "Ok" || line.length < 2 || length(line) > length(ps) * 1.5 + 150) return null;
    return { line, at: ps.map((_, i) => { const l = body.tracepoints?.[i]?.location; return l ? [l[1], l[0]] as Pt : null; }) };
  }
  return null;
}
const matched = new Map<string, Pt[]>();

/** The roads under a line, piece by piece; null when none of it matched. */
export async function matchRoads(pts: Pt[], signal?: AbortSignal, piece: (ps: Pt[], signal?: AbortSignal) => Promise<Matched | null> = matchPiece): Promise<Pt[] | null> {
  const ps = resample(pts, MATCH_STEP, MATCH_MAX);
  const key = ps.map(p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(";");
  const known = matched.get(key);
  if (known) return known;
  const parts = chunks(ps, MATCH_CHUNK, MATCH_OVERLAP);
  const got: (Matched | null)[] = new Array(parts.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(MATCH_PARALLEL, parts.length) }, async () => {
    while (next < parts.length) { const k = next++; got[k] = await piece(parts[k], signal).catch(() => null); }
  }));
  if (got.every(g => !g)) return null;
  // Joined at each overlap's second point: the next piece's second, this one's last but one (MATCH_OVERLAP 3).
  const out: Pt[] = [];
  got.forEach((g, k) => {
    const part = parts[k], pc = g ?? { line: part, at: part };
    const from = k > 0 ? nearest(pc.line, pc.at[1] ?? part[1]) : 0;
    const to = k < got.length - 1 ? nearest(pc.line, pc.at[part.length - 2] ?? part[part.length - 2]) + 1 : pc.line.length;
    for (const p of pc.line.slice(from, to)) if (!out.length || metres(out[out.length - 1], p) > 0.5) out.push(p);
  });
  if (got.every(Boolean)) { if (matched.size > 40) matched.clear(); matched.set(key, out); }
  return out;
}

// A ride onto its roads in one request: the car router's /route through points every ROUTE_STEP metres along the
// line's own shape (the public /match takes 10 points a request: a ride took dozens of requests and half a minute,
// so the line showed off the road meanwhile, and the live guide never matched at all). Each stretch between two
// points is checked against the shape: one the router takes round a block or back (a carriageway the bus does not
// use, a turn it may not make) keeps the shape's own points there. Results are kept (memory, and the device's
// storage for a week), so the same ride, in the overview and in the guide, is drawn at once the next time.
export const CAR_ROUTE_URL = (import.meta.env.VITE_CAR_ROUTE_URL as string | undefined) || CAR_MATCH_URL.replace("/match/", "/route/");
const ROUTE_STEP = 220, ROUTE_MAX = 90, ROUTE_R = 40, ROUTE_WAIT_MS = 9000, ROUTE_KEEP_S = 7 * 86400;
const routed = new Map<string, Promise<Pt[] | null>>();
const OFF_M = 32;
/** How far a line goes from another at most (metres; each of its points to the nearest piece of the other). */
function strays(line: Pt[], from: Pt[]): number {
  const k = Math.cos((line[0][0] * Math.PI) / 180) * 111_320, kl = 110_540;
  let worst = 0;
  for (const p of line) {
    let best = Infinity;
    for (let i = 1; i < from.length; i++) {
      const ax = from[i - 1][1] * k, ay = from[i - 1][0] * kl, bx = from[i][1] * k, by = from[i][0] * kl, px = p[1] * k, py = p[0] * kl;
      const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy || 1e-9, t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L));
      best = Math.min(best, Math.hypot(ax + t * vx - px, ay + t * vy - py));
    }
    if (from.length < 2) best = metres(p, from[0]);
    worst = Math.max(worst, best);
  }
  return worst;
}
const storeKey = (k: string) => `roads2:${k}`;

/** The stretches of `line` between the points `at` (their nearest vertices, in order). */
function splitAt(line: Pt[], at: Pt[]): Pt[][] {
  const out: Pt[][] = [];
  let from = 0;
  for (let i = 1; i < at.length; i++) {
    let k = from, d = Infinity;
    for (let j = from; j < line.length; j++) { const m = metres(line[j], at[i]); if (m < d) { d = m; k = j; } }
    out.push(line.slice(from, k + 1));
    from = k;
  }
  return out;
}

export async function routeAlong(pts: Pt[], signal?: AbortSignal): Promise<Pt[] | null> {
  if (pts.length < 2) return null;
  const ws = resample(pts, ROUTE_STEP, ROUTE_MAX);
  const key = ws.map(p => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(";");
  const have = routed.get(key);
  if (have) return have;
  const job = (async (): Promise<Pt[] | null> => {
    try {
      const kept = JSON.parse(localStorage.getItem(storeKey(key)) ?? "null") as { at: number; line: Pt[] } | null;
      if (kept && Date.now() / 1000 - kept.at < ROUTE_KEEP_S && kept.line.length > 1) return kept.line;
    } catch { /* no storage */ }
    const coords = ws.map(([lat, lon]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(";");
    const u = `${CAR_ROUTE_URL}/${coords}?overview=full&geometries=geojson&continue_straight=true&radiuses=${ws.map(() => ROUTE_R).join(";")}`;
    let body: { code?: string; routes?: { geometry?: { coordinates?: [number, number][] } }[]; waypoints?: { location?: [number, number] }[] } | null = null;
    for (let t = 0; t < 3 && !body; t++) {
      if (t) await new Promise(ok => setTimeout(ok, 800 * t));
      const r = await fetch(u, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(ROUTE_WAIT_MS)]) : AbortSignal.timeout(ROUTE_WAIT_MS) }).catch(() => null);
      if (!r || r.status === 429 || r.status >= 500) continue;
      body = await r.json().catch(() => null);
      if (!body) break;
    }
    const line = (body?.routes?.[0]?.geometry?.coordinates ?? []).map(([lon, lat]) => [lat, lon] as Pt);
    const at = (body?.waypoints ?? []).map(w => (w.location ? [w.location[1], w.location[0]] as Pt : null));
    if (body?.code !== "Ok" || line.length < 2 || at.length !== ws.length || at.some(x => !x)) return null;
    // Stretch by stretch: the road's way where it goes as the shape does, the shape's own points where it does not
    // (between two points, the shape is the vertices whose distance along it falls between theirs).
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + metres(pts[i - 1], pts[i]));
    const total = cum[cum.length - 1], step = Math.max(ROUTE_STEP, total / (ROUTE_MAX - 1));
    const pos = ws.map((_, i) => Math.min(i * step, total));   // resample() puts them every `step` metres along it
    const roads = splitAt(line, at as Pt[]);
    const pieces: Pt[][] = roads.map((r, i) => {
      const a = Math.min(pos[i], pos[i + 1] ?? pos[i]), b = Math.max(pos[i], pos[i + 1] ?? pos[i]);
      const own: Pt[] = [ws[i], ...pts.filter((_, k) => cum[k] > a && cum[k] < b), ws[i + 1] ?? ws[i]];
      // Kept only if about as long as the shape there and never more than OFF_M from it: a turn into a side street
      // and back (round a block, to a stop's other side) is short but strays off the line.
      return r.length > 1 && length(r) <= Math.max(length(own), step * 0.5) * 1.25 + 40 && strays(r, own) <= OFF_M ? r : own;
    });
    // A stretch the route went round: matched on its own (10 points of it, /match), else the shape's points stay.
    const bad = roads.map((r, i) => (pieces[i] !== r ? i : -1)).filter(i => i >= 0).slice(0, 12);
    let nb = 0;
    await Promise.all([0, 1].map(async () => {
      while (nb < bad.length) {
        const i = bad[nb++], own = pieces[i];
        const m = await matchPiece(resample(own, 25, MATCH_CHUNK), signal).catch(() => null);
        if (m && m.line.length > 1 && length(m.line) <= length(own) * 1.25 + 30 && strays(m.line, own) <= OFF_M) pieces[i] = m.line;
      }
    }));
    const out: Pt[] = [];
    for (const pc of pieces) for (const p of pc) if (!out.length || metres(out[out.length - 1], p) > 0.5) out.push(p);
    if (out.length < 2) return null;
    try { localStorage.setItem(storeKey(key), JSON.stringify({ at: Math.round(Date.now() / 1000), line: out.map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]) })); } catch { /* full */ }
    return out;
  })();
  routed.set(key, job);
  if (routed.size > 60) routed.delete(routed.keys().next().value!);
  const r = await job;
  if (!r) routed.delete(key);   // asked again next time
  return r;
}

// The stops a ride passes between getting on and getting off, for the steps of «Οδηγίες» (each can become the trip's
// end). A bus ride: from its line's variant that has both stops, in that order. A metro or tram ride: the line's
// stations along the ride's track, in order along it.
export interface Mid { name: string; pt: Pt }

export function stopsBetween(variants: { stops: string[] }[], stops: Record<string, { name: string; lat: number; lon: number }>, from: string, to: string): Mid[] | null {
  for (const v of variants) {
    const i = v.stops.indexOf(from), j = i < 0 ? -1 : v.stops.indexOf(to, i + 1);
    if (j < 0) continue;
    return v.stops.slice(i + 1, j).flatMap(id => { const s = stops[id]; return s ? [{ name: s.name, pt: [s.lat, s.lon] as Pt }] : []; });
  }
  return null;
}

export function stationsAlong(track: Pt[], stations: { name: string; lat: number; lon: number; lines: string[] }[], line: string, maxM = 150): Mid[] {
  if (track.length < 2) return [];
  const ends = [track[0], track[track.length - 1]];
  return stations.filter(s => s.lines.includes(line)).flatMap(s => {
    const p: Pt = [s.lat, s.lon];
    if (ends.some(e => metres(e, p) < 150)) return [];
    let k = -1, d = Infinity;
    track.forEach((q, i) => { const m = metres(q, p); if (m < d) { d = m; k = i; } });
    return d <= maxM && k > 0 && k < track.length - 1 ? [{ name: s.name, pt: p, k }] : [];
  }).sort((a, b) => a.k - b.k).map(({ name, pt }) => ({ name, pt }));
}

/** A walk's way from the foot router, unless it goes round about (2.5 times the straight line and more): then none. */
export function sensibleWalk(line: Pt[] | null | undefined, from: Pt, to: Pt): Pt[] | null {
  if (!line || line.length < 2) return null;
  return length(line) > metres(from, to) * 2.5 + 150 ? null : line;
}
