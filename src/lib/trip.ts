// Trip planner: which lines go from one place to another, with no change or one. Loaded with the planner
// only (dynamic import), as is public/trips.json, its stop index (scripts/trips.ts).

import type { MetroData } from "./metro";
import { fold } from "./search";
import type { AppState } from "./state.svelte";

export type Pt = [number, number];   // [lat, lon]

// s: every stop [name, lat, lon, GTFS stop_id] (files before the id lack it); l: line → variant → its
// stops, as indexes into s.
export interface TripIndex { v: string; s: [string, number, number, string?][]; l: Record<string, Record<string, number[]>> }

// A place to start or end at: stops of one name close together, an area or street (geocoder), or the
// user's location.
export interface Place { label: string; hint?: string; pts: Pt[]; lines: string[]; kind?: "stop" | "area" | "street" | "poi" | "me" | "metro" | "metro-any" }

export interface TripVariant {
  id: string;
  i: number; j: number;          // board at stops[i], get off at stops[j] of the variant
  from: number; to: number;      // the same stops, as indexes into the index's stop table
  walk: number;                  // metres in a straight line, to the first stop and from the last
  stops: number;                 // stops travelled
  ride: number;                  // metres on the bus, stop to stop in straight lines
  min: number;                   // estimated minutes, walking and riding
}
export interface TripLine { line: string; walk: number; stops: number; min: number; variants: TripVariant[] }

export const WALK_M = 500;
const WALK_MPM = 75;       // 4.5 km/h
const DETOUR = 1.3;        // streets are longer than the straight line
const RIDE_MPM = 250;      // 15 km/h, stops included
export const XFER_M = 250;
export const XFER_MIN = 5; // waiting for the second bus
const CLUSTER_M = 800;

export function distM(a: Pt, b: Pt): number {
  return Math.hypot((a[1] - b[1]) * Math.cos((a[0] * Math.PI) / 180), a[0] - b[0]) * 111_320;
}
const nearest = (p: Pt, pts: Pt[]) => Math.min(...pts.map(q => distM(p, q)));

