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
