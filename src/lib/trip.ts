// Trip planner: which lines go from one place to another, with no change. Loaded with the planner
// only (dynamic import), as is public/trips.json, its stop index (scripts/trips.ts).

import { fold } from "./search";
import type { AppState } from "./state.svelte";

export type Pt = [number, number];   // [lat, lon]

// s: every stop [name, lat, lon]; l: line → variant → its stops, as indexes into s.
export interface TripIndex { v: string; s: [string, number, number][]; l: Record<string, Record<string, number[]>> }

// A place to start or end at: stops of one name close together, an area or street (geocoder), or the
// user's location.
export interface Place { label: string; hint?: string; pts: Pt[]; lines: string[]; kind?: "stop" | "area" | "street" | "poi" | "me" }

export interface TripVariant {
  id: string;
  i: number; j: number;          // board at stops[i], get off at stops[j] of the variant
  from: number; to: number;      // the same stops, as indexes into the index's stop table
  walk: number;                  // metres in a straight line, to the first stop and from the last
  stops: number;                 // stops travelled
}
export interface TripLine { line: string; walk: number; stops: number; variants: TripVariant[] }

export const WALK_M = 500;
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
    .sort((a, b) => a[0] - b[0] || b[1].lines.length - a[1].lines.length || a[1].label.localeCompare(b[1].label, "el"))
    .slice(0, max).map(([, p]) => p);
}

// Every line with a variant that stops within `radius` of the start and later within `radius` of the
// end. Per variant, the pair of stops with the least walking, then the fewest stops. Lines come
// best first; `known` (the current line list) leaves out lines the index has but OASA dropped.
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
      let best: TripVariant | null = null;
      for (let i = 0; i < seq.length; i++) {
        const a = d(dFrom, from, seq[i]);
        if (a > radius) continue;
        for (let j = i + 1; j < seq.length; j++) {
          const b = d(dTo, to, seq[j]);
          if (b > radius) continue;
          const walk = a + b;
          if (!best || walk < best.walk || (walk === best.walk && j - i < best.stops))
            best = { id, i, j, from: seq[i], to: seq[j], walk, stops: j - i };
        }
      }
      if (best) variants.push(best);
    }
    if (!variants.length) continue;
    variants.sort((a, b) => a.walk - b.walk || a.stops - b.stops || a.id.localeCompare(b.id));
    out.push({ line, walk: variants[0].walk, stops: variants[0].stops, variants });
  }
  return out.sort((a, b) => a.walk - b.walk || a.stops - b.stops || byLine(a.line, b.line));
}

// Where the variants of a result end (the stop names), once each: the way the line goes.
export function termini(ix: TripIndex, t: TripLine): string[] {
  const out: string[] = [];
  for (const v of t.variants) {
    const k = ix.l[t.line]?.[v.id]?.at(-1);
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
    const hint = [...new Set([p.district ?? p.locality, p.city].filter((x): x is string => typeof x === "string" && x !== label))].join(", ");
    const kind = p.osm_key === "place" ? "area" : p.type === "street" || (p.housenumber && !p.name) ? "street" : "poi";
    const key = `${label}|${hint}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ label, ...(hint ? { hint } : {}), pts: [[lat, lon]], lines: [], kind }];
  });
}

// One short list: areas first (what people type: "Ταύρος"), then stop places, streets, and one other
// place. An area with a stop place of its name within 1 km is that place: the stops have the lines.
export function suggest(own: Place[], geo: Place[], max = 7): Place[] {
  const covered = (a: Place) => own.some(o => fold(o.label) === fold(a.label) && o.pts.some(p => distM(p, a.pts[0]) < 1000));
  const areas = geo.filter(g => g.kind === "area" && !covered(g)).slice(0, 2);
  const rest = [...geo.filter(g => g.kind === "street"), ...geo.filter(g => g.kind === "poi").slice(0, 1)];
  const stops = own.slice(0, Math.max(max - areas.length - Math.min(rest.length, 2), 0));
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
// as you type; the caller waits for a pause in typing). Answers are cached.
const GEOCODE_URL = import.meta.env.VITE_GEOCODE_URL || "https://photon.komoot.io/api/";
const geocoded = new Map<string, Place[]>();
export async function geocode(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim(), key = fold(q);
  const hit = geocoded.get(key);
  if (hit) return hit;
  const u = new URL(GEOCODE_URL);
  // Attica only.
  Object.entries({ q, bbox: "23.35,37.65,24.15,38.25", limit: "8" }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const found = parsePhoton(await r.json());
  geocoded.set(key, found);
  return found;
}