export const centre = (pts: Pt[]): Pt =>
  [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

const byLine = (a: string, b: string) => a.localeCompare(b, "el", { numeric: true });

// Stops grouped by name; one name far apart (ΕΚΚΛΗΣΙΑ) is several places. A stop joins a group only
// near its first stop, so a chain of stops cannot stretch a place across a district. Stops are taken
// south to north, so the result does not depend on their order in the index.
export function places(ix: TripIndex): Place[] {
  const lines = ix.s.map(() => new Set<string>());
  for (const [line, vs] of Object.entries(ix.l)) for (const seq of Object.values(vs)) for (const k of seq) lines[k]?.add(line);
  const order = ix.s.map((_, k) => k).sort((a, b) => ix.s[a][1] - ix.s[b][1] || ix.s[a][2] - ix.s[b][2] || a - b);
  const groups = new Map<string, { seed: Pt; place: Place; lines: Set<string> }[]>();
  for (const k of order) {
    const [name, lat, lon] = ix.s[k];
    const p: Pt = [lat, lon];
    const key = fold(name);
    const list = groups.get(key) ?? [];
    groups.set(key, list);
    let g = list.find(x => distM(x.seed, p) <= CLUSTER_M);
    if (!g) list.push((g = { seed: p, place: { label: name, pts: [], lines: [], kind: "stop" }, lines: new Set() }));
    g.place.pts.push(p);
    for (const l of lines[k]) g.lines.add(l);
  }
  return [...groups.values()].flat().map(g => ({ ...g.place, lines: [...g.lines].sort(byLine) }));
}

const folded = new WeakMap<Place, string>();
const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

// Places whose name has the text at a word start ("ταυρ" is not in ΔΙΑΣΤΑΥΡΩΣΗ); whole name first,
// then name start, then busier places.
export function searchPlaces(list: Place[], query: string, max = 6): Place[] {
  const q = fold(query.trim());
  if (!q) return [];
  const rank = (p: Place) => {
    let f = folded.get(p);
    if (f == null) folded.set(p, (f = fold(p.label)));
    if (f === q) return 0;
    for (let at = f.indexOf(q); at >= 0; at = f.indexOf(q, at + 1))
      if (at === 0) return 1;
      else if (!isWordChar(f[at - 1])) return 2;
    return -1;
  };
  return list.map(p => [rank(p), p] as const).filter(([r]) => r >= 0)
    .sort((a, b) => a[0] - b[0] || +(b[1].kind === "metro") - +(a[1].kind === "metro") || b[1].lines.length - a[1].lines.length || a[1].label.localeCompare(b[1].label, "el"))
    .slice(0, max).map(([, p]) => p);
}

const walkMin = (m: number) => (m * DETOUR) / WALK_MPM;

// Metres on the bus up to each stop of a variant (straight lines between stops), cached per index.
const rides = new WeakMap<TripIndex, Map<string, number[]>>();
function cumulative(ix: TripIndex, line: string, id: string, seq: number[]): number[] {
  let m = rides.get(ix);
  if (!m) rides.set(ix, (m = new Map()));
  const key = `${line}/${id}`;
  let c = m.get(key);
  if (!c) {
    c = [0];
    for (let k = 1; k < seq.length; k++) c.push(c[k - 1] + distM([ix.s[seq[k - 1]][1], ix.s[seq[k - 1]][2]], [ix.s[seq[k]][1], ix.s[seq[k]][2]]));
    m.set(key, c);
  }
  return c;
}

// Every line with a variant that stops within `radius` of the start and later within `radius` of the
// end. Per variant, the pair of stops with the least estimated time (walking and riding), then the
// fewest stops. Lines come best first; `known` (the current line list) leaves out lines the index has
// but OASA dropped.
export function findTrips(ix: TripIndex, from: Pt[], to: Pt[], radius = WALK_M, known?: Set<string>): TripLine[] {
  if (Math.min(...from.map(p => nearest(p, to))) < radius) return [];   // close enough to walk
  const dFrom = new Map<number, number>(), dTo = new Map<number, number>();
  const d = (cache: Map<number, number>, pts: Pt[], k: number) => {
    let v = cache.get(k);
    if (v == null) cache.set(k, (v = nearest([ix.s[k][1], ix.s[k][2]], pts)));
    return v;
  };
  const out: TripLine[] = [];
  for (const [line, vs] of Object.entries(ix.l)) {
    if (known && !known.has(line)) continue;
    const variants: TripVariant[] = [];
    for (const [id, seq] of Object.entries(vs)) {
      const cum = cumulative(ix, line, id, seq);
      let best: TripVariant | null = null;
      for (let i = 0; i < seq.length; i++) {
        const a = d(dFrom, from, seq[i]);
        if (a > radius) continue;
        for (let j = i + 1; j < seq.length; j++) {
          const b = d(dTo, to, seq[j]);
          if (b > radius) continue;
          const ride = cum[j] - cum[i], min = walkMin(a + b) + ride / RIDE_MPM;
          if (!best || min < best.min || (min === best.min && j - i < best.stops))
            best = { id, i, j, from: seq[i], to: seq[j], walk: a + b, stops: j - i, ride, min };
        }
      }
      if (best) variants.push(best);
    }
    if (!variants.length) continue;
    variants.sort((a, b) => a.min - b.min || a.stops - b.stops || a.id.localeCompare(b.id));
    out.push({ line, walk: variants[0].walk, stops: variants[0].stops, min: variants[0].min, variants });
  }
  return out.sort((a, b) => a.min - b.min || a.stops - b.stops || byLine(a.line, b.line));
}

// One bus ride inside a trip with a change.
export interface TripLeg { line: string; id: string; i: number; j: number; from: number; to: number; stops: number; ride: number }
export interface TripTransfer {
  legs: [TripLeg, TripLeg];
  walk: number;   // metres in a straight line, to the first stop and from the last
  xfer: number;   // metres between the stop of the first leg's end and the second leg's start
  min: number;
}

// The first line of a change as a trip of its own (to the change stop): what a stop alert watches.
export function legTrip(a: TripLeg): TripLine {
  return { line: a.line, walk: 0, stops: a.stops, min: 0,
    variants: [{ id: a.id, i: a.i, j: a.j, from: a.from, to: a.to, walk: 0, stops: a.stops, ride: a.ride, min: 0 }] };
}

// Stops in a grid of XFER_M cells, cached per index: the stops near a stop without looking at all.
interface Grid { cell: (lat: number, lon: number) => [number, number]; at: Map<string, number[]> }
const grids = new WeakMap<TripIndex, Grid>();
function gridOf(ix: TripIndex): Grid {
  let g = grids.get(ix);
  if (g) return g;
  const lat0 = ix.s.length ? ix.s.reduce((t, x) => t + x[1], 0) / ix.s.length : 38;
  const dLat = XFER_M / 111_320, dLon = dLat / Math.cos((lat0 * Math.PI) / 180);
  const cell = (lat: number, lon: number): [number, number] => [Math.floor(lat / dLat), Math.floor(lon / dLon)];
  const at = new Map<string, number[]>();
  ix.s.forEach((x, k) => {
    const key = cell(x[1], x[2]).join(",");
    const list = at.get(key);
    if (list) list.push(k); else at.set(key, [k]);
  });
  grids.set(ix, (g = { cell, at }));
  return g;
}

// Trips with one change: a first line from near the start, then on foot (at most XFER_M) to a stop of
// another line that gets off near the end. Per pair of lines the quickest; the first few overall.
export function findTransfers(ix: TripIndex, from: Pt[], to: Pt[], radius = WALK_M, known?: Set<string>, max = 3): TripTransfer[] {
  if (Math.min(...from.map(p => nearest(p, to))) < radius) return [];   // close enough to walk
  const pt = (k: number): Pt => [ix.s[k][1], ix.s[k][2]];
  const dFrom = new Map<number, number>(), dTo = new Map<number, number>();
  const d = (cache: Map<number, number>, pts: Pt[], k: number) => {
    let v = cache.get(k);
    if (v == null) cache.set(k, (v = nearest(pt(k), pts)));
    return v;
  };
  const leg = (line: string, id: string, seq: number[], cum: number[], i: number, j: number): TripLeg =>
    ({ line, id, i, j, from: seq[i], to: seq[j], stops: j - i, ride: cum[j] - cum[i] });

  // First leg: the quickest way to each stop, per line.
  interface Arrival { cost: number; walk: number; leg: TripLeg }
  const arrivals = new Map<number, Map<string, Arrival>>();
  for (const [line, vs] of Object.entries(ix.l)) {
    if (known && !known.has(line)) continue;
    for (const [id, seq] of Object.entries(vs)) {
      const cum = cumulative(ix, line, id, seq);
      let bestI = -1, bestV = Infinity;   // over boardings so far: walk minutes minus the ride to them
      for (let j = 0; j < seq.length; j++) {
        if (bestI >= 0) {
          const cost = bestV + cum[j] / RIDE_MPM;
          let m = arrivals.get(seq[j]);
          if (!m) arrivals.set(seq[j], (m = new Map()));
          const had = m.get(line);
          if (!had || cost < had.cost) m.set(line, { cost, walk: d(dFrom, from, seq[bestI]), leg: leg(line, id, seq, cum, bestI, j) });
        }
        const a = d(dFrom, from, seq[j]);
        if (a <= radius && walkMin(a) - cum[j] / RIDE_MPM < bestV) { bestV = walkMin(a) - cum[j] / RIDE_MPM; bestI = j; }
      }
    }
  }
  if (!arrivals.size) return [];

  // Second leg: from each boarding stop, the quickest way to the end; joined to the first legs that
  // arrive within walking distance.
  const { cell, at } = gridOf(ix);
  const best = new Map<string, TripTransfer>();
  for (const [line, vs] of Object.entries(ix.l)) {
    if (known && !known.has(line)) continue;
    for (const [id, seq] of Object.entries(vs)) {
      const cum = cumulative(ix, line, id, seq);
      let g = Infinity, gJ = -1;   // over alightings after the stop: walk minutes plus the ride to them
      for (let i = seq.length - 2; i >= 0; i--) {
        const b = d(dTo, to, seq[i + 1]);
        if (b <= radius && walkMin(b) + cum[i + 1] / RIDE_MPM < g) { g = walkMin(b) + cum[i + 1] / RIDE_MPM; gJ = i + 1; }
        if (gJ < 0) continue;
        const [r, c] = cell(ix.s[seq[i]][1], ix.s[seq[i]][2]);
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          for (const m of at.get(`${r + dr},${c + dc}`) ?? []) {
            const arr = arrivals.get(m);
            if (!arr) continue;
            const x = distM(pt(m), pt(seq[i]));
            if (x > XFER_M) continue;
            for (const [line1, a] of arr) {
              if (line1 === line) continue;
              const min = a.cost + walkMin(x) + XFER_MIN + g - cum[i] / RIDE_MPM;
              const key = `${line1}\n${line}`, had = best.get(key);
              if (!had || min < had.min)
                best.set(key, { legs: [a.leg, leg(line, id, seq, cum, i, gJ)], walk: a.walk + d(dTo, to, seq[gJ]), xfer: x, min });
            }
          }
        }
      }
    }
  }
  return [...best.values()]
    .sort((a, b) => a.min - b.min || byLine(a.legs[0].line, b.legs[0].line) || byLine(a.legs[1].line, b.legs[1].line))
    .slice(0, max);
}

// A stop near the start to wait at: stops of one name, the walk to the nearest of them, and the given
// lines that stop there and still reach the end (per variant, the occurrence with the least walking,
// then the fewest stops, as in findTrips).
export interface BoardAt { id: string; i: number; from: number }
export interface Boarding { name: string; walk: number; lines: { line: string; variants: BoardAt[] }[] }

export function boardings(ix: TripIndex, from: Pt[], to: Pt[], radius: number, lines: string[], max = 4): Boarding[] {
  const near = (pts: Pt[], k: number) => nearest([ix.s[k][1], ix.s[k][2]], pts);
  const out = new Map<string, Boarding>();
  for (const line of lines) {
    for (const [id, seq] of Object.entries(ix.l[line] ?? {})) {
      const best = new Map<string, { at: BoardAt; a: number; cost: number; stops: number }>();   // per stop name
      for (let i = 0; i < seq.length; i++) {
        const a = near(from, seq[i]);
        if (a > radius) continue;
        let b = Infinity, j = -1;
        for (let k = i + 1; k < seq.length; k++) { const d = near(to, seq[k]); if (d <= radius && d < b) { b = d; j = k; } }
        if (j < 0) continue;
        const key = fold(ix.s[seq[i]][0]), had = best.get(key);
        if (!had || a + b < had.cost || (a + b === had.cost && j - i < had.stops))
          best.set(key, { at: { id, i, from: seq[i] }, a, cost: a + b, stops: j - i });
      }
      for (const [key, { at, a }] of best) {
        let g = out.get(key);
        if (!g) out.set(key, (g = { name: ix.s[at.from][0], walk: a, lines: [] }));
        g.walk = Math.min(g.walk, a);
        const l = g.lines.find(x => x.line === line);
        if (l) l.variants.push(at);
        else g.lines.push({ line, variants: [at] });
      }
    }
  }
  return [...out.values()].sort((a, b) => a.walk - b.walk || a.name.localeCompare(b.name, "el")).slice(0, max);
}

// What a stop alert watches: each line's own boarding stop, or the chosen stop for all; only lines on
// the map (the alert follows their live feeds) and not unticked.
export function alertTargets(trips: TripLine[], onMap: string[], at: Boarding | null, off: string[]): { line: string; variants: BoardAt[] }[] {
  const lines = at ? at.lines : trips.map(t => ({ line: t.line, variants: t.variants.map(({ id, i, from }) => ({ id, i, from })) }));
  return lines.filter(l => onMap.includes(l.line) && !off.includes(l.line));
}

// Where the given variants of a line end (the stop names), once each: the way the line goes.
export function termini(ix: TripIndex, line: string, variantIds: string[]): string[] {
  const out: string[] = [];
  for (const id of variantIds) {
    const k = ix.l[line]?.[id]?.at(-1);
    const name = k == null ? undefined : ix.s[k]?.[0];
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

// A result tapped in the planner: hidden, or shown again only on the variants that make the trip.
export function toggleTripLine(app: AppState, t: TripLine) {
  const was = app.selected.includes(t.line);
  app.toggleLine(t.line);
  if (!was && app.selected.includes(t.line)) app.setFocus(t.line, t.variants.map(v => v.id));
}

// Metro, ISAP and tram stations as places to start or end at, with their lines; one place for the
// nearest metro or ISAP station of all (the caller picks by the point it compares).
export function metroPlaces(data: MetroData): Place[] {
  return data.stations.map(s => ({ label: s.name, pts: [[s.lat, s.lon]] as Pt[], lines: s.lines, kind: "metro" as const }));
}
const isMetro = (s: MetroData["stations"][number]) => s.lines.some(l => l.startsWith("M"));
export function anyMetro(data: MetroData): Place {
  return { label: "Κοντινότερος σταθμός μετρό", pts: data.stations.filter(isMetro).map(s => [s.lat, s.lon] as Pt), lines: [], kind: "metro-any" };
}

// A metro or tram line with a station near the start and another near the end (the least walking):
// the planner says so before the buses, which may take far longer.
export function metroDirect(data: MetroData, from: Pt[], to: Pt[], radius: number): { line: string; from: string; to: string; walk: number } | null {
  const near = (pts: Pt[]) => data.stations.map(s => ({ s, d: nearest([s.lat, s.lon], pts) })).filter(x => x.d <= radius);
  const a = near(from), b = near(to);
  let best: { line: string; from: string; to: string; walk: number } | null = null;
  for (const x of a) for (const y of b) {
    if (x.s.name === y.s.name) continue;
    const line = x.s.lines.find(l => y.s.lines.includes(l));
    if (line && (!best || x.d + y.d < best.walk)) best = { line, from: x.s.name, to: y.s.name, walk: x.d + y.d };
  }
  return best;
}

// The metro or ISAP station nearest a point, and the metres to it.
export function nearestStation(data: MetroData, p: Pt): { name: string; d: number } | null {
  let best: { name: string; d: number } | null = null;
  for (const s of data.stations) {
    if (!isMetro(s)) continue;
    const d = distM(p, [s.lat, s.lon]);
    if (!best || d < best.d) best = { name: s.name, d };
  }
  return best;
}

// Photon answers (GeoJSON, [lon, lat]): areas, streets and addresses, other places (poi). Left out: bus
// stops (the index has them, with their lines) and municipal boundaries (the area of the name comes too). A long street comes in pieces with the same name and area:
// the first one stands for all.
export function parsePhoton(body: unknown): Place[] {
  const features = (body as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const seen = new Set<string>();
  return features.flatMap((f): Place[] => {
    const p = f?.properties, c = f?.geometry?.coordinates;
    if (!p || !Array.isArray(c) || p.osm_value === "bus_stop" || p.osm_key === "boundary") return [];
    const lon = Number(c[0]), lat = Number(c[1]);
    const label = p.name ?? (p.street ? [p.street, p.housenumber].filter(Boolean).join(" ") : null);
    if (typeof label !== "string" || !label || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
    const kind = p.osm_key === "place" ? "area" : p.type === "street" || (p.housenumber && !p.name) ? "street" : "poi";
    const place = [p.district ?? p.locality, p.city].filter((x): x is string => typeof x === "string" && x !== label);
    const street = kind === "poi" && p.street ? [[p.street, p.housenumber].filter(Boolean).join(" ")] : [];
    const hint = [...new Set([...street, ...place].filter(x => x !== label))].join(", ");
    const key = `${label}|${hint}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ label, ...(hint ? { hint } : {}), pts: [[lat, lon]], lines: [], kind }];
  });
}

// One short list: areas first (what people type: "Ταύρος"), then stop places, streets, and up to three
// other places (shops, chargers). An area with a stop place of its name within 1 km is that place: the
// stops have the lines.
export function suggest(own: Place[], geo: Place[], max = 7): Place[] {
  const covered = (a: Place) => own.some(o => fold(o.label) === fold(a.label) && o.pts.some(p => distM(p, a.pts[0]) < 1000));
  const areas = geo.filter(g => g.kind === "area" && !covered(g)).slice(0, 2);
  const rest = [...geo.filter(g => g.kind === "street"), ...geo.filter(g => g.kind === "poi").slice(0, 3)];
  const stops = own.slice(0, Math.max(max - areas.length - Math.min(rest.length, 4), 0));
  return [...areas, ...stops, ...rest].slice(0, max);
}

let index: Promise<TripIndex> | null = null;
export function loadTripIndex(): Promise<TripIndex> {
  if (index) return index;
  const p = fetch(`${import.meta.env.BASE_URL}trips.json`).then(r => {
    if (!r.ok) throw new Error(`trips.json: HTTP ${r.status}`);
    return r.json() as Promise<TripIndex>;
  });
  p.catch(() => { if (index === p) index = null; });   // the next call tries again
  return (index = p);
}

// Areas and streets (Ταύρος has no stop of its name), from Photon (OpenStreetMap data, made for search
// as you type; the caller waits for a pause in typing). Answers are cached; a point biases them to the
// places near it, and a house number the map does not know falls back to its street.
const GEOCODE_URL = import.meta.env.VITE_GEOCODE_URL || "https://photon.komoot.io/api/";
const geocoded = new Map<string, Place[]>();
export async function geocode(query: string, signal?: AbortSignal, near?: Pt): Promise<Place[]> {
  // About 1 km: the point is sent as it is cached, so one answer serves the points near it.
  const at = near?.map(x => Number(x.toFixed(2)));
  const q = query.trim(), key = `${fold(q)}|${at ?? ""}`;
  const hit = geocoded.get(key);
  if (hit) return hit;
  const ask = async (qq: string) => {
    const u = new URL(GEOCODE_URL);
    // Attica only.
    Object.entries({ q: qq, bbox: "23.35,37.65,24.15,38.25", limit: "8" }).forEach(([k, v]) => u.searchParams.set(k, v));
    if (at) {
      u.searchParams.set("lat", String(at[0]));
      u.searchParams.set("lon", String(at[1]));
    }
    const r = await fetch(u, { signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return parsePhoton(await r.json());
  };
  let found = await ask(q);
  const num = /\s+\d+(?:\s*-\s*\d+)?(?:\s*[α-ωa-z])?$/i;   // "30", "30-32", "30Α", "30 Α"
  if (!found.length && num.test(q)) found = await ask(q.replace(num, ""));
  geocoded.set(key, found);
  return found;
}
